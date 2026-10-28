#!/usr/bin/env python3
"""Portable local REST server for the cooperative Turtle Soup game."""

from __future__ import annotations

import json
import os
import random
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlsplit

from judge import JudgeError, create_judge


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
SAMPLE_SOUPS_PATH = PROJECT_ROOT / "samples" / "sample_soups.json"

REST_HOST = os.environ.get("REST_HOST", "127.0.0.1")
REST_PORT = int(os.environ.get("REST_PORT", os.environ.get("TURTLE_PORT", "8777")))
DEFAULT_ROOM_KEY = os.environ.get("TURTLE_ROOM_KEY", "haiguitang-main")
HUMAN_PLAYER_ID = "xinxin"
AI_PLAYER_ID = os.environ.get("AI_PLAYER_ID", "azhi")
PLAYER_IDS = {HUMAN_PLAYER_ID, AI_PLAYER_ID}
DATA_DIR = Path(os.environ.get("TURTLE_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser()
SOUP_DATA_PATH = Path(
    os.environ.get("SOUP_DATA_PATH", str(DATA_DIR / "private" / "soups.json"))
).expanduser()
SESSIONS_FILE = Path(
    os.environ.get("SESSION_DATA_PATH", str(DATA_DIR / "sessions.json"))
).expanduser()
ARCHIVE_FILE = Path(
    os.environ.get("ARCHIVE_DATA_PATH", str(DATA_DIR / "played_games.json"))
).expanduser()

STATE_LOCK = threading.RLock()


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_json(path: Path, default):
    with STATE_LOCK:
        if not path.exists():
            return default
        content = path.read_text(encoding="utf-8").strip()
        return json.loads(content) if content else default


def save_json(path: Path, data) -> None:
    with STATE_LOCK:
        _ensure_parent(path)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(data, output, ensure_ascii=False, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def load_games() -> list[dict]:
    """Use a configured private library, otherwise the five repository samples."""
    configured = load_json(SOUP_DATA_PATH, []) if SOUP_DATA_PATH.exists() else []
    return configured or load_json(SAMPLE_SOUPS_PATH, [])


def load_sessions() -> list[dict]:
    return load_json(SESSIONS_FILE, [])


def save_session(session_id, updates: dict) -> dict:
    with STATE_LOCK:
        sessions = load_sessions()
        for index, session in enumerate(sessions):
            if session.get("id") == session_id:
                sessions[index] = {**session, **updates}
                save_json(SESSIONS_FILE, sessions)
                return sessions[index]
        created = {**updates, "id": session_id}
        sessions.append(created)
        save_json(SESSIONS_FILE, sessions)
        return created


def get_session(session_id) -> dict | None:
    with STATE_LOCK:
        return next((item for item in load_sessions() if item.get("id") == session_id), None)


def _next_session_id(sessions: list[dict]) -> int:
    return max([item.get("id", 0) for item in sessions] or [0]) + 1


def _question_counts(session: dict) -> dict:
    return {
        f"{HUMAN_PLAYER_ID}_questions_left": session.get(
            f"{HUMAN_PLAYER_ID}_questions_left", 0
        ),
        f"{AI_PLAYER_ID}_questions_left": session.get(
            f"{AI_PLAYER_ID}_questions_left", 0
        ),
    }


def _safe_submissions(session: dict) -> dict:
    submissions = session.get("submissions") or {}
    return submissions if isinstance(submissions, dict) else {}


def public_state(session: dict) -> dict:
    revealed = session.get("soup_bottom_revealed") is True
    result = {
        "session_id": session["id"],
        "status": session.get("status", "playing"),
        "title": session.get("title", "?"),
        "soup_face": session.get("soup_face", "?"),
        "difficulty": session.get("difficulty", "?"),
        "mode": session.get("mode", "normal"),
        "current_player": session.get("current_player"),
        **_question_counts(session),
        "hints_used": session.get("hints_used", 0),
        "hints_total": session.get("hints_total", 0),
        "revealed_hints": session.get("revealed_hints") or [],
        "questions_log": session.get("questions_log") or [],
        "submissions": _safe_submissions(session),
        "score": session.get("score"),
        "score_detail": session.get("score_detail"),
        "soup_bottom_revealed": revealed,
    }
    if revealed:
        result["soup_bottom"] = session["soup_bottom"]
    return result


def _judge_error_payload(error: JudgeError) -> dict:
    return {"error": error.public_message, "error_code": error.code, "retryable": True}


def _log_judge_error(action: str, session_id, request_id: str, error: JudgeError) -> None:
    # Only sanitized metadata is logged. Never log prompts, key elements, or provider bodies.
    print(
        json.dumps(
            {
                "event": f"judge_{action}_error",
                "session_id": session_id,
                "request_id": request_id,
                "error_code": error.code,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "Haiguitang/2"

    def _json(self, data, code: int = 200) -> None:
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(encoded)

    def _body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            parsed = json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(parsed, dict):
                raise ValueError("body is not an object")
            return parsed
        except (ValueError, json.JSONDecodeError):
            self._json({"error": "请求 JSON 格式无效"}, 400)
            return None

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        body = self._body()
        if body is None:
            return
        path = urlsplit(self.path).path.rstrip("/")
        if path.endswith("/start"):
            return self._start(body)
        if path.endswith("/ask"):
            return self._ask(body)
        if path.endswith("/hint"):
            return self._hint(body)
        if path.endswith("/submit"):
            return self._submit(body)
        if path.endswith("/reveal"):
            return self._reveal(body)
        if path.endswith("/activate"):
            return self._activate(body)
        if path.endswith("/abandon"):
            return self._abandon(body)
        self._json({"error": "not found"}, 404)

    def _start(self, body: dict) -> None:
        mode = body.get("mode", "normal")
        if mode not in {"easy", "normal", "hard"}:
            return self._json({"error": "invalid mode"}, 400)
        room_key = str(body.get("room_key", DEFAULT_ROOM_KEY))
        reuse_active = body.get("reuse_active") is True
        force_new = body.get("force_new") is True
        request_id = str(body.get("request_id", ""))
        previous_id = body.get("previous_session_id")
        games = load_games()
        if not games:
            return self._json({"error": "no games loaded"}, 500)

        with STATE_LOCK:
            sessions = load_sessions()
            if force_new and request_id:
                duplicate = next((s for s in sessions if s.get("_start_request_id") == request_id), None)
                if duplicate:
                    response = public_state(duplicate)
                    response.update({"reused": True, "duplicate": True})
                    return self._json(response)
            if not force_new and reuse_active and room_key:
                active = next((s for s in reversed(sessions) if s.get("room_key") == room_key and s.get("status") == "playing"), None)
                if active:
                    response = public_state(active)
                    response["reused"] = True
                    return self._json(response)

            played = load_json(ARCHIVE_FILE, [])
            unplayed = [game for game in games if game.get("title") not in played]
            if not unplayed:
                played = []
                unplayed = games
            game = random.choice(unplayed)
            if game.get("title") and game["title"] not in played:
                played.append(game["title"])
                save_json(ARCHIVE_FILE, played)
            if previous_id:
                previous = next((s for s in sessions if s.get("id") == previous_id), None)
                if previous and previous.get("status") in {"won", "lost", "playing"}:
                    previous.update({"status": "ended", "room_key": ""})

            limits = {"easy": 999, "normal": 6, "hard": 3}
            hints = game.get("hints") or []
            hints_total = 0 if mode == "hard" else (len(hints) if mode == "easy" else min(len(hints), 3))
            session_id = _next_session_id(sessions)
            session = {
                "id": session_id,
                "game_id": game.get("id", session_id),
                "mode": mode,
                "status": "playing",
                "room_key": room_key,
                "_start_request_id": request_id,
                "current_player": HUMAN_PLAYER_ID,
                f"{HUMAN_PLAYER_ID}_questions_left": limits[mode],
                f"{AI_PLAYER_ID}_questions_left": limits[mode],
                "hints_used": 0,
                "hints_total": hints_total,
                "revealed_hints": [],
                "questions_log": [],
                "submissions": {},
                "score": None,
                "score_detail": None,
                "soup_bottom_revealed": False,
                "title": game["title"],
                "soup_face": game["soup_face"],
                "difficulty": game.get("difficulty", "中等"),
                "soup_bottom": game["soup_bottom"],
                "key_elements": game.get("key_elements", []),
                "hints": hints,
            }
            sessions.append(session)
            save_json(SESSIONS_FILE, sessions)
        self._json(public_state(session))

    def _ask(self, body: dict) -> None:
        session_id = body.get("session_id")
        player = body.get("player")
        question = str(body.get("question") or "").strip()
        request_id = str(body.get("request_id") or uuid.uuid4())
        if player not in PLAYER_IDS:
            return self._json({"error": "缺少或无效的 player"}, 400)
        if not session_id or not question:
            return self._json({"error": "missing session_id or question"}, 400)
        session = get_session(session_id)
        if not session:
            return self._json({"error": "session not found"}, 404)
        for entry in session.get("questions_log") or []:
            if entry.get("request_id") == request_id:
                return self._json({"answer": entry["answer"], **_question_counts(session), "duplicate": True})
        try:
            answer = create_judge().ask(session["soup_bottom"], question)
        except JudgeError as error:
            _log_judge_error("ask", session_id, request_id, error)
            return self._json({**_judge_error_payload(error), **_question_counts(session)}, error.status)

        with STATE_LOCK:
            session = get_session(session_id)
            if not session:
                return self._json({"error": "session not found"}, 404)
            log = session.get("questions_log") or []
            for entry in log:
                if entry.get("request_id") == request_id:
                    return self._json({"answer": entry["answer"], **_question_counts(session), "duplicate": True})
            if answer == "驳回":
                return self._json({"answer": answer, "reason": "请改成可依据汤底判断的问题。", **_question_counts(session)})
            counter = f"{player}_questions_left"
            remaining = max(0, int(session.get(counter, 0)) - 1)
            log.append({"request_id": request_id, "player": player, "source": str(body.get("source", "unknown")), "question": question, "answer": answer, "time": time.strftime("%H:%M")})
            updated = save_session(session_id, {counter: remaining, "questions_log": log, "current_player": AI_PLAYER_ID if player == HUMAN_PLAYER_ID else HUMAN_PLAYER_ID})
        self._json({"answer": answer, **_question_counts(updated)})

    def _hint(self, body: dict) -> None:
        session_id = body.get("session_id")
        if not session_id:
            return self._json({"error": "missing session_id"}, 400)
        with STATE_LOCK:
            session = get_session(session_id)
            if not session:
                return self._json({"error": "not found"}, 404)
            hints = session.get("hints") or []
            revealed = session.get("revealed_hints") or []
            index = len(revealed)
            maximum = session.get("hints_total", 0)
            if maximum <= 0 or index >= maximum or index >= len(hints):
                return self._json({"error": "no hints available"}, 400)
            entry = {"index": index + 1, "hint": hints[index], "requested_by": body.get("player", "xinxin"), "time": time.strftime("%H:%M")}
            revealed.append(entry)
            save_session(session_id, {"hints_used": len(revealed), "revealed_hints": revealed})
        self._json({"hint": hints[index], "hints_used": len(revealed), "hints_total": maximum, "revealed_hints": revealed})

    def _submit(self, body: dict) -> None:
        session_id = body.get("session_id")
        player = body.get("player", "xinxin")
        answer = str(body.get("answer") or "").strip()
        request_id = str(body.get("request_id") or uuid.uuid4())
        if player not in PLAYER_IDS:
            return self._json({"error": "缺少或无效的 player"}, 400)
        if not session_id or not answer:
            return self._json({"error": "missing session_id or answer"}, 400)
        session = get_session(session_id)
        if not session:
            return self._json({"error": "not found"}, 404)
        submissions = _safe_submissions(session)
        if player in submissions:
            previous = submissions[player]
            return self._json({"already_submitted": True, "score": previous["score"], "rank": previous["rank"], "detail": previous["score_detail"], **_question_counts(session)}, 409)
        try:
            score = create_judge().submit(session["soup_bottom"], list(session.get("key_elements") or []), answer)
        except JudgeError as error:
            _log_judge_error("submit", session_id, request_id, error)
            return self._json({**_judge_error_payload(error), **_question_counts(session)}, error.status)

        with STATE_LOCK:
            session = get_session(session_id)
            if not session:
                return self._json({"error": "not found"}, 404)
            submissions = _safe_submissions(session)
            if player in submissions:
                previous = submissions[player]
                return self._json({"duplicate": True, "score": previous["score"], "rank": previous["rank"], "detail": previous["score_detail"], **_question_counts(session)})
            submission = {"submitted_answer": answer, "score": score["overall"], "rank": score["rank"], "score_detail": score, "comment": score["comment"], "request_id": request_id, "submitted_at": time.strftime("%H:%M")}
            submissions[player] = submission
            status = "won" if score["overall"] >= 90 else session.get("status", "playing")
            counter = f"{player}_questions_left"
            updated = save_session(session_id, {counter: 0, "score": score["overall"], "score_detail": score, "submissions": submissions, "status": status})
        self._json({"score": score["overall"], "rank": score["rank"], "detail": {key: score[key] for key in ("key_plot", "logic", "detail")}, "comment": score["comment"], "status": status, "can_reveal": True, "soup_bottom_revealed": False, **_question_counts(updated)})

    def _reveal(self, body: dict) -> None:
        session_id = body.get("session_id")
        if not session_id:
            return self._json({"error": "missing session_id"}, 400)
        session = get_session(session_id)
        if not session:
            return self._json({"error": "not found"}, 404)
        final_status = "won" if (session.get("score") or 0) >= 90 else "lost"
        save_session(session_id, {"soup_bottom_revealed": True, "status": final_status})
        self._json({"session_id": session_id, "soup_bottom": session["soup_bottom"], "soup_bottom_revealed": True, "status": final_status})

    def _activate(self, body: dict) -> None:
        session_id = body.get("session_id")
        if not session_id:
            return self._json({"error": "missing session_id"}, 400)
        if not get_session(session_id):
            return self._json({"error": "session not found"}, 404)
        room_key = str(body.get("room_key", DEFAULT_ROOM_KEY))
        save_session(session_id, {"room_key": room_key})
        self._json({"activated": True, "session_id": session_id, "room_key": room_key})

    def _abandon(self, body: dict) -> None:
        session_id = body.get("session_id")
        if not session_id:
            return self._json({"error": "missing session_id"}, 400)
        if not get_session(session_id):
            return self._json({"error": "not found"}, 404)
        save_session(session_id, {"status": "abandoned", "room_key": ""})
        self._json({"abandoned": True, "session_id": session_id, "status": "abandoned"})

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)
        if path.endswith("/health"):
            return self._json({"status": "ok"})
        if path.endswith("/active"):
            room_key = (query.get("room_key") or [""])[0]
            if not room_key:
                return self._json({"error": "missing room_key"}, 400)
            active = next((item for item in reversed(load_sessions()) if item.get("room_key") == room_key and item.get("status") != "abandoned"), None)
            if not active:
                return self._json({"active": False, "message": "no active game in this room"})
            return self._json({"active": True, "session_id": active["id"], "title": active.get("title", "?"), "difficulty": active.get("difficulty", "?"), "mode": active.get("mode", "normal"), "status": active.get("status", "playing")})
        if path.endswith("/status"):
            raw_id = (query.get("session_id") or [""])[0]
            try:
                session_id = int(raw_id)
            except ValueError:
                return self._json({"error": "missing session_id"}, 400)
            session = get_session(session_id)
            if not session:
                return self._json({"error": "not found"}, 404)
            return self._json(public_state(session))
        self._json({"error": "not found"}, 404)

    def log_message(self, _format, *args) -> None:
        return


def run() -> None:
    _ensure_parent(SESSIONS_FILE)
    _ensure_parent(ARCHIVE_FILE)
    server = ThreadingHTTPServer((REST_HOST, REST_PORT), Handler)
    print(f"Haiguitang REST listening on http://{REST_HOST}:{server.server_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    run()
