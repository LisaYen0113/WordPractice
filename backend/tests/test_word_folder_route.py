"""PUT /words/{word_id}/folder —— 指派單字到資料夾。

安全關鍵:後端用 service key 繞過 RLS,所以「這個資料夾是不是你的」只能靠
service 自己驗。別人的資料夾要回 404(不是 403,不洩漏它存在)。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.routes import words_route
from app.services import folders_service
from tests.auth_helpers import auth_headers

client = TestClient(app, raise_server_exceptions=False)


def _patch(monkeypatch, folder_row=None, assigned_row=None):
    """只換掉 assign_folder 底下的 DAO 符號,讓真正的擁有者驗證照跑。

    擁有者驗證在 folders_service.assign_folder 裡(它呼叫 DAO 的 get_folder),
    words_route 只負責轉參數。若把 words_route.assign_folder 整個換成 stub,
    這組測試最該釘住的「別人的資料夾 → 404 且完全不寫 DB」就永遠測不到
    ——stub 不會 404,測試卻因為斷言 404 而紅,紅的理由還是錯的。
    """
    seen = {}

    def fake_get_folder(user_id, folder_id):
        seen["get_folder"] = (user_id, folder_id)
        return folder_row

    def fake_update(user_id, word_id, folder_id):
        seen["assign"] = (user_id, word_id, folder_id)
        if assigned_row is None:
            return {"word_id": word_id, "folder_id": folder_id}
        return assigned_row

    monkeypatch.setattr(folders_service, "get_folder", fake_get_folder)
    monkeypatch.setattr(folders_service, "update_user_word_folder", fake_update)
    return seen


def test_assign_to_own_folder_returns_folder_id(monkeypatch):
    folder_id = uuid.uuid4()
    seen = _patch(monkeypatch, folder_row={"id": str(folder_id), "name": "TOEIC"})

    word_id = uuid.uuid4()
    response = client.put(
        f"/words/{word_id}/folder",
        json={"folder_id": str(folder_id)},
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.json() == {"word_id": str(word_id), "folder_id": str(folder_id)}
    # 真 assign_folder 傳給 DAO 的是字串化後的 UUID,不是 UUID 物件
    assert seen["assign"][2] == str(folder_id)


def test_assign_to_someone_elses_folder_returns_404(monkeypatch):
    """資料夾不屬於呼叫者(或已刪除)→ 404,而且絕不能真的寫進 DB"""
    seen = _patch(monkeypatch, folder_row=None)

    response = client.put(
        f"/words/{uuid.uuid4()}/folder",
        json={"folder_id": str(uuid.uuid4())},
        headers=auth_headers(),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "找不到這個資料夾"
    assert "assign" not in seen  # 驗證沒過就不該往下寫


def test_assign_null_skips_folder_lookup(monkeypatch):
    """null = 移回未分類,不需要驗資料夾擁有權"""
    seen = _patch(monkeypatch)

    word_id = uuid.uuid4()
    response = client.put(
        f"/words/{word_id}/folder", json={"folder_id": None}, headers=auth_headers()
    )

    assert response.status_code == 200
    assert response.json() == {"word_id": str(word_id), "folder_id": None}
    assert "get_folder" not in seen


def test_assign_missing_field_returns_422(monkeypatch):
    """{} 少帶欄位 ≠ 取消指派 → 422(與 folder_id: null 區分開)"""
    _patch(monkeypatch)

    response = client.put(
        f"/words/{uuid.uuid4()}/folder", json={}, headers=auth_headers()
    )

    assert response.status_code == 422


def test_assign_word_not_in_list_returns_404(monkeypatch):
    """字不在自己的單字庫 → DAO 的 404 穿過 service 與 route,原樣回給前端

    這個 404 是 user_words_dao.update_user_word_folder 自己丟的(找不到列),
    所以換掉那一層、讓真的 assign_folder 跑,才測得到「不吞掉、不改碼」。
    """
    from fastapi import HTTPException

    _patch(monkeypatch)

    def fake_update(user_id, word_id, folder_id):
        raise HTTPException(status_code=404, detail="這個字不在你的單字庫中")

    monkeypatch.setattr(folders_service, "update_user_word_folder", fake_update)

    response = client.put(
        f"/words/{uuid.uuid4()}/folder", json={"folder_id": None}, headers=auth_headers()
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "這個字不在你的單字庫中"


def test_assign_is_rate_limited(monkeypatch):
    _patch(monkeypatch)

    headers = auth_headers()
    for _ in range(words_route.SET_FOLDER_REQUESTS_PER_MINUTE):
        response = client.put(
            f"/words/{uuid.uuid4()}/folder", json={"folder_id": None}, headers=headers
        )
        assert response.status_code == 200

    limited = client.put(
        f"/words/{uuid.uuid4()}/folder", json={"folder_id": None}, headers=headers
    )
    assert limited.status_code == 429
