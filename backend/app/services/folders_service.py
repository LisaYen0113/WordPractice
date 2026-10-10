# app/services/folders_service.py
import uuid

from fastapi import HTTPException

from app.daos.folders_dao import (
    create_folder,
    delete_folder,
    get_folder,
    list_folders,
    rename_folder,
)
from app.daos.user_words_dao import update_user_word_folder

# DB 的 unique (user_id, name) 被違反時 PostgREST 回 409,
# 但 supabase_request 的 detail 是刻意通用的 "Database request failed"(避免洩漏 schema)。
# 409 會透傳給使用者(client.js 直接採用 detail)→ 在這裡換成看得懂的中文。
_DUPLICATE_NAME = "已經有同名資料夾"


def _translate_unique_violation(error: HTTPException) -> HTTPException:
    """409(unique violation)→ 中文訊息;其他狀態碼原樣往上拋"""
    if error.status_code == 409:
        return HTTPException(status_code=409, detail=_DUPLICATE_NAME)
    return error


def get_folders(user_id: uuid.UUID) -> list:
    return list_folders(str(user_id))


def add_folder(user_id: uuid.UUID, name: str) -> dict:
    try:
        row = create_folder(str(user_id), name)
    except HTTPException as error:
        raise _translate_unique_violation(error) from error
    if not row:
        # 上游回空 representation(不該發生) → 500 的 detail 只給 log 看,用英文
        raise HTTPException(status_code=500, detail="Failed to create folder")
    return row


def update_folder(user_id: uuid.UUID, folder_id: uuid.UUID, name: str) -> dict:
    try:
        return rename_folder(str(user_id), str(folder_id), name)
    except HTTPException as error:
        raise _translate_unique_violation(error) from error


def remove_folder(user_id: uuid.UUID, folder_id: uuid.UUID) -> None:
    """刪除資料夾。裡面的字由 DB 的 ON DELETE SET NULL 退回未分類,進度不動。"""
    delete_folder(str(user_id), str(folder_id))


def assign_folder(
    user_id: uuid.UUID, word_id: uuid.UUID, folder_id: uuid.UUID | None
) -> dict:
    """把字指派到資料夾;folder_id=None → 移回未分類。

    FK 只保證資料夾存在,不保證是我的 → 這裡自己驗。驗不過一律 404,
    不用 403:不洩漏「這個 id 存在,只是不是你的」。
    """
    if folder_id is not None and not get_folder(str(user_id), str(folder_id)):
        raise HTTPException(status_code=404, detail="找不到這個資料夾")

    row = update_user_word_folder(
        str(user_id),
        str(word_id),
        str(folder_id) if folder_id is not None else None,
    )
    return {"word_id": word_id, "folder_id": row["folder_id"]}
