# app/routes/words_route.py
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.core.logger import logger
from app.core.rate_limit import rate_limited
from app.daos.user_words_dao import get_all_user_words, get_user_words_due_today
from app.daos.words_dao import get_words_by_ids
from app.schemas.words import (
    MarkFamiliarRequest,
    MarkFamiliarResponse,
    NewWordRequest,
    WordCard,
)
from app.schemas.folders import SetFolderRequest, SetFolderResponse
# 只需要 assign_folder。folders_service 裡**沒有** get_folder —— 那個名字是 DAO 的
# (app/daos/folders_dao.py);service 層的列表函式叫 get_folders(複數)。
# 擁有者驗證在 assign_folder 內部自己呼叫 DAO 的 get_folder,route 不必碰。
from app.services.folders_service import assign_folder
from app.services.familiarity_service import set_word_familiarity
from app.services.words_service import fill_word_details

router = APIRouter()

# 每次 /fill 都會打付費 Gemini,依使用者限流(每分鐘)
FILL_REQUESTS_PER_MINUTE = 12
# /review 與 /deck 只讀自己的列,但每次兩個 PostgREST 查詢 → 給寬鬆上限防單帳號刷爆上游
REVIEW_REQUESTS_PER_MINUTE = 60
DECK_REQUESTS_PER_MINUTE = 60
# 標記熟悉是單列寫入,同樣給寬鬆的每使用者上限
MARK_FAMILIAR_REQUESTS_PER_MINUTE = 60
# 指派是單列寫入,與 mark_familiar 同級
SET_FOLDER_REQUESTS_PER_MINUTE = 60


def _build_cards(user_words: list) -> list[WordCard]:
    """user_words 列(word_id/familiarity_score/folder_id)→ 單字卡;兩個清單端點共用"""
    if not user_words:
        return []

    ids = [str(u["word_id"]) for u in user_words]
    # 以 word_id 索引整列:熟悉度與資料夾都從同一列取,不用維護兩份 map。
    # folder_id 用 .get → 舊測試的 fixture 沒有這個鍵也不會 KeyError(未分類 = None)
    by_word_id = {str(u["word_id"]): u for u in user_words}

    words = get_words_by_ids(ids)

    return [
        WordCard(
            word_id=w["id"],
            word=w["word"],
            pos=w["pos"],
            definition=w["definition"],
            kk_pronunciation=w["kk_pronunciation"],
            etymology=w.get("etymology"),
            synonyms=w.get("synonyms"),
            toeic_examples=w.get("toeic_examples"),
            familiarity_score=by_word_id[str(w["id"])]["familiarity_score"],
            folder_id=by_word_id[str(w["id"])].get("folder_id"),
        )
        for w in words
    ]


@router.get("/review", response_model=list[WordCard])
def get_review_cards(
    user_id: uuid.UUID = Depends(rate_limited("review", REVIEW_REQUESTS_PER_MINUTE))
):
    """今天到期的字(未來「今日複習」用);單字清單請用 /deck"""
    today = date.today().isoformat()
    return _build_cards(get_user_words_due_today(user_id, today))


@router.get("/deck", response_model=list[WordCard])
def get_deck(
    user_id: uuid.UUID = Depends(rate_limited("deck", DECK_REQUESTS_PER_MINUTE))
):
    """呼叫者全部的字(含已排到未來的)——單字清單頁用"""
    return _build_cards(get_all_user_words(user_id))


@router.post("/fill")
def api_fill_word(
    request: NewWordRequest,
    user_id: uuid.UUID = Depends(rate_limited("fill", FILL_REQUESTS_PER_MINUTE)),
):
    """
    呼叫 Gemini 生成完整單字資訊、存入 words 表,
    並把字加入呼叫者的複習清單(user_words)
    """
    logger.info(f"API /fill called by {user_id} with word: {request.word}")
    try:
        return fill_word_details(request.word, user_id)
    except Exception as e:
        # 詳細錯誤只留 server log,回應用通用訊息
        logger.error(f"API /fill error for word '{request.word}': {e}")
        raise HTTPException(status_code=500, detail="Failed to generate word details")


@router.post("/mark_familiar", response_model=MarkFamiliarResponse)
def api_mark_familiar(
    request: MarkFamiliarRequest,
    user_id: uuid.UUID = Depends(
        rate_limited("mark_familiar", MARK_FAMILIAR_REQUESTS_PER_MINUTE)
    ),
):
    """標記/取消標記熟悉(持久化到 DB);覆寫 SRS 排程"""
    try:
        return set_word_familiarity(user_id, request.word_id, request.familiar)
    except HTTPException:
        # 404、DAO 的 500 等已帶明確訊息 → 原樣往外拋,不被下面的通用 500 蓋掉
        raise
    except Exception as e:
        logger.error(f"API /mark_familiar error for word {request.word_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update familiarity")


@router.put("/{word_id}/folder", response_model=SetFolderResponse)
def api_set_word_folder(
    word_id: uuid.UUID,
    request: SetFolderRequest,
    user_id: uuid.UUID = Depends(
        rate_limited("set_folder", SET_FOLDER_REQUESTS_PER_MINUTE)
    ),
):
    """把字指派到資料夾(folder_id=null → 移回未分類)。

    word_id 是 words.id(字典字庫),與 /mark_familiar 一致。
    """
    return assign_folder(user_id, word_id, request.folder_id)
