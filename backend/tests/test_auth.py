"""認證:身分只取自驗證過的 Supabase JWT;客戶端自稱的 X-User-ID 一律忽略(C3 修復)"""
import base64
import json
import uuid
from datetime import datetime

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jwt import PyJWKClient
from jwt.algorithms import ECAlgorithm

from app.main import app
from app.routes import tests_route, words_route
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError, PyJWTError

from tests.auth_helpers import TEST_JWT_SECRET, auth_headers, build_claims, make_token

client = TestClient(app, raise_server_exceptions=False)

PROTECTED_ENDPOINTS = [
    ("GET", "/words/review", None),
    ("GET", "/words/deck", None),
    ("POST", "/words/fill", {"word": "apple"}),
    ("POST", "/words/mark_familiar", {"word_id": str(uuid.uuid4()), "familiar": True}),
    ("POST", "/tests/submit_definition", {"word_id": str(uuid.uuid4()), "user_input_zh": "蘋果"}),
    ("POST", "/folders", {"name": "TOEIC"}),
    ("PATCH", f"/folders/{uuid.uuid4()}", {"name": "TOEIC"}),
    ("DELETE", f"/folders/{uuid.uuid4()}", None),
    ("PUT", f"/words/{uuid.uuid4()}/folder", {"folder_id": None}),
]


def _call(method, path, payload, headers=None):
    if method == "GET":
        return client.get(path, headers=headers or {})
    if method == "PATCH":
        return client.patch(path, json=payload, headers=headers or {})
    if method == "PUT":
        return client.put(path, json=payload, headers=headers or {})
    if method == "DELETE":
        return client.delete(path, headers=headers or {})
    return client.post(path, json=payload, headers=headers or {})


def _b64url(data: dict) -> str:
    def _to_jsonable(o):
        # claims 的 iat/exp 是 datetime → epoch 整數(和 PyJWT 編出來的 token 一致)。
        # 先前 default=str 會把 exp 變字串,偽造 token 被拒的原因就變成「exp 格式錯」,
        # 測不到真正該擋的演算法/簽章問題
        if isinstance(o, datetime):
            return int(o.timestamp())
        raise TypeError(f"unexpected claim type: {type(o).__name__}")

    return (
        base64.urlsafe_b64encode(json.dumps(data, default=_to_jsonable).encode())
        .rstrip(b"=")
        .decode()
    )


def _alg_none_token() -> str:
    """手工偽造 alg=none 的 token:任何簽章都沒有的「自稱管理員」"""
    header = _b64url({"alg": "none", "typ": "JWT"})
    payload = _b64url(build_claims())
    return f"{header}.{payload}."


def _hs256_with_kid(kid="test-kid") -> str:
    """HS256 token 但帶 kid — 用來強制走到 JWKS 驗證段(而非被 kid 預檢擋下)"""
    return jwt.encode(build_claims(), TEST_JWT_SECRET, algorithm="HS256", headers={"kid": kid})


# ---------- 缺 token / 壞 token ----------


@pytest.mark.parametrize("method,path,payload", PROTECTED_ENDPOINTS)
def test_endpoints_reject_missing_token(method, path, payload):
    response = _call(method, path, payload)
    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


@pytest.mark.parametrize("authorization", ["Token abc", "Bearer", "Bearer   "])
def test_malformed_authorization_header_rejected(authorization):
    response = client.get("/words/review", headers={"Authorization": authorization})
    assert response.status_code == 401


@pytest.mark.parametrize("token", ["not-a-jwt", "a.b.c", _alg_none_token()])
def test_garbage_token_rejected(token):
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_token_signed_with_wrong_secret_rejected():
    token = make_token(secret="attacker-secret-0123456789abcdef")
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_expired_token_rejected():
    token = make_token(expires_in_seconds=-60)
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_token_without_sub_rejected():
    token = make_token(**{"sub": None})
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_token_with_non_uuid_sub_rejected():
    token = make_token(**{"sub": "admin"})
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_wrong_audience_rejected():
    token = make_token(**{"aud": "anon"})
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_wrong_issuer_rejected():
    token = make_token(issuer="https://evil.example.com/auth/v1")
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


# ---------- 合法 token:身分=sub ----------


def test_valid_token_passes_sub_uuid_to_review_dao(monkeypatch):
    captured = {}

    def fake_due(user_id, today):
        captured["user_id"] = user_id
        return []

    monkeypatch.setattr(words_route, "get_user_words_due_today", fake_due)

    user_id = uuid.uuid4()
    response = client.get("/words/review", headers=auth_headers(user_id))

    assert response.status_code == 200
    assert captured["user_id"] == user_id


def test_valid_token_passes_sub_uuid_to_submit_service(monkeypatch):
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


# ---------- C3 回歸:X-User-ID 不再是身分來源 ----------


def test_spoofed_x_user_id_header_is_ignored(monkeypatch):
    captured = {}

    def fake_due(user_id, today):
        captured["user_id"] = user_id
        return []

    monkeypatch.setattr(words_route, "get_user_words_due_today", fake_due)

    real_user = uuid.uuid4()
    attacker = uuid.uuid4()
    headers = {**auth_headers(real_user), "X-User-ID": str(attacker)}
    response = client.get("/words/review", headers=headers)

    assert response.status_code == 200
    assert captured["user_id"] == real_user  # 偽造的 header 被完全忽略


def test_x_user_id_alone_is_not_authentication(monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("沒有 token 不應進到 DAO")

    monkeypatch.setattr(words_route, "get_user_words_due_today", explode)

    response = client.get("/words/review", headers={"X-User-ID": str(uuid.uuid4())})
    assert response.status_code == 401


def test_spoofed_x_user_id_ignored_on_fill(monkeypatch):
    captured = {}

    def fake_fill(word, user_id):
        captured["user_id"] = user_id
        return {"id": str(uuid.uuid4()), "word": word}

    monkeypatch.setattr(words_route, "fill_word_details", fake_fill)

    real_user = uuid.uuid4()
    headers = {**auth_headers(real_user), "X-User-ID": str(uuid.uuid4())}
    response = client.post("/words/fill", json={"word": "apple"}, headers=headers)

    assert response.status_code == 200
    assert captured["user_id"] == real_user  # 偽造的 header 被完全忽略


def test_spoofed_x_user_id_ignored_on_submit_definition(monkeypatch):
    captured = {}

    class FakeResult:
        score = 1.0
        ai_feedback = "很好"

    def fake_process(user_id, word_id, user_input_zh):
        captured["user_id"] = user_id
        return FakeResult()

    monkeypatch.setattr(tests_route, "process_definition_test", fake_process)

    real_user = uuid.uuid4()
    headers = {**auth_headers(real_user), "X-User-ID": str(uuid.uuid4())}
    response = client.post(
        "/tests/submit_definition",
        json={"word_id": str(uuid.uuid4()), "user_input_zh": "蘋果"},
        headers=headers,
    )

    assert response.status_code == 200
    assert captured["user_id"] == real_user  # 偽造的 header 被完全忽略


# ---------- JWKS 路徑(新式非對稱簽章專案) ----------


def _force_jwks_path(monkeypatch, client_factory):
    """把 auth 切成 JWKS 模式(刪掉 legacy secret),並注入假的 PyJWKClient(不打網)"""
    from app.core import auth as auth_module

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setattr(auth_module, "_jwks_client", None)
    monkeypatch.setattr(auth_module, "PyJWKClient", client_factory)


def _public_pem(private_key) -> bytes:
    return private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def _fake_jwks_client_factory(key_material, created=None):
    class FakeSigningKey:
        key = key_material

    class FakeJWKSClient:
        def __init__(self, url, **kwargs):
            if created is not None:
                created["url"] = url

        def get_signing_key_from_jwt(self, token):
            return FakeSigningKey()

    return FakeJWKSClient


def test_jwks_path_selected_and_outage_maps_to_503(monkeypatch):
    created = {}

    class BrokenJWKSClient:
        def __init__(self, url, **kwargs):
            created["url"] = url

        def get_signing_key_from_jwt(self, token):
            raise PyJWKClientConnectionError("JWKS unreachable")

    _force_jwks_path(monkeypatch, BrokenJWKSClient)

    response = client.get("/words/review", headers={"Authorization": f"Bearer {_hs256_with_kid()}"})

    assert response.status_code == 503  # 認證基礎設施掛了,不是使用者憑證錯
    assert created["url"] == "https://test-project.supabase.co/auth/v1/.well-known/jwks.json"


def test_jwks_es256_token_verified(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    _force_jwks_path(monkeypatch, _fake_jwks_client_factory(_public_pem(private_key)))

    captured = {}

    def fake_due(user_id, today):
        captured["user_id"] = user_id
        return []

    monkeypatch.setattr(words_route, "get_user_words_due_today", fake_due)

    user_id = uuid.uuid4()
    token = jwt.encode(build_claims(user_id), private_key, algorithm="ES256", headers={"kid": "test-kid"})
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert captured["user_id"] == user_id


def test_jwks_rejects_token_signed_by_another_key(monkeypatch):
    trusted_key = ec.generate_private_key(ec.SECP256R1())
    attacker_key = ec.generate_private_key(ec.SECP256R1())
    _force_jwks_path(monkeypatch, _fake_jwks_client_factory(_public_pem(trusted_key)))

    token = jwt.encode(build_claims(), attacker_key, algorithm="ES256", headers={"kid": "test-kid"})
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_jwks_path_rejects_hs256_alg_confusion(monkeypatch):
    """經典 alg confusion 的現實版本:JWKS 公開 x/y 座標是人人都能拿到的,
    攻擊者拿原始位元當 HMAC 密鑰簽 HS256 → 必須 401。

    (PyJWT 2.15 自己會擋 PEM/DER/SSH/JWK 文字形狀的 HMAC 密鑰,但原始座標位元
    能過它所有防護 —— 真正擋下來的是我們的 algorithms 白名單。
    若白名單哪天誤收 HS256,同一份位元兩邊用,這個 token 會驗過 → 測試轉紅。)
    """
    trusted_key = ec.generate_private_key(ec.SECP256R1())
    numbers = trusted_key.public_key().public_numbers()
    attacker_secret = numbers.x.to_bytes(32, "big") + numbers.y.to_bytes(32, "big")
    _force_jwks_path(monkeypatch, _fake_jwks_client_factory(attacker_secret))

    def explode(*args, **kwargs):
        raise AssertionError("偽造 token 不應進到 DAO")

    monkeypatch.setattr(words_route, "get_user_words_due_today", explode)

    token = jwt.encode(
        build_claims(), attacker_secret, algorithm="HS256", headers={"kid": "test-kid"}
    )
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_jwks_algorithm_whitelist_has_no_hmac():
    from app.core import auth as auth_module

    assert "HS256" not in auth_module._ASYMMETRIC_ALGORITHMS


def test_jwks_mode_rejects_token_without_kid_without_fetching(monkeypatch):
    """沒有 kid 的 token 無從查公鑰 → 直接 401,絕不觸發 JWKS 抓取(防放大攻擊)"""
    fetched = []

    class TrackingJWKSClient:
        def __init__(self, url, **kwargs):
            pass

        def get_signing_key_from_jwt(self, token):
            fetched.append(token)
            raise AssertionError("沒有 kid 的 token 不應觸發 JWKS 抓取")

    _force_jwks_path(monkeypatch, TrackingJWKSClient)

    token = _alg_none_token()  # 無簽章的偽造 token,header 也沒有 kid
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert fetched == []


# ---------- 真 PyJWKClient(只把網路抓取換成離線 JWKS) ----------


def _ec_jwk(private_key, kid: str) -> dict:
    jwk = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    jwk["kid"] = kid
    return jwk


def _real_jwks_client_factory(jwks_doc: dict):
    """真的 PyJWKClient:解析/查 kid/建金鑰全走套件實作,只有 fetch_data 不打網。

    上面的 FakeJWKSClient 測的是我們的邏輯;這裡測的是「接到真套件行為也不炸」
    (H1 就是在真套件的內部解析裡踩到的)

    注意 fetch_data 的契約(PyJWT 2.15):回傳「已解析的 dict」,不是 JSON 字串
    """

    class OfflineJWKSClient(PyJWKClient):
        def fetch_data(self):
            return jwks_doc

    return OfflineJWKSClient


def test_jwks_real_client_verifies_es256(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    jwks_doc = {"keys": [_ec_jwk(private_key, "test-kid")]}
    _force_jwks_path(monkeypatch, _real_jwks_client_factory(jwks_doc))

    captured = {}

    def fake_due(user_id, today):
        captured["user_id"] = user_id
        return []

    monkeypatch.setattr(words_route, "get_user_words_due_today", fake_due)

    user_id = uuid.uuid4()
    token = jwt.encode(
        build_claims(user_id), private_key, algorithm="ES256", headers={"kid": "test-kid"}
    )
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert captured["user_id"] == user_id


def test_jwks_real_client_unknown_kid_rejected(monkeypatch):
    trusted_key = ec.generate_private_key(ec.SECP256R1())
    attacker_key = ec.generate_private_key(ec.SECP256R1())
    jwks_doc = {"keys": [_ec_jwk(trusted_key, "test-kid")]}
    _force_jwks_path(monkeypatch, _real_jwks_client_factory(jwks_doc))

    token = jwt.encode(
        build_claims(), attacker_key, algorithm="ES256", headers={"kid": "other-kid"}
    )
    response = client.get("/words/review", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def _token_with_bad_payload_json(kid: str = "test-kid") -> str:
    """header 合法(有 kid)但 payload 不是 JSON 的偽造 token"""
    header = _b64url({"alg": "ES256", "typ": "JWT", "kid": kid})
    payload = base64.urlsafe_b64encode(b"this is definitely not json").rstrip(b"=").decode()
    signature = base64.urlsafe_b64encode(b"x" * 64).rstrip(b"=").decode()
    return f"{header}.{payload}.{signature}"


def test_jwks_real_client_non_json_payload_rejected(monkeypatch):
    """H1 回歸:PyJWKClient 內部會先解一次 payload(取 kid)才查公鑰,
    payload 不是 JSON 時拋的是 DecodeError → 必須 401,不能是未認證的 500
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    jwks_doc = {"keys": [_ec_jwk(private_key, "test-kid")]}
    _force_jwks_path(monkeypatch, _real_jwks_client_factory(jwks_doc))

    response = client.get(
        "/words/review",
        headers={"Authorization": f"Bearer {_token_with_bad_payload_json()}"},
    )

    assert response.status_code == 401


def test_real_jwks_client_bad_payload_raises_non_jwkclienterror():
    """把 H1 的機制釘死:這個例外不是 PyJWKClientError,只有 PyJWTError 那層
    catch 接得住;若套件哪天改成包成 PyJWKClientError,這條測試會提醒我們更新認知
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    jwks_client = _real_jwks_client_factory(
        {"keys": [_ec_jwk(private_key, "test-kid")]}
    )("https://test-project.supabase.co/auth/v1/.well-known/jwks.json")

    with pytest.raises(PyJWTError) as excinfo:
        jwks_client.get_signing_key_from_jwt(_token_with_bad_payload_json())

    assert not isinstance(excinfo.value, PyJWKClientError)
