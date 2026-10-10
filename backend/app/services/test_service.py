# app/services/test_service.py
import uuid
from datetime import date, datetime

from fastapi import HTTPException

from app.core.scoring import CORRECT_THRESHOLD
from app.daos.mistakes_dao import record_mistake
from app.daos.user_words_dao import create_user_word, get_user_word_progress, update_user_word
from app.daos.words_dao import get_word_basic
from app.services.ai_service import judge_definition
from app.services.srs_service import calculate_next_review_date


def _get_or_create_progress(user_id: uuid.UUID, word_id: uuid.UUID) -> dict:
    """取回該使用者對該字的進度列;沒有就建一列(空 DB 首次測驗)。

    409 = 併發下已被另一個請求建立,重查即可。
    """
    rows = get_user_word_progress(str(user_id), str(word_id))
    if rows:
        return rows[0]

    try:
        created = create_user_word(str(user_id), str(word_id), date.today().isoformat())
    except HTTPException as e:
        if e.status_code != 409:
            raise
        created = None

    if not created:
        rows = get_user_word_progress(str(user_id), str(word_id))
        if rows:
            return rows[0]
        raise HTTPException(status_code=500, detail="Failed to initialize review progress")

    return created


def process_definition_test(user_id: uuid.UUID, word_id: uuid.UUID, user_zh: str):
    # 查單字
    word_data = get_word_basic(str(word_id))
    if not word_data:
        return None
    wd = word_data[0]

    # AI 判分
    ai_result = judge_definition(wd["word"], wd["definition"], user_zh)

    # 讀使用者進度(沒有就建立)
    progress = _get_or_create_progress(user_id, word_id)

    # 計算新 SRS
    next_date, new_familiarity = calculate_next_review_date(ai_result.score, progress["familiarity_score"])
    new_error_count = progress["error_count"] + (1 if ai_result.score < CORRECT_THRESHOLD else 0)

    # 更新 user_words(帶 user_id 範圍:service key 繞過 RLS,這裡是唯一防線)
    update_user_word(
        str(user_id),
        progress["id"],
        {
            "familiarity_score": new_familiarity,
            "error_count": new_error_count,
            "last_review_date": datetime.now().isoformat(),
            "next_review_date": next_date.isoformat()
        }
    )

    # 錯誤紀錄(只有答錯才會走到這裡,is_correct 恆為 False)
    if ai_result.score < CORRECT_THRESHOLD:
        record_mistake({
            "user_id": str(user_id),
            "word_id": str(word_id),
            "test_type": "eng_to_zh",
            "user_input": user_zh,
            "is_correct": False,
            "ai_feedback": ai_result.ai_feedback,
            "ai_mistake_type": ai_result.ai_mistake_type
        })

    return ai_result
