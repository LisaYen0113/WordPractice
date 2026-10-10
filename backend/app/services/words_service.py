import json
import re
import uuid
from datetime import date

from fastapi import HTTPException
from google import genai

from app.core.config import GEMINI_API_KEY, GEMINI_MODEL
from app.core.logger import logger
from app.daos.user_words_dao import create_user_word
from app.daos.words_dao import get_word_by_text, insert_word
from app.schemas.words import WordDetailResponse
from app.utils.retry_failed_words import log_failed_word

client = genai.Client(api_key=GEMINI_API_KEY)

REQUIRED_FIELDS = ["word", "pos", "definition", "kk_pronunciation"]
JSONB_FIELDS = ["synonyms", "antonyms", "inflections", "phrases", "toeic_examples"]


def _extract_word_data(raw_text: str, word: str) -> dict:
    """Gemini 回覆文字 → dict:先直接 json.loads,再試 ```json``` 區塊"""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        match = re.search(r"```json\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        raise ValueError(f"Cannot extract JSON from Gemini response for '{word}': {raw_text}")


def _normalize_jsonb_fields(word_data: dict) -> dict:
    """JSONB 欄位缺漏/None → [];誤回字串時嘗試解析成 list(不改動輸入)"""
    normalized = dict(word_data)
    for f in JSONB_FIELDS:
        if f not in normalized or normalized[f] is None:
            normalized[f] = []
        elif isinstance(normalized[f], str):
            try:
                normalized[f] = json.loads(normalized[f])
            except json.JSONDecodeError:
                logger.warning(f"Field '{f}' is a string but not JSON, reset to empty list.")
                normalized[f] = []
    return normalized


def _insert_or_reuse(word_data: dict, word: str, raw_response: str) -> dict:
    """寫入 words;重複(409)時回用既有列。

    任何失敗都只追加到失敗檔(log_failed_word),絕不在請求內同步重跑整份佇列 —
    要清佇列請執行 `python -m app.utils.retry_failed_words`。
    """
    try:
        dao_result = insert_word(word_data)
        if isinstance(dao_result, dict):
            logger.info(f"Supabase insert success for '{word}': {dao_result}")
            return dao_result
        logger.warning(
            f"Supabase insert succeeded but returned invalid result type: {type(dao_result)}. "
            f"Using fallback data."
        )
    except HTTPException as e:
        if e.status_code == 409:
            # word 有 UNIQUE 限制:重複生成同一個字 → 回用既有列(不是錯誤,不進失敗檔)
            try:
                existing = get_word_by_text(word)
            except Exception as lookup_error:
                logger.error(f"Lookup after 409 failed for '{word}': {lookup_error}")
                existing = None

            if existing:
                logger.info(f"Word '{word}' already exists; reusing existing row.")
                return existing
            logger.error(f"Duplicate word '{word}' but lookup returned nothing.")
            log_failed_word({"word": word, "raw_response": raw_response})
        else:
            logger.error(f"Supabase insert error for '{word}': {e}")
            log_failed_word({"word": word, "raw_response": raw_response})
    except Exception as e:
        logger.error(f"Supabase insert error for '{word}': {e}")
        log_failed_word({"word": word, "raw_response": raw_response})

    # 降級:仍回傳 Gemini 生成的內容(id 從缺)
    return {"id": None, **word_data}


def _add_to_review_deck(user_id: uuid.UUID, word_id, word: str) -> None:
    """把字加入呼叫者的複習清單。best-effort:失敗只記 log,不影響生成結果。"""
    try:
        create_user_word(str(user_id), str(word_id), date.today().isoformat())
        logger.info(f"Added '{word}' to review deck for user {user_id}")
    except HTTPException as e:
        if e.status_code == 409:  # 已在清單中,正常
            logger.info(f"'{word}' already in review deck for user {user_id}")
        else:
            logger.error(f"Failed to add '{word}' to review deck for user {user_id}: {e}")
    except Exception as e:
        logger.error(f"Failed to add '{word}' to review deck for user {user_id}: {e}")


def fill_word_details(word: str, user_id: uuid.UUID) -> WordDetailResponse:
    """
    使用 Gemini 生成單字完整資訊 → 存入 words → 加入呼叫者複習清單。
    防呆 JSONB 與必填欄位;失敗寫入失敗檔(append-only,不同步重跑)。
    """
    prompt = f"""
    你是一位專業英語教師。
    請只回傳 JSON，格式如下，**不要任何其他文字或說明**：
    {{
        "word": "{word}",
        "pos": "詞性",
        "definition": "英文定義",
        "kk_pronunciation": "KK 發音",
        "etymology": "語源，可選",
        "synonyms": ["同義字1","同義字2"],
        "antonyms": ["反義字1","反義字2"],
        "inflections": ["變化型1","變化型2"],
        "phrases": ["片語1","片語2"],
        "toeic_examples": ["例句1","例句2"]
    }}
    注意：
    1. 僅回傳 JSON，不要加 ```json``` 或其他符號。
    2. 不要加任何說明文字或句子。
    3. JSON 必須符合格式要求。
    """

    raw_response = ""

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt
        )

        candidate = response.candidates[0].content
        if not (hasattr(candidate, "parts") and candidate.parts):
            raise TypeError(f"Unexpected content type from Gemini: {type(candidate)}")

        raw_response = (candidate.parts[0].text or "").strip()
        if not raw_response:
            raise ValueError(f"Gemini returned empty text for '{word}'")

        word_data = _extract_word_data(raw_response, word)
        if not isinstance(word_data, dict):
            raise ValueError(f"Gemini response is not a JSON object for '{word}': {type(word_data)}")

        logger.info(f"Gemini result for '{word}': {word_data}")
    except Exception as e:
        logger.error(f"Gemini API error for '{word}': {e}")
        # raw_response 即使在 Gemini 失敗時也一併記錄,方便之後重試解析
        log_failed_word({"word": word, "raw_response": raw_response})
        raise

    # 防呆必填欄位
    for f in REQUIRED_FIELDS:
        if not word_data.get(f):
            log_failed_word({"word": word, "raw_response": raw_response})
            raise ValueError(f"Missing required field '{f}' in Gemini response: {word_data}")

    word_data = _normalize_jsonb_fields(word_data)

    # 入庫一律用 schema 驗證過的輸入拼法,不信模型回顯的版本 —
    # 模型回 " Apple " 之類的變體會繞過 word_lower 唯一性,種出重複詞條
    word_data["word"] = word

    # 寫入 words(重複則回用既有列;失敗則降級)
    db_result = _insert_or_reuse(word_data, word, raw_response)

    # 新字或既有字,都確保呼叫者拿到複習列(id 從缺時跳過)
    word_id = db_result.get("id")
    if word_id:
        _add_to_review_deck(user_id, word_id, word)

    # 只回傳 WordDetailResponse 定義的欄位
    allowed = set(WordDetailResponse.model_fields.keys())
    safe_result = {k: v for k, v in db_result.items() if k in allowed}
    for field in JSONB_FIELDS:
        if safe_result.get(field) is None:
            safe_result[field] = []

    logger.info(f"[SAFE] cleaned result = {safe_result}")
    return WordDetailResponse(**safe_result)
