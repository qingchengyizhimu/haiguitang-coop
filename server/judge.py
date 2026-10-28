#!/usr/bin/env python3
"""Provider-agnostic, stateless judge for OpenAI-compatible chat APIs."""

from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Mapping


ASK_ANSWERS = {"是", "否", "无关", "部分相关", "驳回"}
SCORE_RANKS = {"完全还原", "基本还原", "部分还原", "方向错误"}
SAFE_RANK_COMMENTS = {
    "完全还原": "推理与关键事实高度吻合。",
    "基本还原": "主要方向正确，仍有部分细节未还原。",
    "部分还原": "已触及部分关键方向，推理仍不完整。",
    "方向错误": "当前推理与关键事实偏差较大。",
}
DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"


class JudgeError(RuntimeError):
    """A sanitized judge error that is safe to report to API clients."""

    def __init__(self, code: str, public_message: str, *, status: int = 502):
        super().__init__(public_message)
        self.code = code
        self.public_message = public_message
        self.status = status


@dataclass(frozen=True)
class JudgeConfig:
    api_url: str
    api_key: str
    model: str
    timeout: float = 30.0
    legacy_deepseek: bool = False

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "JudgeConfig":
        env = os.environ if environ is None else environ
        judge_key = env.get("JUDGE_API_KEY", "").strip()
        legacy_key = env.get("DEEPSEEK_API_KEY", "").strip()
        using_legacy = not judge_key and bool(legacy_key)
        api_key = judge_key or legacy_key
        api_url = (
            env.get("JUDGE_API_URL", "").strip()
            or env.get("DEEPSEEK_API_URL", "").strip()
            or (DEFAULT_DEEPSEEK_URL if using_legacy else "")
        )
        model = env.get("JUDGE_MODEL", "").strip() or (
            "deepseek-chat" if using_legacy else ""
        )
        try:
            timeout = float(env.get("JUDGE_TIMEOUT_SECONDS", "30"))
        except ValueError as exc:
            raise JudgeError(
                "invalid_config", "裁判服务配置无效，请联系服务管理员。", status=503
            ) from exc
        if timeout <= 0:
            raise JudgeError(
                "invalid_config", "裁判服务配置无效，请联系服务管理员。", status=503
            )
        return cls(api_url, api_key, model, timeout, using_legacy)

    def require_complete(self) -> None:
        if not self.api_url or not self.api_key or not self.model:
            raise JudgeError(
                "not_configured", "裁判模型尚未配置，请设置 JUDGE_API_URL、JUDGE_API_KEY 和 JUDGE_MODEL。", status=503
            )


class JudgeClient:
    """Makes one isolated HTTP request per public method call."""

    def __init__(self, config: JudgeConfig):
        self.config = config

    def _complete(self, system_prompt: str, user_message: str, max_tokens: int) -> str:
        self.config.require_complete()
        payload = json.dumps(
            {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "temperature": 0,
                "max_tokens": max_tokens,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            self.config.api_url,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
                raw = response.read()
        except (TimeoutError, socket.timeout) as exc:
            raise JudgeError(
                "timeout", "裁判服务响应超时，请稍后重试。", status=504
            ) from exc
        except urllib.error.HTTPError as exc:
            # Do not read or relay the provider response body.
            raise JudgeError(
                "provider_error", "裁判服务暂时不可用，请稍后重试。", status=502
            ) from exc
        except (urllib.error.URLError, OSError) as exc:
            reason = getattr(exc, "reason", None)
            if isinstance(reason, (TimeoutError, socket.timeout)):
                raise JudgeError(
                    "timeout", "裁判服务响应超时，请稍后重试。", status=504
                ) from exc
            raise JudgeError(
                "provider_error", "裁判服务暂时不可用，请稍后重试。", status=502
            ) from exc
        try:
            envelope = json.loads(raw.decode("utf-8"))
            content = envelope["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError("content is not text")
            return content
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise JudgeError(
                "invalid_response", "裁判服务返回了无法识别的格式，请稍后重试。", status=502
            ) from exc

    @staticmethod
    def _parse_object(content: str) -> dict:
        text = content.strip()
        if text.startswith("```"):
            lines = text.splitlines()
            if len(lines) >= 3 and lines[-1].strip() == "```":
                text = "\n".join(lines[1:-1])
                if text.lstrip().startswith("json"):
                    text = text.lstrip()[4:].lstrip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise JudgeError(
                "invalid_response", "裁判服务返回了无法识别的格式，请稍后重试。", status=502
            ) from exc
        if not isinstance(parsed, dict):
            raise JudgeError(
                "invalid_response", "裁判服务返回了无法识别的格式，请稍后重试。", status=502
            )
        return parsed

    def ask(self, soup_bottom: str, question: str) -> str:
        system_prompt = f"""你是海龟汤裁判。你只能依据下面的汤底判断本次问题，不得补充设定。

汤底：
{soup_bottom}

判定规则：
- 命题成立回答“是”；不成立回答“否”。
- 与核心真相无关回答“无关”。
- 只有部分成立或包含真假混合条件回答“部分相关”。
- 问题无法作上述判断或不是可判定问题回答“驳回”。
- 只返回 JSON：{{"answer":"是|否|无关|部分相关|驳回"}}。"""
        content = self._complete(system_prompt, question, 80)
        parsed = self._parse_object(content)
        answer = parsed.get("answer")
        if not isinstance(answer, str) or answer not in ASK_ANSWERS:
            raise JudgeError(
                "invalid_response", "裁判服务返回了无法识别的答案，请稍后重试。", status=502
            )
        return answer

    def submit(self, soup_bottom: str, key_elements: list[str], answer: str) -> dict:
        elements = "\n".join(f"- {item}" for item in key_elements) or "- 无预设要素"
        system_prompt = f"""你是海龟汤评分裁判。只评估本次提交，不参考任何其他会话或历史。

汤底：
{soup_bottom}

评分要素：
{elements}

评分规则：关键情节命中 40%，逻辑连贯 30%，细节还原 30%。
每个分数必须是 0 到 100 的整数。rank 只能是“完全还原”“基本还原”“部分还原”“方向错误”。
只返回 JSON：{{"key_plot":0,"logic":0,"detail":0,"overall":0,"rank":"方向错误"}}。"""
        content = self._complete(system_prompt, answer, 400)
        parsed = self._parse_object(content)
        required = {"key_plot", "logic", "detail", "overall", "rank"}
        if not required.issubset(parsed):
            raise JudgeError(
                "invalid_response", "裁判服务返回了不完整的评分，请稍后重试。", status=502
            )
        scores: dict[str, int] = {}
        for field in ("key_plot", "logic", "detail", "overall"):
            value = parsed[field]
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
                raise JudgeError(
                    "invalid_response", "裁判服务返回了超出范围的评分，请稍后重试。", status=502
                )
            scores[field] = value
        rank = parsed["rank"]
        expected_rank = (
            "完全还原"
            if scores["overall"] >= 90
            else "基本还原"
            if scores["overall"] >= 70
            else "部分还原"
            if scores["overall"] >= 50
            else "方向错误"
        )
        if rank not in SCORE_RANKS or rank != expected_rank:
            raise JudgeError(
                "invalid_response", "裁判服务返回了无法识别的评分，请稍后重试。", status=502
            )
        return {
            **scores,
            "rank": rank,
            # Provider explanations are deliberately discarded. This local text
            # cannot echo the private soup bottom, scoring elements, or a prompt.
            "comment": SAFE_RANK_COMMENTS[rank],
        }


def create_judge(environ: Mapping[str, str] | None = None) -> JudgeClient:
    return JudgeClient(JudgeConfig.from_env(environ))
