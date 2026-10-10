# app/daos/user_words_dao.py
from fastapi import HTTPException

from app.core.supabase_client import supabase_request

def get_user_words_due_today(user_id: str, today_str: str):
    return supabase_request(
        "GET",
        "user_words",
        params={
            "user_id": f"eq.{user_id}",
            "next_review_date": f"lte.{today_str}",
            "select": "word_id,familiarity_score",
            "order": "next_review_date.asc",
            "limit": "50",
        }
    )

def get_all_user_words(user_id: str):
    """該使用者的全部單字(含已排到未來的),給單字清單用;不過濾到期日"""
    return supabase_request(
        "GET",
        "user_words",
        params={
            "user_id": f"eq.{user_id}",
            "select": "word_id,familiarity_score",
            # 同一天加入的字日期相同 → 加 id 當次要排序,清單順序才穩定
            "order": "next_review_date.asc,id.asc",
            "limit": "200",
        }
    )


def get_user_word_progress(user_id: str, word_id: str):
    return supabase_request(
        "GET",
        "user_words",
        params={
            "user_id": f"eq.{user_id}",
            "word_id": f"eq.{word_id}",
            "select": "id,familiarity_score,error_count"
        }
    )

def create_user_word(user_id: str, word_id: str, today_str: str):
    """為使用者建立複習列(熟練度 0、今天到期);回傳新列(dict)或 None"""
    result = supabase_request(
        "POST",
        "user_words",
        data={
            "user_id": user_id,
            "word_id": word_id,
            "familiarity_score": 0,
            "error_count": 0,
            "next_review_date": today_str,
        }
    )
    # Prefer: return=representation → 回傳 list,取出那一筆
    if isinstance(result, list):
        return result[0] if result else None
    return result

def update_user_word(user_id: str, row_id, data: dict):
    """更新複習進度。一律帶 user_id 範圍:service key 會繞過 RLS,DAO 是唯一防線。

    要求上游回傳被更新的列:scoped PATCH 沒中任何列時 PostgREST 預設靜默回 204,
    進度會「假成功」但根本沒更新 → 這裡改成明確報錯
    """
    result = supabase_request(
        "PATCH",
        "user_words",
        params={"id": f"eq.{row_id}", "user_id": f"eq.{user_id}"},
        data=data,
        prefer="return=representation",
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to update review progress")
    return result
