"""API 回應不可被 CDN 快取:Vercel 的 rewrite 預設會採信上游 cache 標頭,
而 /words/deck、/words/review 回傳的是每個使用者自己的單字"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)


# 掛在真實 app 上,走完整 middleware 堆疊
@app.get("/__test_boom_cache__")
def _boom_test_route():
    raise RuntimeError("boom")


def test_normal_response_is_not_cacheable():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


def test_unauthorized_response_is_not_cacheable():
    response = client.get("/words/deck")

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_oversized_body_response_is_not_cacheable():
    # 413 由 limit_body_size 產生 → middleware 要最外層才蓋得到
    response = client.post("/words/fill", json={"word": "a" * 70000})

    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"


def test_unhandled_error_response_is_not_cacheable():
    # 500 走 ServerErrorMiddleware,在所有使用者 middleware 之外 → 由錯誤處理器補
    response = client.get("/__test_boom_cache__")

    assert response.status_code == 500
    assert response.headers["cache-control"] == "no-store"
