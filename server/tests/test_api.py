import contextlib
import concurrent.futures
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock


SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

import turtlesoup_server as app  # noqa: E402


class MockJudge:
    def ask(self, soup_bottom, question):
        return "是"

    def submit(self, soup_bottom, key_elements, answer):
        return {
            "key_plot": 88,
            "logic": 84,
            "detail": 80,
            "overall": 85,
            "rank": "基本还原",
            "comment": "测试评分",
        }


class ApiPrivacyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        app.DATA_DIR = root
        app.SOUP_DATA_PATH = root / "missing-private-soups.json"
        app.SESSIONS_FILE = root / "sessions.json"
        app.ARCHIVE_FILE = root / "played.json"
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        cls.temp.cleanup()

    def setUp(self):
        for path in (app.SESSIONS_FILE, app.ARCHIVE_FILE):
            if path.exists():
                path.unlink()

    def request(self, path, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            response = urllib.request.urlopen(request, timeout=3)
            return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def start(self):
        status, payload = self.request(
            "/start",
            {"mode": "normal", "room_key": "test-room", "request_id": "start-1"},
        )
        self.assertEqual(status, 200)
        return payload

    def assert_private(self, payload, secrets):
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("key_elements", serialized)
        self.assertNotIn("judge prompt", serialized)
        self.assertNotIn("provider raw", serialized)
        for secret in secrets:
            self.assertNotIn(secret, serialized)

    def test_health_start_and_sample_fallback(self):
        status, health = self.request("/health")
        self.assertEqual((status, health), (200, {"status": "ok"}))
        self.assertEqual(len(app.load_games()), 5)
        started = self.start()
        self.assertEqual(started["status"], "playing")
        self.assertFalse(started["soup_bottom_revealed"])
        self.assertNotIn("soup_bottom", started)

    def test_private_until_explicit_reveal_then_status_restores_bottom(self):
        started = self.start()
        session_id = started["session_id"]
        stored = app.get_session(session_id)
        secrets = [stored["soup_bottom"], *stored["key_elements"]]

        endpoints = [
            started,
            self.request(f"/status?session_id={session_id}")[1],
            self.request("/active?room_key=test-room")[1],
            self.request("/activate", {"session_id": session_id, "room_key": "test-room"})[1],
            self.request("/hint", {"session_id": session_id, "player": "xinxin"})[1],
        ]
        with mock.patch.object(app, "create_judge", return_value=MockJudge()):
            endpoints.append(
                self.request(
                    "/ask",
                    {"session_id": session_id, "player": "xinxin", "question": "这是真的吗？", "request_id": "ask-1"},
                )[1]
            )
            endpoints.append(
                self.request(
                    "/submit",
                    {"session_id": session_id, "player": "xinxin", "answer": "测试推理", "request_id": "submit-1"},
                )[1]
            )
        endpoints.append(self.request(f"/status?session_id={session_id}")[1])
        for payload in endpoints:
            self.assert_private(payload, secrets)

        another = self.request(
            "/start",
            {"mode": "normal", "room_key": "abandon-room", "force_new": True, "request_id": "start-abandon"},
        )[1]
        abandoned = self.request("/abandon", {"session_id": another["session_id"]})[1]
        self.assert_private(abandoned, secrets)

        status, revealed = self.request("/reveal", {"session_id": session_id, "request_id": "reveal-1"})
        self.assertEqual(status, 200)
        self.assertTrue(revealed["soup_bottom_revealed"])
        self.assertEqual(revealed["soup_bottom"], stored["soup_bottom"])
        refreshed = self.request(f"/status?session_id={session_id}")[1]
        self.assertTrue(refreshed["soup_bottom_revealed"])
        self.assertEqual(refreshed["soup_bottom"], stored["soup_bottom"])
        self.assertTrue(app.get_session(session_id)["soup_bottom_revealed"])

    def test_unconfigured_judge_error_and_log_do_not_leak(self):
        started = self.start()
        session_id = started["session_id"]
        stored = app.get_session(session_id)
        secret = stored["soup_bottom"]
        cleared = {
            "JUDGE_API_URL": "",
            "JUDGE_API_KEY": "",
            "JUDGE_MODEL": "",
            "DEEPSEEK_API_URL": "",
            "DEEPSEEK_API_KEY": "",
        }
        output = io.StringIO()
        with mock.patch.dict(os.environ, cleared, clear=False), contextlib.redirect_stdout(output):
            status, payload = self.request(
                "/ask",
                {"session_id": session_id, "player": "xinxin", "question": "这是测试吗？", "request_id": "missing-config"},
            )
        self.assertEqual(status, 503)
        self.assertEqual(payload["error_code"], "not_configured")
        combined = json.dumps(payload, ensure_ascii=False) + output.getvalue()
        self.assertNotIn(secret, combined)
        self.assertNotIn("key_elements", combined)
        self.assertNotIn("provider", combined.lower())

    def test_concurrent_requests_do_not_lose_session_updates(self):
        session_id = self.start()["session_id"]

        def ask(request_id):
            return self.request(
                "/ask",
                {
                    "session_id": session_id,
                    "player": "xinxin",
                    "question": f"并发问题 {request_id} 吗？",
                    "request_id": request_id,
                },
            )

        with mock.patch.object(app, "create_judge", return_value=MockJudge()):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(ask, ("concurrent-1", "concurrent-2")))
        self.assertEqual([status for status, _ in results], [200, 200])
        state = self.request(f"/status?session_id={session_id}")[1]
        self.assertEqual(state["xinxin_questions_left"], 4)
        self.assertEqual(len(state["questions_log"]), 2)

    def test_configurable_ai_player_id(self):
        with (
            mock.patch.object(app, "AI_PLAYER_ID", "local-ai"),
            mock.patch.object(app, "PLAYER_IDS", {"xinxin", "local-ai"}),
        ):
            started = self.request(
                "/start",
                {
                    "mode": "normal",
                    "room_key": "custom-ai-room",
                    "force_new": True,
                    "request_id": "custom-ai-start",
                },
            )[1]
            with mock.patch.object(app, "create_judge", return_value=MockJudge()):
                status, response = self.request(
                    "/ask",
                    {
                        "session_id": started["session_id"],
                        "player": "local-ai",
                        "question": "自定义 AI 可以提问吗？",
                        "request_id": "custom-ai-ask",
                    },
                )
            self.assertEqual(status, 200)
            self.assertEqual(response["local-ai_questions_left"], 5)


if __name__ == "__main__":
    unittest.main()
