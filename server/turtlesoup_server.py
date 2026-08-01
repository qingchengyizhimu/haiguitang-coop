#!/usr/bin/env python3
"""Haiguitang Game Server — local JSON + DeepSeek moderator"""
import json, os, random, re, time, uuid, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

PORT = int(os.environ.get("TURTLE_PORT", "8777"))
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "your-deepseek-key-here")
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DATA_DIR = "/opt/turtlesoup"
os.makedirs(DATA_DIR, exist_ok=True)
GAMES_FILE = os.path.join(DATA_DIR, "games.json")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
ARCHIVE_FILE = os.path.join(DATA_DIR, "played_games.json")

# Load/save helpers
def load_json(path, default=None):
    if default is None: default = []
    if not os.path.exists(path): return default
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    return json.loads(content) if content else default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_games():
    # First time: try to load from the merged JSON
    games = load_json(GAMES_FILE, [])
    if not games:
        merged_path = "/opt/haiguitang_all_merged.json"
        if os.path.exists(merged_path):
            games = load_json(merged_path, [])
            save_json(GAMES_FILE, games)
    return games

def load_sessions():
    return load_json(SESSIONS_FILE, [])

def save_session(sid, data):
    sessions = load_sessions()
    for i, s in enumerate(sessions):
        if s.get("id") == sid:
            sessions[i] = {**s, **data}
            save_json(SESSIONS_FILE, sessions)
            return
    data["id"] = sid
    sessions.append(data)
    save_json(SESSIONS_FILE, sessions)

def get_session(sid):
    for s in load_sessions():
        if s.get("id") == sid:
            return s
    return None

def next_session_id():
    sessions = load_sessions()
    return max([s.get("id", 0) for s in sessions] or [0]) + 1

def is_yes_no_question(q):
    """Local validation — DeepSeek doesn't decide this anymore."""
    q = q.strip().rstrip("?？")
    if q.endswith(("吗", "么", "嘛")): return True
    if re.search(r"(是不是|能不能|会不会|有没有|该不该|是否|能否|可不可以|应不应该|算不算|意味着|代表|导致|引起)", q): return True
    if re.match(r"^(什么|为什么|哪里|谁|怎么|多少|何时|哪个|哪些|怎样|如何|请|描述|解释|告诉我|说说|到底|究竟)", q): return False
    return True  # default: allow

VALID_ANSWERS = {"是", "否", "是也不是", "无关"}

def get_host_answer(system_prompt, question, history=None):
    """Call DeepSeek with retry. Raises RuntimeError if both attempts fail."""
    sp = make_system_prompt(history[0] if history else {}, history) if isinstance(system_prompt, dict) else system_prompt
    # Actually, the caller already built system_prompt. We just retry.
    last_error = None
    for attempt in range(2):
        try:
            result = ask_deepseek(system_prompt, question)
            result = result.strip()
            # Strip markdown code fences
            result = re.sub(r"^```(?:json)?\s*|\s*```$", "", result, flags=re.MULTILINE)
            data = json.loads(result)
            answer = data.get("answer", "")
            if answer in VALID_ANSWERS:
                return answer
            last_error = f"非法答案：{answer}"
        except Exception as e:
            last_error = str(e)
    raise RuntimeError(f"主持人回答失败：{last_error}")

def ask_deepseek(system_prompt, user_message):
    body = json.dumps({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0, "max_tokens": 100
    }).encode()
    req = urllib.request.Request(DEEPSEEK_URL, data=body, headers={
        "Authorization": f"Bearer {DEEPSEEK_KEY}", "Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())["choices"][0]["message"]["content"]

def make_system_prompt(game, history=None):
    elements = game.get("key_elements", [])
    el_str = "\n".join(f"- {e}" for e in elements) if elements else "无预设要素"
    hist_lines = []
    if history:
        for i, h in enumerate(history):
            hist_lines.append(f"{i+1}. Q:{h['question']} → A:{h['answer']}")
    hist_text = "\n".join(hist_lines) if hist_lines else "暂无"

    return f"""你是海龟汤主持人。

## 汤底
{game['soup_bottom']}

## 汤底关键事实
{el_str}

## 本局已公开问答
{hist_text}

## 回答规则
1. 汤底是唯一事实依据。
2. 回答前检查新问题是否与历史问题相同或语义等价。相同/等价问题必须保持完全一致的答案。
3. 否定问句按原句命题回答：如"不是飞机"成立则答"是"。
4. "是也不是"仅用于多条件有真有假或对象/时间存在歧义。
5. "无关"仅用于该事实不影响汤底核心逻辑。
6. 不得根据常识补充汤底没有提供的任何关键事实。

只返回JSON格式（不要加```标记）：{{"answer":"<是|否|是也不是|无关>"}}"""

class Handler(BaseHTTPRequestHandler):
    def _json(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        path = self.path.rstrip("/")

        if path.endswith("/start"):
            mode = body.get("mode", "normal")
            room_key = body.get("room_key", "")
            reuse_active = body.get("reuse_active", False)

            # Reuse active session in the same room
            force_new = body.get("force_new", False)
            start_request_id = body.get("request_id", "")
            previous_sid = body.get("previous_session_id")

            # Idempotency: same request_id for force_new returns the already-created session
            if force_new and start_request_id:
                for s in load_sessions():
                    if s.get("_start_request_id") == start_request_id:
                        return self._json({
                            "session_id": s["id"], "status": s.get("status", "playing"),
                            "title": s.get("title", "?"), "difficulty": s.get("difficulty", "?"),
                            "soup_face": s.get("soup_face", "?"), "mode": s.get("mode", "normal"),
                            "xinxin_questions_left": s.get("xinxin_questions_left", 6),
                            "azhi_questions_left": s.get("azhi_questions_left", 6),
                            "hints_used": s.get("hints_used", 0), "hints_total": s.get("hints_total", 0),
                            "questions_log": s.get("questions_log", []),
                            "reused": True, "duplicate": True
                        })

            # force_new: always create new session (don't reuse)
            # Also skip reuse if existing session is already settled (won/lost/ended/abandoned)
            if not force_new and reuse_active and room_key:
                for s in load_sessions():
                    if s.get("room_key") == room_key and s.get("status") == "playing":
                        return self._json({
                            "session_id": s["id"], "status": s.get("status","playing"),
                            "title": s.get("title","?"), "difficulty": s.get("difficulty","?"),
                            "soup_face": s.get("soup_face","?"), "mode": s.get("mode","normal"),
                            "xinxin_questions_left": s.get("xinxin_questions_left",6),
                            "azhi_questions_left": s.get("azhi_questions_left",6),
                            "hints_used": s.get("hints_used",0),
                            "hints_total": s.get("hints_total",0),
                            "questions_log": s.get("questions_log",[]),
                            "reused": True
                        })

            games = load_games()
            if not games:
                return self._json({"error": "no games loaded"}, 500)

            # Auto-archive: exclude already-played games
            played = load_json(ARCHIVE_FILE, [])
            unplayed = [g for g in games if g.get("title") not in played]
            if not unplayed:
                # All games played — reset archive and warn
                played.clear()
                save_json(ARCHIVE_FILE, played)
                unplayed = games
            game = random.choice(unplayed)

            limits = {"easy": 999, "normal": 6, "hard": 3}
            hints_avail = game.get("hints") or []
            # Cap hints_total at 3 for normal mode
            hints_total = min(len(hints_avail), 3) if hints_avail else (0 if mode == "hard" else 0)
            if mode == "easy": hints_total = len(hints_avail) if hints_avail else 0
            if mode == "hard": hints_total = 0

            # Mark as played
            if game.get("title") and game["title"] not in played:
                played.append(game["title"])
                save_json(ARCHIVE_FILE, played)

            # Mark previous session as ended if provided
            if previous_sid:
                prev = get_session(previous_sid)
                if prev and prev.get("status") in ("won", "lost", "playing"):
                    save_session(previous_sid, {"status": "ended", "room_key": ""})

            sid = next_session_id()
            session = {
                "id": sid,
                "game_id": game.get("id", sid),
                "mode": mode, "status": "playing",
                "room_key": room_key,
                "_start_request_id": start_request_id,
                "current_player": "xinxin",
                "xinxin_questions_left": limits.get(mode, 6),
                "azhi_questions_left": limits.get(mode, 6),
                "hints_used": 0, "hints_total": hints_total,
                "questions_log": [],
                "score": None, "score_detail": None,
                "soup_bottom_revealed": False,
                "title": game["title"], "soup_face": game["soup_face"],
                "difficulty": game.get("difficulty", "中等"),
                "soup_bottom": game["soup_bottom"],
                "key_elements": game.get("key_elements", []),
                "hints": hints_avail,
            }
            save_session(sid, session)

            self._json({
                "session_id": sid, "status": "playing",
                "title": game["title"], "difficulty": game.get("difficulty", "中等"),
                "soup_face": game["soup_face"], "mode": mode,
                "xinxin_questions_left": session["xinxin_questions_left"],
                "azhi_questions_left": session["azhi_questions_left"],
                "hints_used": 0, "hints_total": hints_total,
                "questions_log": [],
            })

        elif path.endswith("/ask"):
            sid = body.get("session_id")
            player = body.get("player")        # ④ 校验，不允许缺省
            question = (body.get("question") or "").strip()
            request_id = body.get("request_id") or str(uuid.uuid4())
            source = body.get("source", "unknown")

            if player not in ("xinxin", "azhi"):
                return self._json({"error": "缺少或无效的 player，必须为 xinxin 或 azhi"}, 400)
            if not sid or not question:
                return self._json({"error": "missing session_id or question"}, 400)

            sess = get_session(sid)
            if not sess: return self._json({"error": "session not found"}, 404)

            # ③ 幂等 — 按 request_id 去重
            log = sess.get("questions_log") or []
            if isinstance(log, str):
                try: log = json.loads(log)
                except: log = []
            for entry in log:
                if entry.get("request_id") == request_id:
                    return self._json({
                        "answer": entry["answer"],
                        "xinxin_questions_left": sess["xinxin_questions_left"],
                        "azhi_questions_left": sess["azhi_questions_left"],
                        "duplicate": True
                    })

            # ① 本地合法性判定
            if not is_yes_no_question(question):
                return self._json({
                    "answer": "驳回",
                    "reason": "请用是/否方式提问。例如：'死者是自杀吗？'",
                    "xinxin_questions_left": sess["xinxin_questions_left"],
                    "azhi_questions_left": sess["azhi_questions_left"],
                })

            # ② 主持人回答 — retry, no fallback
            sp = make_system_prompt(sess, log)
            try:
                answer = get_host_answer(sp, question)
            except RuntimeError as e:
                # Don't deduct count, don't log — let player retry
                print(json.dumps({
                    "event": "ask_error", "request_id": request_id,
                    "session_id": sid, "player": player, "source": source,
                    "error": str(e)
                }, ensure_ascii=False))
                return self._json({
                    "error": "主持人暂时无法判断，请重新提交", "retryable": True,
                    "xinxin_questions_left": sess["xinxin_questions_left"],
                    "azhi_questions_left": sess["azhi_questions_left"],
                })

            # Success — deduct count + write log
            key = f"{player}_questions_left"
            new_count = max(0, sess[key] - 1)
            entry = {
                "request_id": request_id, "player": player, "source": source,
                "question": question, "answer": answer,
                "time": time.strftime("%H:%M")
            }
            log.append(entry)

            updates = {
                key: new_count,
                "questions_log": log,
                "current_player": "azhi" if player == "xinxin" else "xinxin"
            }
            save_session(sid, updates)

            print(json.dumps({
                "event": "ask_ok", "request_id": request_id,
                "session_id": sid, "player": player, "source": source,
                "question": question[:80], "answer": answer
            }, ensure_ascii=False))

            resp = {"answer": answer}
            resp["xinxin_questions_left"] = new_count if player == "xinxin" else sess["xinxin_questions_left"]
            resp["azhi_questions_left"] = new_count if player == "azhi" else sess["azhi_questions_left"]
            self._json(resp)

        elif path.endswith("/hint"):
            sid = body.get("session_id")
            if not sid: return self._json({"error": "missing session_id"}, 400)
            sess = get_session(sid)
            if not sess: return self._json({"error": "not found"}, 404)

            player = body.get("player", "xinxin")
            hints = sess.get("hints") or []
            if isinstance(hints, str):
                try: hints = json.loads(hints)
                except: hints = []

            revealed = sess.get("revealed_hints") or []
            idx = len(revealed)
            max_hints = sess.get("hints_total", 0)

            if max_hints <= 0 or idx >= max_hints or idx >= len(hints):
                return self._json({"error": "no hints available"}, 400)

            hint_text = hints[idx]
            entry = {"index": idx + 1, "hint": hint_text, "requested_by": player, "time": time.strftime("%H:%M")}
            revealed.append(entry)
            save_session(sid, {"hints_used": len(revealed), "revealed_hints": revealed})
            self._json({
                "hint": hint_text, "hints_used": len(revealed),
                "hints_total": max_hints,
                "revealed_hints": revealed
            })

        elif path.endswith("/submit"):
            sid = body.get("session_id")
            player = body.get("player", "xinxin")
            if player not in ("xinxin", "azhi"):
                return self._json({"error": "缺少或无效的 player"}, 400)
            answer = (body.get("answer") or "").strip()
            request_id = body.get("request_id") or str(uuid.uuid4())

            if not sid or not answer:
                return self._json({"error": "missing session_id or answer"}, 400)

            sess = get_session(sid)
            if not sess: return self._json({"error": "not found"}, 404)

            # 已提交

            submissions = sess.get("submissions") or {}
            if isinstance(submissions, list): submissions = {}
            if submissions.get(player):
                prev = submissions[player]
                return self._json({
                    "already_submitted": True,
                    "score": prev.get("score"), "rank": prev.get("rank"),
                    "detail": prev.get("score_detail"),
                    "submitted_answer": prev.get("submitted_answer"),
                    "xinxin_questions_left": sess["xinxin_questions_left"],
                    "azhi_questions_left": sess["azhi_questions_left"],
                })

            # 幂等
            if sess.get("_submit_request_id") == request_id and submissions.get(player):
                prev = submissions[player]
                return self._json({
                    "duplicate": True, "score": prev.get("score"), "rank": prev.get("rank"),
                    "detail": prev.get("score_detail"), "submitted_answer": prev.get("submitted_answer"),
                    "xinxin_questions_left": sess["xinxin_questions_left"],
                    "azhi_questions_left": sess["azhi_questions_left"],
                })

            elements = sess.get("key_elements", [])
            if isinstance(elements, str):
                try: elements = json.loads(elements)
                except: elements = []
            el_str = "\n".join(f"- {e}" for e in elements) if elements else "无预设要素"

            sp = f"""你是海龟汤评分员。原汤底：{sess['soup_bottom']}
关键情节要素：{el_str}
评分标准：关键情节命中40%、逻辑连贯30%、细节还原30%。
只返回JSON：{{"key_plot":0-100,"logic":0-100,"detail":0-100,"overall":0-100,"rank":"完全还原/基本还原/部分还原/方向错误","comment":"评语"}}"""
            score_data = None
            for attempt in range(2):
                result = ask_deepseek(sp, f"玩家提交的推理：{answer}")
                result = result.strip()
                result = re.sub(r"^```(?:json)?\s*|\s*```$", "", result, flags=re.MULTILINE)
                try:
                    score_data = json.loads(result)
                    if score_data.get("overall") is not None:
                        break
                except:
                    score_data = None
            if not score_data:
                return self._json({"error": "评分暂时不可用，请重新提交", "retryable": True,
                    "xinxin_questions_left": sess["xinxin_questions_left"],
                    "azhi_questions_left": sess["azhi_questions_left"]})

            overall = score_data.get("overall", 50)
            key = f"{player}_questions_left"
            submissions[player] = {
                "submitted_answer": answer, "score": overall, "rank": score_data.get("rank", "部分还原"),
                "score_detail": score_data, "comment": score_data.get("comment", ""),
                "submitted_at": time.strftime("%H:%M")
            }
            updates = {
                key: 0,
                "score": overall,
                "score_detail": score_data,
                "submissions": submissions,
                "_submit_request_id": request_id,
                "status": "won" if overall >= 90 else sess.get("status", "playing")
            }
            save_session(sid, updates)

            azhi_key = "azhi_questions_left" if player == "xinxin" else "xinxin_questions_left"
            resp = {
                "score": overall,
                "rank": score_data.get("rank", "部分还原"),
                "detail": {
                    "key_plot": score_data.get("key_plot", 50),
                    "logic": score_data.get("logic", 50),
                    "detail": score_data.get("detail", 50)
                },
                "status": "won" if overall >= 90 else "playing",
                "can_reveal": True,
            }
            resp[key] = 0
            resp[azhi_key] = sess.get(azhi_key, 0)
            self._json(resp)

        elif path.endswith("/reveal"):
            sid = body.get("session_id")
            if not sid: return self._json({"error": "missing session_id"}, 400)
            sess = get_session(sid)
            if not sess: return self._json({"error": "not found"}, 404)
            final_status = "won" if (sess.get("score") or 0) >= 90 else "lost"
            save_session(sid, {"soup_bottom_revealed": True, "status": final_status})
            self._json({
                "session_id": sid,
                "soup_bottom": sess["soup_bottom"],
                "soup_bottom_revealed": True,
                "status": final_status
            })

        elif path.endswith("/activate"):
            # Update room pointer to a specific session
            sid = body.get("session_id")
            room_key = body.get("room_key", "orbis-main")
            if not sid: return self._json({"error": "missing session_id"}, 400)
            sess = get_session(sid)
            if not sess: return self._json({"error": "session not found"}, 404)
            save_session(sid, {"room_key": room_key})
            self._json({"activated": True, "session_id": sid, "room_key": room_key})

        elif path.endswith("/abandon"):
            # Mark session as abandoned, release room
            sid = body.get("session_id")
            if not sid: return self._json({"error": "missing session_id"}, 400)
            sess = get_session(sid)
            if not sess: return self._json({"error": "not found"}, 404)
            save_session(sid, {"status": "abandoned", "room_key": ""})
            self._json({"abandoned": True, "session_id": sid, "status": "abandoned"})

        else:
            self._json({"error": "not found"}, 404)

    def do_GET(self):
        path = self.path.rstrip("/")
        if "/active" in path:
            qs = path.split("?")[-1] if "?" in path else ""
            room_key = None
            for p in qs.split("&"):
                if "=" in p and p.split("=")[0] == "room_key":
                    room_key = p.split("=")[1]
            if not room_key:
                return self._json({"error": "missing room_key"}, 400)
            active = None
            # Find session by room_key — include won/lost (for settlement display), exclude abandoned
            for s in reversed(load_sessions()):
                if s.get("room_key") == room_key and s.get("status") not in ("abandoned",):
                    active = s
                    break
            if not active:
                return self._json({"active": False, "message": "no active game in this room"})
            self._json({
                "active": True,
                "session_id": active["id"],
                "title": active.get("title","?"),
                "difficulty": active.get("difficulty","?"),
                "mode": active.get("mode","normal"),
                "status": active.get("status","playing"),
            })

        elif "/status" in path:
            qs = path.split("?")[-1] if "?" in path else ""
            sid = None
            for p in qs.split("&"):
                if "=" in p and p.split("=")[0] == "session_id":
                    sid = int(p.split("=")[1])
            if not sid:
                return self._json({"error": "missing session_id"}, 400)
            sess = get_session(sid)
            if not sess: return self._json({"error": "not found"}, 404)
            sub_raw = sess.get("submissions") or {}
            if isinstance(sub_raw, list): sub_raw = {}
            self._json({
                "session_id": sid,
                "status": sess.get("status", "playing"),
                "title": sess.get("title", "?"),
                "soup_face": sess.get("soup_face", "?"),
                "difficulty": sess.get("difficulty", "?"),
                "mode": sess.get("mode", "normal"),
                "xinxin_questions_left": sess.get("xinxin_questions_left", 0),
                "azhi_questions_left": sess.get("azhi_questions_left", 0),
                "hints_used": sess.get("hints_used", 0),
                "hints_total": sess.get("hints_total", 0),
                "revealed_hints": sess.get("revealed_hints") or [],
                "questions_log": sess.get("questions_log") or [],
                "submissions": sub_raw,
                "score": sess.get("score"),
                "score_detail": sess.get("score_detail"),
                "soup_bottom_revealed": sess.get("soup_bottom_revealed", False),
                "soup_bottom": sess["soup_bottom"] if sess.get("soup_bottom_revealed") else None,
            })
        elif path == "/health":
            self._json({"status": "ok"})
        else:
            self._json({"error": "not found"}, 404)

    def log_message(self, *args): pass

if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
