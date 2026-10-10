# app/services/familiarity_service.py
import uuid

from fastapi import HTTPException

from app.daos.user_words_dao import get_user_word_progress, update_user_word
from app.services.srs_service import familiarity_override


def set_word_familiarity(user_id: uuid.UUID, word_id: uuid.UUID, familiar: bool) -> dict:
    """標記/取消標記熟悉:手動覆寫 SRS 排程。

    沒有該字的進度列 → 404(不能無中生有:字得先透過 /fill 進清單)。
    只寫 familiarity_score + next_review_date —— 人為覆寫不算一次複習,
    last_review_date 與 error_count 原封不動。回應值以資料庫回傳的列為準。
    """
    rows = get_user_word_progress(str(user_id), str(word_id))
    if not rows:
        raise HTTPException(status_code=404, detail="這個字不在你的單字庫中")

    next_date, familiarity_score = familiarity_override(familiar)
    updated = update_user_word(
        str(user_id),
        rows[0]["id"],
        {
            "familiarity_score": familiarity_score,
            "next_review_date": next_date.isoformat(),
        },
    )
    row = updated[0]

    return {
        "word_id": word_id,
        "familiarity_score": row["familiarity_score"],
        "next_review_date": row["next_review_date"],
        "familiar": familiar,
    }
