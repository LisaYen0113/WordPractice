# app/routes/tests_route.py
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.demo_quota import limit_demo_ai
from app.core.rate_limit import rate_limited
from app.core.scoring import CORRECT_THRESHOLD
from app.schemas.test import DefinitionSubmission
from app.services.test_service import process_definition_test

router = APIRouter()

# 每次判分都會打付費 Gemini,依使用者限流(每分鐘)
SUBMIT_REQUESTS_PER_MINUTE = 30


# 與 /words/fill 共用同一個示範帳號配額(額度屬於帳號,不是端點)
@router.post("/submit_definition", dependencies=[Depends(limit_demo_ai)])
def submit_definition(
    sub: DefinitionSubmission,
    user_id: uuid.UUID = Depends(rate_limited("submit_definition", SUBMIT_REQUESTS_PER_MINUTE)),
):
    result = process_definition_test(user_id, sub.word_id, sub.user_input_zh)
    if not result:
        raise HTTPException(404, "Word not found")

    return {
        "word_id": sub.word_id,
        "is_correct": result.score >= CORRECT_THRESHOLD,
        "feedback": result.ai_feedback,
        "score": result.score
    }
