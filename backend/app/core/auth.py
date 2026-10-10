# app/core/auth.py
"""Supabase access token 驗證:身分只來自簽章驗證過的 JWT sub,客戶端自稱的 header 一律不信。

兩種模式(每次請求重讀 env,避免 import 時就把策略凍結):
- SUPABASE_JWT_SECRET 有值 → legacy HS256 專案 / 本機測試
- 沒有 → 新式非對稱簽章,走 JWKS({SUPABASE_URL}/auth/v1/.well-known/jwks.json)
"""
import os
import uuid
from typing import Optional

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError, PyJWTError

from app.core.config import SUPABASE_URL
from app.core.logger import logger

_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
_ISSUER = f"{SUPABASE_URL}/auth/v1"
_AUDIENCE = "authenticated"
# 只允許非對稱簽章;絕不可加入 HS256(alg confusion:拿公鑰當 HMAC 密鑰)
_ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
_LEEWAY_SECONDS = 30  # 容忍簽發方與本機的時鐘偏差(iat/exp/nbf)
_JWKS_TIMEOUT_SECONDS = 5

_jwks_client = None


def _get_jwks_client():
    """惰性建立並快取 JWKS client(PyJWKClient 內建金鑰快取,會自行輪替)"""
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            _JWKS_URL, cache_keys=True, lifespan=3600, timeout=_JWKS_TIMEOUT_SECONDS
        )
    return _jwks_client


if os.getenv("SUPABASE_JWT_SECRET", "").strip():
    logger.warning(
        "Auth: 使用 legacy HS256 shared secret 驗簽(SUPABASE_JWT_SECRET 有值)"
        " — 新式 JWKS 專案不該走這條,非預期請移除該環境變數"
    )
else:
    logger.info(f"Auth: 使用 JWKS 驗簽:{_JWKS_URL}")


def _unauthorized(detail: str = "Invalid or missing authentication token") -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def _verify(token: str) -> dict:
    shared_secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()

    if shared_secret:
        signing_key, algorithms = shared_secret, ["HS256"]
    else:
        # 先讀未驗證的 header:沒有 kid 就無從查公鑰,直接 401 —
        # 不讓垃圾 token 觸發 JWKS 抓取(放大攻擊)
        try:
            header = jwt.get_unverified_header(token)
        except PyJWTError as e:
            logger.warning(f"Auth: token header not decodable: {e}")
            raise _unauthorized() from e

        if not isinstance(header.get("kid"), str) or not header["kid"]:
            logger.warning("Auth: token missing kid; refusing to fetch JWKS")
            raise _unauthorized()

        try:
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token).key
        except PyJWKClientConnectionError as e:  # 真的連不上 JWKS → 503,別誤導成憑證錯
            logger.error(f"Auth: JWKS unreachable: {e}")
            raise HTTPException(
                status_code=503, detail="Authentication service temporarily unavailable"
            ) from e
        except PyJWKClientError as e:  # kid 查無對應公鑰 → 401
            logger.warning(f"Auth: no matching signing key: {e}")
            raise _unauthorized() from e
        except PyJWTError as e:
            # PyJWKClient 內部會先 decode 一次 token(取 kid),payload 不是 JSON 時
            # 拋的是 PyJWKClientError 的兄弟 DecodeError → 一樣是壞 token,必須 401,
            # 不能讓它逃逸成未認證的 500 + 灌 log
            logger.warning(f"Auth: signing key lookup failed: {e}")
            raise _unauthorized() from e

        algorithms = _ASYMMETRIC_ALGORITHMS

    try:
        return jwt.decode(
            token,
            signing_key,
            algorithms=algorithms,
            audience=_AUDIENCE,
            issuer=_ISSUER,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "sub"]},
        )
    except PyJWTError as e:
        logger.warning(f"Auth: token rejected: {e}")
        raise _unauthorized() from e
    except Exception as e:
        # 金鑰型別與 alg 不符時(如 RS256 header + EC 公鑰)prepare_key 會拋 TypeError
        # (不是 PyJWTError)。token 是攻擊者可控輸入,任何解析失敗都收斂成 401,
        # 不然每個人都能觸發未認證的 500 + traceback 灌爆 log
        logger.warning(f"Auth: token/key mismatch: {type(e).__name__}")
        raise _unauthorized() from None


def get_current_user_id(authorization: Optional[str] = Header(None)) -> uuid.UUID:
    """FastAPI 依賴:解出 Authorization: Bearer <token> 的使用者 UUID。

    刻意用同步 def:JWKS 抓取是阻塞 IO,FastAPI 會自動丟 threadpool,不卡事件圈。
    """
    if not authorization:
        raise _unauthorized()

    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()

    payload = _verify(token)

    sub = payload.get("sub")
    if not isinstance(sub, str):
        logger.warning("Auth: token sub is not a string")
        raise _unauthorized()
    try:
        return uuid.UUID(sub)
    except ValueError:
        logger.warning("Auth: token sub is not a UUID")
        raise _unauthorized() from None
