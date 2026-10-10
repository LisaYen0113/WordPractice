"""測試不需真實憑證:提供假環境變數(已存在的話不覆蓋),讓 CI/新環境也能跑"""
import os

import pytest

os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-service-role-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
# 測試走 HS256 本地驗簽路徑,不打真 JWKS;值須與 tests/auth_helpers.TEST_JWT_SECRET 一致
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-0123456789abcdef")


@pytest.fixture(autouse=True)
def _block_real_network(monkeypatch):
    """安全網:任何測試都不得發出真網路請求(Supabase/PostgREST/JWKS);需要的測試自行覆蓋"""
    from app.core import supabase_client

    def blocked(*args, **kwargs):
        raise AssertionError("測試不可發出真實網路請求")

    monkeypatch.setattr(supabase_client.requests, "request", blocked)

    # PyJWKClient 用 urllib.request.urlopen 抓 JWKS —— 一樣要擋,
    # 否則 JWKS 路徑的測試可能真的打上網
    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", blocked)
