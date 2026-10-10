"""Fly 的健康檢查端點:不驗身分、不碰資料庫"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)


def test_health_returns_ok_without_auth():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
