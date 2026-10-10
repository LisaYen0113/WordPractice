"""資料夾 CRUD 端點。

權限、狀態碼與中文訊息都在這裡釘住 —— 後端用 service key 繞過 RLS,
這些檢查是唯一的防線。
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes import folders_route
from tests.auth_helpers import auth_headers

client = TestClient(app, raise_server_exceptions=False)


def _row(folder_id=None, name="TOEIC", created_at="2026-10-10T00:00:00Z"):
    return {"id": str(folder_id or uuid.uuid4()), "name": name, "created_at": created_at}


def _patch_dao(monkeypatch, **overrides):
    """取代 route 模組上的 service 符號;沒取代到的一被呼叫就代表走錯路徑"""
    capture = {}

    def explode(name):
        def _boom(*args, **kwargs):
            raise AssertionError(f"{name} 不該被呼叫")

        return _boom

    defaults = {
        "get_folders": explode("get_folders"),
        "add_folder": explode("add_folder"),
        "update_folder": explode("update_folder"),
        "remove_folder": explode("remove_folder"),
    }
    for key, value in overrides.items():
        capture[key] = []
        defaults[key] = value
    for name, func in defaults.items():
        monkeypatch.setattr(folders_route, name, func)
    return capture


def test_list_folders_returns_rows(monkeypatch):
    rows = [_row(name="TOEIC"), _row(name="常錯")]
    _patch_dao(monkeypatch, get_folders=lambda user_id: rows)

    response = client.get("/folders", headers=auth_headers())

    assert response.status_code == 200
    assert [f["name"] for f in response.json()] == ["TOEIC", "常錯"]


def test_list_folders_passes_canonical_uuid(monkeypatch):
    seen = {}
    _patch_dao(monkeypatch, get_folders=lambda user_id: seen.setdefault("user_id", user_id) or [])

    user_id = uuid.uuid4()
    client.get("/folders", headers=auth_headers(user_id))

    assert seen["user_id"] == user_id  # JWT sub 正規化成 UUID 才進 service


def test_create_folder_returns_row(monkeypatch):
    row = _row(name="TOEIC")
    seen = {}

    def fake_add(user_id, name):
        seen["name"] = name
        return row

    _patch_dao(monkeypatch, add_folder=fake_add)

    response = client.post("/folders", json={"name": "TOEIC"}, headers=auth_headers())

    assert response.status_code == 200
    assert response.json()["name"] == "TOEIC"
    assert seen["name"] == "TOEIC"


def test_create_folder_duplicate_name_returns_409_with_chinese_detail(monkeypatch):
    # PostgREST 的 unique violation 是 409;detail 會透傳給使用者 → 必須是中文
    from fastapi import HTTPException

    def fake_add(user_id, name):
        raise HTTPException(status_code=409, detail="已經有同名資料夾")

    _patch_dao(monkeypatch, add_folder=fake_add)

    response = client.post("/folders", json={"name": "TOEIC"}, headers=auth_headers())

    assert response.status_code == 409
    assert response.json()["detail"] == "已經有同名資料夾"


@pytest.mark.parametrize("payload", [{"name": ""}, {"name": "   "}, {"name": "A" * 51}, {}])
def test_create_folder_validation_returns_422(monkeypatch, payload):
    _patch_dao(monkeypatch, add_folder=lambda user_id, name: _row())

    response = client.post("/folders", json=payload, headers=auth_headers())

    assert response.status_code == 422


def test_rename_folder_returns_updated_row(monkeypatch):
    seen = {}

    def fake_update(user_id, folder_id, name):
        seen["folder_id"] = folder_id
        seen["name"] = name
        return _row(name=name)

    _patch_dao(monkeypatch, update_folder=fake_update)

    folder_id = uuid.uuid4()
    response = client.patch(
        f"/folders/{folder_id}", json={"name": "新名字"}, headers=auth_headers()
    )

    assert response.status_code == 200
    assert response.json()["name"] == "新名字"
    assert seen["folder_id"] == folder_id


def test_rename_rejects_non_uuid_folder_id(monkeypatch):
    _patch_dao(monkeypatch, update_folder=lambda *a: _row())

    response = client.patch("/folders/not-a-uuid", json={"name": "x"}, headers=auth_headers())

    assert response.status_code == 422


def test_rename_missing_folder_returns_404(monkeypatch):
    from fastapi import HTTPException

    def fake_update(user_id, folder_id, name):
        raise HTTPException(status_code=404, detail="找不到這個資料夾")

    _patch_dao(monkeypatch, update_folder=fake_update)

    response = client.patch(
        f"/folders/{uuid.uuid4()}", json={"name": "x"}, headers=auth_headers()
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "找不到這個資料夾"


def test_delete_folder_returns_204_and_calls_service(monkeypatch):
    seen = {}

    def fake_remove(user_id, folder_id):
        seen["folder_id"] = folder_id

    _patch_dao(monkeypatch, remove_folder=fake_remove)

    folder_id = uuid.uuid4()
    response = client.delete(f"/folders/{folder_id}", headers=auth_headers())

    assert response.status_code == 204
    assert response.content == b""
    assert seen["folder_id"] == folder_id


def test_delete_missing_folder_returns_404(monkeypatch):
    from fastapi import HTTPException

    def fake_remove(user_id, folder_id):
        raise HTTPException(status_code=404, detail="找不到這個資料夾")

    _patch_dao(monkeypatch, remove_folder=fake_remove)

    response = client.delete(f"/folders/{uuid.uuid4()}", headers=auth_headers())

    assert response.status_code == 404


def test_read_endpoint_is_rate_limited(monkeypatch):
    _patch_dao(monkeypatch, get_folders=lambda user_id: [])

    headers = auth_headers()  # 同一位使用者
    for _ in range(folders_route.FOLDERS_READ_REQUESTS_PER_MINUTE):
        assert client.get("/folders", headers=headers).status_code == 200

    limited = client.get("/folders", headers=headers)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1


def test_write_endpoints_share_one_rate_limit_bucket(monkeypatch):
    """三個寫入端點共用同一桶 20/min。

    rate_limited() 每次呼叫都建一個新的 FixedWindowLimiter(各自獨立的計數 dict),
    所以一定要在模組層建一次、三個端點共用同一個依賴;若有人改成 inline 呼叫,
    這裡會紅。
    """
    _patch_dao(
        monkeypatch,
        add_folder=lambda user_id, name: _row(),
        remove_folder=lambda user_id, folder_id: None,
    )

    headers = auth_headers()  # 同一位使用者
    # 10 次建立 + 10 次刪除 = 20,剛好用完
    for _ in range(10):
        assert client.post("/folders", json={"name": "A"}, headers=headers).status_code == 200
    for _ in range(10):
        assert client.delete(f"/folders/{uuid.uuid4()}", headers=headers).status_code == 204

    limited = client.post("/folders", json={"name": "A"}, headers=headers)
    assert limited.status_code == 429
