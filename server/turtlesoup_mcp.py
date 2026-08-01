#!/usr/bin/env python3
"""Haiguitang MCP — wraps game API for AI access (open source version)"""
import json, uuid, urllib.request
from mcp.server.fastmcp import FastMCP

GAME_API = "http://127.0.0.1:8777"  # 改成你的后端地址
PORT = 8778

AI_PLAY_NOTICE = """双人共猜规则：这是双人共猜推理游戏，不是单机解题。
1. 每次回复最多执行一个改变状态的操作
2. 拿到结果后必须回到对话讨论，与用户商量下一步
3. 提示、提交、揭底、放弃和下一题：必须先得到用户明确同意
4. 先查 status/current，再决定是否开局
5. 用"你/我"称呼，不要用第三人称指代当前用户"""

AI_BRAKE_ASK = (
    "【协作暂停｜仅给AI】本次提问已经得到主持人回答。"
    "请先向人类搭档复述'问题+回答'，说出一句当前判断，并邀请讨论。"
    "本条回复内不得再次调用haiguitang_ask，也不得自行使用提示/提交/揭底/下一题。"
    "等待对方发来下一条消息后再继续游戏。"
)
AI_BRAKE_REJECTED = (
    "【协作暂停｜仅给AI】问题被驳回。先把驳回原因告诉人类搭档，"
    "一起改写问题；本条回复内不要自行连续重试。"
)
AI_BRAKE_HINT = (
    "【协作暂停｜仅给AI】提示已获取。先把提示内容告诉人类搭档，讨论。"
    "本条回复内不要再做其他操作。"
)
AI_BRAKE_SUBMIT = (
    "【协作暂停｜仅给AI】推理已提交并评分。把结果告诉人类搭档，"
    "问对方是否要查看汤底或提交自己的推理。不要再自行操作。"
)

def inject_brake(result, brake_text, action="WAIT_FOR_HUMAN"):
    """Add AI-only discussion reminder. Never visible to human frontend."""
    if isinstance(result, dict):
        result["ai_only_instruction"] = brake_text
        result["next_action"] = action
        result["must_stop_this_turn"] = True
    return result

mcp = FastMCP(
    "haiguitang-mcp",
    host="0.0.0.0",
    port=PORT,
    streamable_http_path="/",
    instructions=AI_PLAY_NOTICE
)

def game_post(path, body):
    if "player" not in body:
        body["player"] = "azhi"
    body.setdefault("source", "rikkahub-mcp")
    body.setdefault("request_id", str(uuid.uuid4()))
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{GAME_API}/{path}", data=data,
        headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())

def game_get(path):
    resp = urllib.request.urlopen(f"{GAME_API}/{path}", timeout=10)
    data = json.loads(resp.read())
    if isinstance(data, dict) and path.startswith(("status", "active")):
        data["_ai_play_notice_version"] = "1.0"
        data["_ai_play_notice"] = "共同推理优先；一次只做一个动作，随后回到对话；提示/提交/揭底/下一题先确认。"
    return data

@mcp.tool(description="向海龟汤主持人提出一个是否问题。每次调用后必须停止本轮工具调用，把结果告诉人类搭档并等待讨论；不得在同一条助手回复中连续提问。")
def haiguitang_ask(session_id: int, question: str) -> str:
    result = game_post("ask", {"session_id": session_id, "player": "azhi", "question": question})
    result = inject_brake(result, AI_BRAKE_REJECTED if result.get("answer") == "驳回" else AI_BRAKE_ASK)
    return json.dumps(result, ensure_ascii=False, indent=2)

@mcp.tool(description="请求下一条提示。每次调用后必须停止本轮工具调用，把提示告诉人类搭档并讨论；不得自行连续请求。")
def haiguitang_hint(session_id: int) -> str:
    result = game_post("hint", {"session_id": session_id})
    return json.dumps(inject_brake(result, AI_BRAKE_HINT), ensure_ascii=False, indent=2)

@mcp.tool(description="提交最终推理（孤注一掷）。提交后必须停止本轮工具调用，把评分告诉人类搭档；不得自行继续操作。")
def haiguitang_submit(session_id: int, answer: str) -> str:
    result = game_post("submit", {"session_id": session_id, "player": "azhi", "answer": answer})
    return json.dumps(inject_brake(result, AI_BRAKE_SUBMIT), ensure_ascii=False, indent=2)

@mcp.tool(description="公布汤底（必须先得到人类搭档同意）。揭底后游戏结束，不得再操作本局。")
def haiguitang_reveal(session_id: int) -> str:
    result = game_post("reveal", {"session_id": session_id})
    result = inject_brake(result, "【协作暂停｜仅给AI】汤底已公布。把答案告诉人类搭档。游戏结束。不要继续操作本局。")
    return json.dumps(result, ensure_ascii=False, indent=2)

@mcp.tool()
def haiguitang_status(session_id: int) -> str:
    result = game_get(f"status?session_id={session_id}")
    return json.dumps(result, ensure_ascii=False, indent=2)

@mcp.tool()
def haiguitang_start(mode: str = "normal", force_new: bool = False, room_key: str = "haiguitang-main") -> str:
    result = game_post("start", {"mode": mode, "room_key": room_key, "reuse_active": True, "force_new": force_new})
    return json.dumps(result, ensure_ascii=False, indent=2)

@mcp.tool()
def haiguitang_next(mode: str = "normal", previous_session_id: int = 0, room_key: str = "haiguitang-main") -> str:
    body = {"mode": mode, "room_key": room_key, "reuse_active": False, "force_new": True}
    if previous_session_id: body["previous_session_id"] = previous_session_id
    return json.dumps(game_post("start", body), ensure_ascii=False, indent=2)

@mcp.tool()
def haiguitang_current(room_key: str = "haiguitang-main") -> str:
    result = game_get(f"active?room_key={room_key}")
    return json.dumps(result, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
