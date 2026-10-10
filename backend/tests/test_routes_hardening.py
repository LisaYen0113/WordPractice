"""路由層:認證後的 UUID 傳遞、錯誤訊息不外洩、body 上限"""
import json
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.routes import tests_route, words_route
from tests.auth_helpers import auth_headers

client = TestClient(app, raise_server_exceptions=False)


def test_review_passes_canonical_uuid_to_dao(monkeypatch):
    captured = {}

    def fake_due_today(user_id, today):
        captured["user_id"] = user_id
        return []

    monkeypatch.setattr(words_route, "get_user_words_due_today", fake_due_today)

    user_id = uuid.uuid4()
    response = client.get("/words/review", headers=auth_headers(user_id))

    assert response.status_code == 200
    assert captured["user_id"] == user_id  # JWT sub 已正規化成 UUID 才進 DAO
    assert response.json() == []


def test_submit_definition_passes_uuid_to_service(monkeypatch):
    captured = {}

    class FakeResult:
        score = 1.0
        ai_feedback = "很好"

    def fake_process(user_id, word_id, user_input_zh):
        captured["user_id"] = user_id
        return FakeResult()

    monkeypatch.setattr(tests_route, "process_definition_test", fake_process)

    user_id = uuid.uuid4()
    response = client.post(
        "/tests/submit_definition",
        json={"word_id": str(uuid.uuid4()), "user_input_zh": "蘋果"},
        headers=auth_headers(user_id),
    )

    assert response.status_code == 200
    assert captured["user_id"] == user_id


def test_fill_rejects_oversized_word_before_calling_ai(monkeypatch):
    calls = []
    monkeypatch.setattr(words_route, "fill_word_details", lambda word, user_id: calls.append(word))

    response = client.post("/words/fill", json={"word": "a" * 5000}, headers=auth_headers())

    assert response.status_code == 422
    assert calls == []  # 根本沒進到 AI 服務


def test_validation_error_does_not_echo_oversized_input():
    big = "a" * 5000

    response = client.post("/words/fill", json={"word": big}, headers=auth_headers())

    assert response.status_code == 422
    assert big not in response.text  # 不回顯原始輸入


def test_lone_surrogate_gets_422_not_500():
    # 殘缺代理對若被原封回顯,回應無法編碼成 UTF-8 → 之前會 500
    payload = json.dumps({"word": chr(0xD800)})

    response = client.post(
        "/words/fill",
        content=payload,
        headers={"Content-Type": "application/json", **auth_headers()},
    )

    assert response.status_code == 422


def test_oversized_body_rejected_with_413():
    # body 上限在 middleware,先於認證與路由擋下
    response = client.post("/words/fill", json={"word": "a" * 70000})

    assert response.status_code == 413


def test_fill_internal_error_is_generic(monkeypatch):
    def boom(word, user_id):
        raise RuntimeError("internal detail at C:\\github\\secret.py")

    monkeypatch.setattr(words_route, "fill_word_details", boom)

    response = client.post("/words/fill", json={"word": "apple"}, headers=auth_headers())

    assert response.status_code == 500
    assert "secret.py" not in response.text
    assert "internal detail" not in response.text
