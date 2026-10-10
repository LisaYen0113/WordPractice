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

# 「資料夾不存在」對外用同一句話:擁有權驗不過、以及 assign 途中資料夾被刪掉,
# 都回這一句 —— 兩種情況都不該洩漏「這個 id 存在,只是不是你的/剛被刪」。
_FOLDER_NOT_FOUND = "找不到這個資料夾"


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

    上面的檢查與下面的寫入之間有縫:資料夾若在這段期間被刪掉,寫入會撞 FK
    → PostgREST 409 + 通用英文 detail,原樣透傳就是英文外洩到畫面。
    語意上資料夾已經不存在 → 換成與擁有權檢查同一句中文 404。
    """
    if folder_id is not None and not get_folder(str(user_id), str(folder_id)):
        raise HTTPException(status_code=404, detail=_FOLDER_NOT_FOUND)

    try:
        row = update_user_word_folder(
            str(user_id),
            str(word_id),
            str(folder_id) if folder_id is not None else None,
        )
    except HTTPException as error:
        # 只有 409(FK 違反)改寫;DAO 自己的 404 等其他錯誤原樣往上拋
        if error.status_code == 409:
            raise HTTPException(
                status_code=404, detail=_FOLDER_NOT_FOUND
            ) from error
        raise
    return {"word_id": word_id, "folder_id": row["folder_id"]}
