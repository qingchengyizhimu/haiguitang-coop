import io
import json
import socket
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from judge import JudgeClient, JudgeConfig, JudgeError  # noqa: E402


class CapturingJudge(JudgeClient):
    def __init__(self, responses):
        super().__init__(JudgeConfig("https://judge.invalid/v1/chat/completions", "test-key", "test-model"))
        self.responses = iter(responses)
        self.calls = []

    def _complete(self, system_prompt, user_message, max_tokens):
        self.calls.append((system_prompt, user_message, max_tokens))
        return next(self.responses)


class JudgeConfigTests(unittest.TestCase):
    def test_judge_configuration_takes_precedence(self):
        config = JudgeConfig.from_env(
            {
                "JUDGE_API_URL": "https://judge.example/v1/chat/completions",
                "JUDGE_API_KEY": "judge-key",
                "JUDGE_MODEL": "judge-model",
                "DEEPSEEK_API_URL": "https://legacy.invalid",
                "DEEPSEEK_API_KEY": "legacy-key",
            }
        )
        self.assertEqual(config.api_key, "judge-key")
        self.assertEqual(config.model, "judge-model")
        self.assertFalse(config.legacy_deepseek)

    def test_legacy_deepseek_configuration(self):
        config = JudgeConfig.from_env({"DEEPSEEK_API_KEY": "legacy-key"})
        self.assertEqual(config.api_url, "https://api.deepseek.com/v1/chat/completions")
        self.assertEqual(config.model, "deepseek-chat")
        self.assertTrue(config.legacy_deepseek)

    def test_missing_configuration_is_explicit(self):
        client = JudgeClient(JudgeConfig.from_env({}))
        with self.assertRaisesRegex(JudgeError, "JUDGE_API_URL") as caught:
            client.ask("secret soup", "question")
        self.assertEqual(caught.exception.code, "not_configured")


class JudgeValidationTests(unittest.TestCase):
    def test_each_ask_has_isolated_context(self):
        judge = CapturingJudge(['{"answer":"是"}', '{"answer":"否"}'])
        self.assertEqual(judge.ask("bottom one", "first question"), "是")
        self.assertEqual(judge.ask("bottom two", "second question"), "否")
        self.assertEqual(len(judge.calls), 2)
        self.assertNotIn("first question", judge.calls[1][0])
        self.assertNotIn("first question", judge.calls[1][1])
        self.assertNotIn("bottom one", judge.calls[1][0])

    def test_ask_and_submit_do_not_share_context(self):
        score = {
            "key_plot": 80,
            "logic": 80,
            "detail": 80,
            "overall": 80,
            "rank": "基本还原",
            "comment": "ok",
        }
        judge = CapturingJudge(['{"answer":"是"}', json.dumps(score, ensure_ascii=False)])
        judge.ask("first bottom", "first player question")
        judge.submit("second bottom", ["second element"], "second submission")
        submit_prompt, submit_message, _ = judge.calls[1]
        self.assertNotIn("first bottom", submit_prompt)
        self.assertNotIn("first player question", submit_prompt)
        self.assertNotIn("first player question", submit_message)

    def test_ask_whitelist(self):
        for answer in ("是", "否", "无关", "部分相关", "驳回"):
            with self.subTest(answer=answer):
                judge = CapturingJudge([json.dumps({"answer": answer, "provider_note": "discard"}, ensure_ascii=False)])
                self.assertEqual(judge.ask("bottom", "question"), answer)
        judge = CapturingJudge(['{"answer":"是也不是"}'])
        with self.assertRaises(JudgeError):
            judge.ask("bottom", "question")

    def test_submit_strict_structure_and_range(self):
        valid = {
            "key_plot": 90,
            "logic": 80,
            "detail": 70,
            "overall": 82,
            "rank": "基本还原",
            "comment": "方向正确",
            "provider_secret": "discard",
        }
        result = CapturingJudge([json.dumps(valid, ensure_ascii=False)]).submit("bottom", ["element"], "answer")
        self.assertEqual(set(result), {"key_plot", "logic", "detail", "overall", "rank", "comment"})
        self.assertNotEqual(result["comment"], valid["comment"])
        self.assertNotIn("provider_secret", result)
        for invalid in (
            {**valid, "overall": 101},
            {**valid, "logic": 2.5},
            {**valid, "rank": "神秘等级"},
            {**valid, "overall": 20, "rank": "基本还原"},
            {key: value for key, value in valid.items() if key != "detail"},
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(JudgeError):
                    CapturingJudge([json.dumps(invalid, ensure_ascii=False)]).submit("bottom", [], "answer")

    def test_timeout_provider_error_and_malformed_json_are_sanitized(self):
        client = JudgeClient(JudgeConfig("https://judge.invalid", "secret-key", "model", 1))
        cases = [
            (socket.timeout("provider timeout detail"), "timeout"),
            (
                urllib.error.HTTPError(
                    "https://judge.invalid", 500, "provider-secret-message", {}, io.BytesIO(b"raw-secret-body")
                ),
                "provider_error",
            ),
        ]
        for error, expected_code in cases:
            with self.subTest(expected_code=expected_code), mock.patch("urllib.request.urlopen", side_effect=error):
                with self.assertRaises(JudgeError) as caught:
                    client.ask("bottom-secret", "question")
                self.assertEqual(caught.exception.code, expected_code)
                self.assertNotIn("secret", caught.exception.public_message)

        fake_response = mock.MagicMock()
        fake_response.__enter__.return_value.read.return_value = b"not-json"
        with mock.patch("urllib.request.urlopen", return_value=fake_response):
            with self.assertRaises(JudgeError) as caught:
                client.ask("bottom-secret", "question")
        self.assertEqual(caught.exception.code, "invalid_response")


if __name__ == "__main__":
    unittest.main()
