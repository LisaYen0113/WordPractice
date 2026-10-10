"""Supabase 上游錯誤原文只能留在 server log,不可回給客戶端"""
import logging

import pytest
import requests
from fastapi import HTTPException

from app.core import supabase_client

GENERIC_DETAIL = "Database request failed"


class FakeResponse:
    def __init__(self, status_code=400, text="PG error: column words.internal_col does not exist"):
        self.status_code = status_code
        self.text = text
        self.content = b"{}" if text else b""

    def json(self):
        return {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(
                f"{self.status_code} Client Error", response=self
            )


def _patch_request(monkeypatch, fake):
    def fake_request(*args, **kwargs):
        fake_request.kwargs = kwargs
        return fake

    monkeypatch.setattr(supabase_client.requests, "request", fake_request)
    return fake_request


def test_upstream_error_text_not_exposed(monkeypatch, caplog):
    _patch_request(monkeypatch, FakeResponse())

    with caplog.at_level(logging.ERROR):
        with pytest.raises(HTTPException) as excinfo:
            supabase_client.supabase_request("GET", "words")

    assert excinfo.value.status_code == 400  # 有語意的 4xx 才透傳
    assert excinfo.value.detail == GENERIC_DETAIL  # 只有通用訊息
    assert "internal_col" in caplog.text  # 原文有寫進 log 供除錯
    assert "internal_col" not in str(excinfo.value.detail)


def test_upstream_auth_error_mapped_to_502(monkeypatch, caplog):
    # 上游 401 不可直接透傳,否則前端會誤判成自己登入過期
    _patch_request(monkeypatch, FakeResponse(status_code=401, text="JWT expired"))

    with caplog.at_level(logging.ERROR):
        with pytest.raises(HTTPException) as excinfo:
            supabase_client.supabase_request("GET", "words")

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == GENERIC_DETAIL
    assert "JWT expired" in caplog.text


def test_unexpected_error_not_exposed(monkeypatch, caplog):
    def fake_request(*args, **kwargs):
        raise ConnectionError("connect to 10.0.0.5:5432 refused")

    monkeypatch.setattr(supabase_client.requests, "request", fake_request)

    with caplog.at_level(logging.ERROR):
        with pytest.raises(HTTPException) as excinfo:
            supabase_client.supabase_request("GET", "words")

    assert excinfo.value.status_code == 500
    assert excinfo.value.detail == GENERIC_DETAIL
    assert "10.0.0.5" in caplog.text


def test_timeout_maps_to_generic_500(monkeypatch, caplog):
    def fake_request(*args, **kwargs):
        raise requests.exceptions.Timeout("read timeout after 10s")

    monkeypatch.setattr(supabase_client.requests, "request", fake_request)

    with caplog.at_level(logging.ERROR):
        with pytest.raises(HTTPException) as excinfo:
            supabase_client.supabase_request("GET", "words")

    assert excinfo.value.status_code == 500
    assert excinfo.value.detail == GENERIC_DETAIL


def test_request_sets_timeout(monkeypatch):
    fake_request = _patch_request(monkeypatch, FakeResponse(status_code=200, text=""))

    supabase_client.supabase_request("GET", "words")

    timeout = fake_request.kwargs["timeout"]
    assert 0 < timeout <= 30


def test_new_style_secret_key_sent_as_apikey_only(monkeypatch):
    # sb_secret_... 不是 JWT,只能放 apikey;誤放 Authorization 會被上游打回
    fake_request = _patch_request(monkeypatch, FakeResponse(status_code=200, text=""))
    monkeypatch.setattr(supabase_client, "SUPABASE_KEY", "sb_secret_abc123")

    supabase_client.supabase_request("GET", "words")

    headers = fake_request.kwargs["headers"]
    assert headers["apikey"] == "sb_secret_abc123"
    assert "Authorization" not in headers


def test_patch_with_prefer_representation_sets_header(monkeypatch):
    # PATCH 需要偵測「0 列被更新」時,由呼叫端指定 Prefer(NOT POST 預設)
    fake_request = _patch_request(monkeypatch, FakeResponse(status_code=200, text=""))

    supabase_client.supabase_request("PATCH", "user_words", prefer="return=representation")

    assert fake_request.kwargs["headers"]["Prefer"] == "return=representation"


def test_legacy_jwt_key_also_sent_as_bearer(monkeypatch):
    # 舊式 service_role JWT(eyJ...)要 apikey + Authorization 都帶
    fake_request = _patch_request(monkeypatch, FakeResponse(status_code=200, text=""))
    monkeypatch.setattr(supabase_client, "SUPABASE_KEY", "eyJhbGciOiJIUzI1NiJ9.fake.signature")

    supabase_client.supabase_request("GET", "words")

    headers = fake_request.kwargs["headers"]
    assert headers["apikey"] == "eyJhbGciOiJIUzI1NiJ9.fake.signature"
    assert headers["Authorization"] == "Bearer eyJhbGciOiJIUzI1NiJ9.fake.signature"
