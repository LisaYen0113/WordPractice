# app/daos/folders_dao.py
from fastapi import HTTPException

from app.core.supabase_client import supabase_request

# 只抓前端要用的欄位
_FOLDER_COLUMNS = "id,name,created_at"

_NOT_FOUND = "找不到這個資料夾"


def list_folders(user_id: str):
    return supabase_request(
        "GET",
        "folders",
        params={
            "user_id": f"eq.{user_id}",
            "select": _FOLDER_COLUMNS,
            "order": "created_at.asc",
        },
    )


def create_folder(user_id: str, name: str):
    """建立資料夾;回傳新列(dict)或 None。名稱重複由 DB 的 unique 擋(上游 409)"""
    result = supabase_request(
        "POST",
        "folders",
        data={"user_id": user_id, "name": name},
    )
    # Prefer: return=representation 是 supabase_request 對 POST 的預設 → 回傳 list
    if isinstance(result, list):
        return result[0] if result else None
    return result


def get_folder(user_id: str, folder_id: str):
    """取單一資料夾;不存在或不屬於該使用者都回 None(呼叫端一律轉 404)"""
    result = supabase_request(
        "GET",
        "folders",
        params={
            "user_id": f"eq.{user_id}",
            "id": f"eq.{folder_id}",
            "select": _FOLDER_COLUMNS,
        },
    )
    if isinstance(result, list):
        return result[0] if result else None
    return result


def rename_folder(user_id: str, folder_id: str, name: str):
    """改名。一律帶 user_id 範圍:service key 會繞過 RLS,DAO 是唯一防線。

    scoped PATCH 沒中任何列時 PostgREST 預設靜默回 204 → 要求 representation,
    空結果就是「不是你的資料夾或已刪除」,轉 404。
    """
    result = supabase_request(
        "PATCH",
        "folders",
        params={"id": f"eq.{folder_id}", "user_id": f"eq.{user_id}"},
        data={"name": name},
        prefer="return=representation",
    )
    if not result:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return result[0]


def delete_folder(user_id: str, folder_id: str):
    """刪除。裡面的字由 FK 的 ON DELETE SET NULL 退回未分類,複習進度不動。

    0 列的 DELETE 一樣回 204 → 要求 representation,空結果轉 404。
    """
    result = supabase_request(
        "DELETE",
        "folders",
        params={"id": f"eq.{folder_id}", "user_id": f"eq.{user_id}"},
        prefer="return=representation",
    )
    if not result:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return result[0]
