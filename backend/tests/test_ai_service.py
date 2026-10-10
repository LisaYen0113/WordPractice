"""judge_definition:分數一律正規化成 0–1,上游輸出異常回 502(不是 500)。

模型可能不理 prompt 用自己尺度(實測回過五分制的 5.0),
而 SRS 與 is_correct 都以 CORRECT_THRESHOLD(0.9)為門檻、假定 0–1 尺度。
"""
import json
import math
import types

import pytest
from fastapi import HTTPException

from app.services import ai_service
from app.services.ai_service import _normalize_score


class _FakeJudgeClient:
    """假的 google-genai client:記錄呼叫參數,回固定文字"""

    def __init__(self, text):
        self._text = text
        self.calls = []
        self.models = self

    def generate_content(self, *args, **kwargs):
        self.calls.append(kwargs)
        return types.SimpleNamespace(text=self._text)


def _judge_payload(score):
    return json.dumps({"score": score, "ai_mistake_type": "none", "ai_feedback": "很好"})


def _judge(monkeypatch, text):
    fake = _FakeJudgeClient(text)
    monkeypatch.setattr(ai_service, "client", fake)
    result = ai_service.judge_definition("resilient", "able to recover quickly", "有韌性的")
    return fake, result


# ---------- _normalize_score(純函式) ----------


@pytest.mark.parametrize(
    "raw,expected",
    [
        (5.0, 1.0),  # 五分制滿分 → 1.0
        (4.5, 0.9),  # 五分制 4.5 → 0.9(門檻語義保持)
        (3.0, 0.6),  # 五分制的部分正確 → 0.6,不再被 0.9 門檻誤判成全對
        (2.5, 0.5),  # 換算後正好落在部分正確門檻
        (1.5, 0.3),  # (1,2] 刻意視為五分制低分(見 docstring),不是「略超過 1」
        (1.0000001, 0.2),  # 浮點微溢出也走同一規則,5 倍落差是刻意的
        (1.0, 1.0),  # 已是 0–1 尺度,原樣通過
        (0.95, 0.95),
        (0.0, 0.0),
        (-0.5, 0.0),  # 負分 → 夾到 0
        (7.0, 1.0),  # 超出五分制 → 夾到 1.0(會留 warning log 供之後用真實分布修規則)
    ],
)
def test_normalize_score(raw, expected):
    assert _normalize_score(raw) == pytest.approx(expected)


@pytest.mark.parametrize("raw", [math.nan, math.inf, -math.inf])
def test_normalize_score_non_finite_is_zero(raw):
    """pydantic 的 jiter 接受 NaN/Infinity literal → 一律當 0,不靠 max() 參數順序"""
    assert _normalize_score(raw) == 0.0


# ---------- judge_definition 接線 ----------


@pytest.mark.parametrize(
    "raw,expected",
    [
        (5.0, 1.0),  # 實測 regression:新模型第一版真的回 5.0
        (3.0, 0.6),
        (0.8, 0.8),
    ],
)
def test_judge_definition_returns_normalized_score(monkeypatch, raw, expected):
    _, result = _judge(monkeypatch, _judge_payload(raw))
    assert result.score == pytest.approx(expected)
    assert result.ai_feedback == "很好"


def test_judge_definition_uses_env_model_and_structured_output(monkeypatch):
    """釘住接線:模型名來自 config(可換),結構化輸出設定仍在。

    反例:把 model=GEMINI_MODEL 改回硬編碼 "gemini-2.5-flash"(被 Google 停用的舊模型)
    必須讓這個測試變紅,否則 404 事故會再次靜默回歸。
    """
    fake, _ = _judge(monkeypatch, _judge_payload(0.8))
    call = fake.calls[0]
    assert call["model"] == ai_service.GEMINI_MODEL
    assert call["config"].response_schema is ai_service.GeminiOutput
    assert call["config"].response_mime_type == "application/json"


# ---------- 上游輸出異常 → 502(不是 500) ----------


def test_judge_definition_empty_text_returns_502(monkeypatch):
    """安全過濾等情況 res.text 是 None → 友善 502,不要讓 ValidationError 變 500"""
    monkeypatch.setattr(ai_service, "client", _FakeJudgeClient(None))
    with pytest.raises(HTTPException) as excinfo:
        ai_service.judge_definition("resilient", "able to recover quickly", "有韌性的")
    assert excinfo.value.status_code == 502


def test_judge_definition_unparsable_text_returns_502(monkeypatch):
    monkeypatch.setattr(ai_service, "client", _FakeJudgeClient("這不是 JSON"))
    with pytest.raises(HTTPException) as excinfo:
        ai_service.judge_definition("resilient", "able to recover quickly", "有韌性的")
    assert excinfo.value.status_code == 502


def test_judge_definition_missing_field_returns_502(monkeypatch):
    """欄位缺漏(模型沒照 schema)→ 502,不要 500"""
    monkeypatch.setattr(ai_service, "client", _FakeJudgeClient(json.dumps({"score": 1.0})))
    with pytest.raises(HTTPException) as excinfo:
        ai_service.judge_definition("resilient", "able to recover quickly", "有韌性的")
    assert excinfo.value.status_code == 502
