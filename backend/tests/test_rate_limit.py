"""限流:同一使用者每分鐘上限;超限 429 + Retry-After;時間過了自動恢復"""
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.rate_limit import FixedWindowLimiter
from app.main import app
from app.routes import words_route
from tests.auth_helpers import auth_headers

client = TestClient(app, raise_server_exceptions=False)


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def _word_detail(word):
    return {
        "id": str(uuid.uuid4()),
        "word": word,
        "pos": "n.",
        "definition": "蘋果",
        "kk_pronunciation": "[ˈæpəl]",
        "etymology": None,
        "synonyms": [],
        "antonyms": [],
        "inflections": [],
        "phrases": [],
        "toeic_examples": [],
    }


class TestFixedWindowLimiter:
    def test_allows_up_to_limit(self):
        limiter = FixedWindowLimiter(max_requests=3, window_seconds=60, clock=FakeClock())
        for _ in range(3):
            limiter.check("user-a")

    def test_raises_429_with_retry_after(self):
        clock = FakeClock()
        limiter = FixedWindowLimiter(max_requests=2, window_seconds=60, clock=clock)
        limiter.check("user-a")
        limiter.check("user-a")
        clock.advance(10)

        with pytest.raises(HTTPException) as excinfo:
            limiter.check("user-a")

        assert excinfo.value.status_code == 429
        assert int(excinfo.value.headers["Retry-After"]) == 50

    def test_window_resets_after_expiry(self):
        clock = FakeClock()
        limiter = FixedWindowLimiter(max_requests=1, window_seconds=60, clock=clock)
        limiter.check("user-a")
        clock.advance(60)
        limiter.check("user-a")  # 新視窗,不應拋

    def test_keys_are_independent(self):
        limiter = FixedWindowLimiter(max_requests=1, window_seconds=60, clock=FakeClock())
        limiter.check("user-a")
        limiter.check("user-b")  # 不同 key 互不影響

    def test_prune_removes_expired_keys(self):
        clock = FakeClock()
        limiter = FixedWindowLimiter(max_requests=5, window_seconds=60, clock=clock)
        for i in range(1025):  # 超過 _PRUNE_THRESHOLD
            limiter.check(f"user-{i}")
        clock.advance(61)
        limiter.check("fresh-user")  # 觸發 prune

        assert list(limiter._windows) == ["fresh-user"]  # 過期的都被清掉,不會無限增長


def test_fill_endpoint_returns_429_after_limit(monkeypatch):
    # 端到端:同一使用者連打超過上限(12/分)→ 之後回 429
    monkeypatch.setattr(words_route, "fill_word_details", lambda word, user_id: _word_detail(word))

    headers = auth_headers()  # 同一位使用者
    for _ in range(words_route.FILL_REQUESTS_PER_MINUTE):
        response = client.post("/words/fill", json={"word": "apple"}, headers=headers)
        assert response.status_code == 200

    limited = client.post("/words/fill", json={"word": "apple"}, headers=headers)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1


def test_review_endpoint_is_rate_limited(monkeypatch):
    # /review 每次兩個 PostgREST 查詢 → 也要有(寬鬆的)每使用者上限
    monkeypatch.setattr(words_route, "get_user_words_due_today", lambda user_id, today: [])

    headers = auth_headers()  # 同一位使用者
    for _ in range(words_route.REVIEW_REQUESTS_PER_MINUTE):
        assert client.get("/words/review", headers=headers).status_code == 200

    limited = client.get("/words/review", headers=headers)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1
