"""測試用:自行簽發與 Supabase 同格式的 access token。

conftest 把 SUPABASE_JWT_SECRET 設成 HS256 測試密鑰,
所以測試全程走本地驗簽,不會打真 JWKS。
"""
import uuid
from datetime import datetime, timedelta, timezone

import jwt

TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef"  # 32 bytes;須與 tests/conftest.py 的 setdefault 一致
TEST_ISSUER = "https://test-project.supabase.co/auth/v1"  # 對齊 conftest 的 SUPABASE_URL


def build_claims(user_id=None, *, expires_in_seconds: int = 3600, issuer: str = TEST_ISSUER, **overrides) -> dict:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(user_id) if user_id is not None else str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": issuer,
        "role": "authenticated",
        "iat": now,
        "exp": now + timedelta(seconds=expires_in_seconds),
    }
    claims.update(overrides)
    return claims


def make_token(user_id=None, *, secret: str = TEST_JWT_SECRET, **kwargs) -> str:
    return jwt.encode(build_claims(user_id, **kwargs), secret, algorithm="HS256")


def auth_headers(user_id=None, **kwargs) -> dict:
    return {"Authorization": f"Bearer {make_token(user_id, **kwargs)}"}
