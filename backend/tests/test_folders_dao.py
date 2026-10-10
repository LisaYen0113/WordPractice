"""folders DAO 的租戶範圍:service key 繞過 RLS,DAO 的 user_id 條件是唯一防線"""
import uuid

import pytest
from fastapi import HTTPException

from app.daos import folders_dao


def _capture(monkeypatch, result):
    captured = {}

    def fake_request(method, table, params=None, data=None, prefer=None):
        captured.update(method=method, table=table, params=params, data=data, prefer=prefer)
        return result

    monkeypatch.setattr(folders_dao, "supabase_request", fake_request)
    return captured


def test_list_folders_is_scoped_and_ordered(monkeypatch):
    captured = _capture(monkeypatch, [])

    user_id = uuid.uuid4()
    folders_dao.list_folders(str(user_id))

    assert captured["method"] == "GET"
    assert captured["table"] == "folders"
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    # 穩定次序:同一次建立的資料夾不能每次重整都換位置
    assert captured["params"]["order"] == "created_at.asc"
    assert captured["params"]["select"] == "id,name,created_at"


def test_create_folder_posts_with_owner(monkeypatch):
    row = {"id": "f-1", "name": "TOEIC", "created_at": "2026-10-10T00:00:00Z"}
    captured = _capture(monkeypatch, [row])

    user_id = uuid.uuid4()
    result = folders_dao.create_folder(str(user_id), "TOEIC")

    assert result == row
    assert captured["method"] == "POST"
    assert captured["table"] == "folders"
    # user_id 一定要由後端帶,不能信任客戶端
    assert captured["data"] == {"user_id": str(user_id), "name": "TOEIC"}


def test_create_folder_returns_none_for_empty_representation(monkeypatch):
    monkeypatch.setattr(folders_dao, "supabase_request", lambda *a, **k: [])

    assert folders_dao.create_folder("u-1", "TOEIC") is None


def test_get_folder_is_scoped_to_user(monkeypatch):
    captured = _capture(monkeypatch, [])

    user_id = uuid.uuid4()
    folder_id = uuid.uuid4()
    folders_dao.get_folder(str(user_id), str(folder_id))

    assert captured["params"]["user_id"] == f"eq.{user_id}"
    assert captured["params"]["id"] == f"eq.{folder_id}"


def test_get_folder_returns_none_when_not_found(monkeypatch):
    _capture(monkeypatch, [])

    assert folders_dao.get_folder("u-1", "f-x") is None


def test_rename_folder_is_scoped_and_requires_representation(monkeypatch):
    row = {"id": "f-1", "name": "新名字", "created_at": "2026-10-10T00:00:00Z"}
    captured = _capture(monkeypatch, [row])

    user_id = uuid.uuid4()
    folder_id = uuid.uuid4()
    result = folders_dao.rename_folder(str(user_id), str(folder_id), "新名字")

    assert result == row
    assert captured["method"] == "PATCH"
    assert captured["params"]["id"] == f"eq.{folder_id}"
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    assert captured["data"] == {"name": "新名字"}
    # 不要求 representation 的話,scoped PATCH 沒中列會靜默回 204(假成功)
    assert captured["prefer"] == "return=representation"


def test_rename_folder_raises_404_when_no_row_matched(monkeypatch):
    _capture(monkeypatch, [])

    with pytest.raises(HTTPException) as excinfo:
        folders_dao.rename_folder("u-1", "f-x", "新名字")

    assert excinfo.value.status_code == 404


def test_delete_folder_is_scoped_and_requires_representation(monkeypatch):
    row = {"id": "f-1", "name": "TOEIC", "created_at": "2026-10-10T00:00:00Z"}
    captured = _capture(monkeypatch, [row])

    user_id = uuid.uuid4()
    folder_id = uuid.uuid4()
    result = folders_dao.delete_folder(str(user_id), str(folder_id))

    assert result == row
    assert captured["method"] == "DELETE"
    assert captured["params"]["id"] == f"eq.{folder_id}"
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    # 0 列的 DELETE 也回 204 → 一定要要求 representation 才分得出「刪掉了」
    assert captured["prefer"] == "return=representation"


def test_delete_folder_raises_404_when_no_row_matched(monkeypatch):
    _capture(monkeypatch, [])

    with pytest.raises(HTTPException) as excinfo:
        folders_dao.delete_folder("u-1", "f-x")

    assert excinfo.value.status_code == 404
