"""folders_service 的錯誤轉譯與 id 字串化。

route 測試（test_folders_route.py）把 route 模組裡的 service 名字換成 stub，
真的 service 因此從來沒被執行過。這裡反過來：換掉 service 底下的 DAO 符號，
讓真的 service 函式跑，釘住「哪個狀態碼換成什麼訊息」。
"""

import uuid

import pytest
from fastapi import HTTPException

from app.services import folders_service

# 刻意抄字面值、不 import service 的 _DUPLICATE_NAME：
# 若有人把它改成英文（或改動措辭），這個測試必須跟著紅。
_DUPLICATE_DETAIL = "已經有同名資料夾"

# DAO 實際會丟的 409：supabase_request 的 detail 刻意通用，避免洩漏 schema
_UPSTREAM_409 = "Database request failed"


def _fake_dao(monkeypatch, name, result=None, error=None):
    """換掉 folders_service 裡的 DAO 符號，回傳呼叫紀錄。

    folders_service.py 是 `from app.daos.folders_dao import create_folder` ——
    符號在 import 時就綁進 service 模組自己的 namespace，
    所以要換的是 folders_service.create_folder；換 folders_dao.create_folder 沒有用。
    """
    seen = {}

    def fake(*args, **kwargs):
        seen["args"] = args
        if error is not None:
            raise error
        return result

    monkeypatch.setattr(folders_service, name, fake)
    return seen


def test_add_folder_translates_409_to_chinese(monkeypatch):
    """重複名稱的 409 一定要變成看得懂的中文（英文 detail 會原樣顯示給使用者）"""
    _fake_dao(
        monkeypatch,
        "create_folder",
        error=HTTPException(status_code=409, detail=_UPSTREAM_409),
    )

    with pytest.raises(HTTPException) as excinfo:
        folders_service.add_folder(uuid.uuid4(), "TOEIC")

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == _DUPLICATE_DETAIL


def test_add_folder_preserves_non_409(monkeypatch):
    """只有 409 被換掉，其他狀態碼原樣往上拋（同一個例外物件）"""
    original = HTTPException(status_code=502, detail=_UPSTREAM_409)
    _fake_dao(monkeypatch, "create_folder", error=original)

    with pytest.raises(HTTPException) as excinfo:
        folders_service.add_folder(uuid.uuid4(), "TOEIC")

    assert excinfo.value is original


def test_update_folder_translates_409_to_chinese(monkeypatch):
    """改名撞名走同一條轉譯"""
    _fake_dao(
        monkeypatch,
        "rename_folder",
        error=HTTPException(status_code=409, detail=_UPSTREAM_409),
    )

    with pytest.raises(HTTPException) as excinfo:
        folders_service.update_folder(uuid.uuid4(), uuid.uuid4(), "TOEIC")

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == _DUPLICATE_DETAIL


def test_update_folder_preserves_dao_404(monkeypatch):
    """不是自己的資料夾 → DAO 的 404 原樣穿過 service（route 靠它回 404）"""
    original = HTTPException(status_code=404, detail="找不到這個資料夾")
    _fake_dao(monkeypatch, "rename_folder", error=original)

    with pytest.raises(HTTPException) as excinfo:
        folders_service.update_folder(uuid.uuid4(), uuid.uuid4(), "TOEIC")

    assert excinfo.value is original


def test_remove_folder_preserves_dao_404(monkeypatch):
    """刪別人的資料夾同理：沒中列 → 404 原樣往上"""
    original = HTTPException(status_code=404, detail="找不到這個資料夾")
    _fake_dao(monkeypatch, "delete_folder", error=original)

    with pytest.raises(HTTPException) as excinfo:
        folders_service.remove_folder(uuid.uuid4(), uuid.uuid4())

    assert excinfo.value is original


def test_add_folder_raises_500_for_empty_representation(monkeypatch):
    """上游回空 representation（不該發生）→ 500，且 detail 必須是英文

    5xx 的 detail 會被 client.js 換成「伺服器發生錯誤，請稍後再試」，
    所以它只給 log 看，一律 ASCII。
    """
    _fake_dao(monkeypatch, "create_folder", result=None)

    with pytest.raises(HTTPException) as excinfo:
        folders_service.add_folder(uuid.uuid4(), "TOEIC")

    assert excinfo.value.status_code == 500
    assert excinfo.value.detail.isascii()


def test_get_folders_returns_dao_rows(monkeypatch):
    rows = [{"id": "f-1", "name": "TOEIC", "created_at": "2026-10-10T00:00:00Z"}]
    _fake_dao(monkeypatch, "list_folders", result=rows)

    assert folders_service.get_folders(uuid.uuid4()) == rows


@pytest.mark.parametrize(
    "dao_name, invoke",
    [
        ("list_folders", lambda uid, fid: folders_service.get_folders(uid)),
        ("create_folder", lambda uid, fid: folders_service.add_folder(uid, "TOEIC")),
        (
            "rename_folder",
            lambda uid, fid: folders_service.update_folder(uid, fid, "TOEIC"),
        ),
        ("delete_folder", lambda uid, fid: folders_service.remove_folder(uid, fid)),
    ],
)
def test_service_stringifies_ids_for_dao(monkeypatch, dao_name, invoke):
    """service 的介面是 uuid.UUID、DAO 的介面是 str —— 轉換要在 service 做完

    漏掉的話 PostgREST 收到的是 "UUID('...')" 那種字面值，查不到任何列。
    """
    seen = _fake_dao(monkeypatch, dao_name, result={"id": "f-1"})
    user_id = uuid.uuid4()
    folder_id = uuid.uuid4()

    invoke(user_id, folder_id)

    assert str(user_id) in seen["args"]
    assert not any(isinstance(arg, uuid.UUID) for arg in seen["args"])
    if dao_name in ("rename_folder", "delete_folder"):
        assert str(folder_id) in seen["args"]
