"""未預期例外不可洩漏原始碼,一律回傳通用 500;錯誤回應仍要帶 CORS 標頭"""
from fastapi.testclient import TestClient

from app.main import ALLOWED_ORIGINS, app

client = TestClient(app, raise_server_exceptions=False)


# 在真實 app 上掛一條測試路由,走完整 middleware 堆疊(含 CORS)
@app.get("/__test_boom__")
def _boom_test_route():
    raise RuntimeError("internal detail at C:\\github\\secret\\config.py")


def test_app_debug_disabled():
    assert app.debug is False


def test_unhandled_exception_returns_generic_500_without_source_leak():
    response = client.get("/__test_boom__")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "secret" not in response.text
    assert "RuntimeError" not in response.text
    assert "Traceback" not in response.text


def test_generic_500_keeps_cors_header_for_allowed_origin():
    # ServerErrorMiddleware 在 CORSMiddleware 外層,錯誤回應要手動補 CORS
    response = client.get("/__test_boom__", headers={"Origin": ALLOWED_ORIGINS[0]})

    assert response.status_code == 500
    assert response.headers.get("access-control-allow-origin") == ALLOWED_ORIGINS[0]
