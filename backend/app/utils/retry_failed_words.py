import json
import os
import re
import sys
from pathlib import Path

# 將 backend 目錄加入 sys.path，方便直接以檔案路徑執行
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import DATA_DIR
from app.core.logger import logger
from app.daos.words_dao import insert_word
from app.schemas.words import NewWordRequest

BOM_CHAR = chr(0xFEFF)  # UTF-8 BOM 解碼後的字元

# 位置由 DATA_DIR 決定(本機 = backend/logs;正式環境 = Fly volume)
FAILED_LOG_FILE = DATA_DIR / "logs" / "failed_words.jsonl"

# 資料庫支持的欄位
DB_FIELDS = [
    "word", "pos", "definition", "kk_pronunciation",
    "etymology", "synonyms", "antonyms", "inflections",
    "phrases", "toeic_examples"
]

JSONB_FIELDS = ["synonyms", "antonyms", "inflections", "phrases", "toeic_examples"]

# words 表的必填欄位(與 words_service.REQUIRED_FIELDS 一致)
REQUIRED_FIELDS = ("word", "pos", "definition", "kk_pronunciation")


def log_failed_word(word_data: dict) -> None:
    """將單筆失敗單字寫入 FAILED_LOG_FILE。

    純副作用,永不拋錯:呼叫端在 DATA_DIR 不可寫的降級狀態下仍必須走完它的降級
    return。這裡一拋錯,/fill 就回 500,而且 Gemini 已經生成、已經付費的內容會
    整個丟掉 —— 比「少一筆佇列」嚴重得多,而那正是 D7 要避免的沉默的錯。
    """
    try:
        FAILED_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(FAILED_LOG_FILE, "a", encoding="utf-8", errors="backslashreplace") as f:
            f.write(json.dumps(word_data, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.error(
            f"失敗佇列寫不進去({e}),這筆沒有留底:{word_data.get('word', 'unknown')}"
        )
        return
    logger.warning(f"Logged failed word: {word_data.get('word', 'unknown')}")


def clean_word_data(raw_data: dict) -> dict:
    """保留資料庫支持欄位，JSONB 欄位缺失補空列表"""
    cleaned = {k: raw_data.get(k) for k in DB_FIELDS if k in raw_data}
    for f in JSONB_FIELDS:
        if f not in cleaned or cleaned[f] is None:
            cleaned[f] = []
        elif isinstance(cleaned[f], str):
            try:
                cleaned[f] = json.loads(cleaned[f])
            except json.JSONDecodeError:
                cleaned[f] = []
    return cleaned


def _rejected_log_file() -> Path:
    return FAILED_LOG_FILE.with_name("failed_words.rejected.jsonl")


def _reject_line(raw_line: str, reason: str) -> None:
    """無效列移到 rejected 檔:佇列不再無限重播,原始資料也不憑空消失(要人工處理時還在)"""
    rejected_file = _rejected_log_file()
    rejected_file.parent.mkdir(parents=True, exist_ok=True)
    with open(rejected_file, "a", encoding="utf-8", errors="backslashreplace") as f:
        f.write(raw_line.rstrip("\n") + "\n")
    logger.warning(f"Retry: 丟棄無效列({reason}) → {rejected_file.name}: {raw_line[:100]!r}")


def _validate_entry(cleaned: dict):
    """排水前重驗(檔案內容不可信)。回 (True, None) 或 (False, 原因)"""
    try:
        NewWordRequest(word=cleaned.get("word"))
    except (ValidationError, TypeError):
        return False, "word 不符合 /fill 的格式規則"

    for field in REQUIRED_FIELDS:
        value = cleaned.get(field)
        if not isinstance(value, str) or not value.strip():
            return False, f"缺少必填欄位 '{field}'"
    return True, None


def retry_failed_inserts():
    """重試失敗檔裡的單字;成功/重複(409)丟掉,無效列與上游 400 移進 rejected 檔。

    解析與驗證是決定性的:失敗一次就永遠失敗 → 直接終止重播,
    否則毒列每個排水週期都重播、佇列永遠清不掉。
    只有可能暫時性的失敗(連線錯誤、上游 5xx/502)才保留重播。
    """
    try:
        with open(FAILED_LOG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        logger.info("No failed log file found.")
        return

    success_count = 0
    fail_count = 0
    rejected_count = 0
    remaining_lines = []

    for raw_line in lines:
        line = raw_line.rstrip("\n")
        stripped = line.strip()
        if not stripped:
            continue  # 跳過空行

        # ---- 解析 + 驗證(決定性,失敗即終止重播) ----
        try:
            try:
                parsed_line = json.loads(stripped)
            except json.JSONDecodeError:
                parsed_line = {}

            # 優先用 raw_response
            raw_text = parsed_line.get("raw_response") or stripped
            raw_text = raw_text.strip().lstrip(BOM_CHAR)

            # 嘗試抓 ```json ...``` 區塊
            word_data = None
            match = re.search(r"```json\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
            if match:
                word_data = json.loads(match.group(1))
            else:
                # 嘗試抓 { ... } 區塊
                match = re.search(r"(\{(?:.|\s)*\})", raw_text)
                if match:
                    word_data = json.loads(match.group(1))

            if not word_data:
                raise ValueError("Cannot extract JSON from line")
            if not isinstance(word_data, dict):
                raise ValueError(f"Extracted JSON is not an object: {type(word_data)}")

            # 移除 raw_response,防呆保留資料庫欄位
            word_data.pop("raw_response", None)
            cleaned = clean_word_data(word_data)
        except Exception as e:
            rejected_count += 1
            _reject_line(raw_line, f"無法解析:{type(e).__name__}")
            continue

        is_valid, reason = _validate_entry(cleaned)
        if not is_valid:
            rejected_count += 1
            _reject_line(raw_line, reason)
            continue

        # ---- 寫入(可能暫時性失敗 → 保留重播) ----
        try:
            result = insert_word(cleaned)
            logger.info(f"Retry insert success for '{cleaned.get('word')}': {result}")
            success_count += 1

        except HTTPException as e:
            if e.status_code == 409:
                # 資料已在 words 表(UNIQUE 重複)→ 視為成功,直接丟掉這行,
                # 否則這條「毒列」每次排水都重播、永遠清不掉
                logger.info(f"Retry: word already present in DB (409); dropping line: {stripped[:80]}")
                success_count += 1
            elif e.status_code == 400:
                # 上游 schema 拒絕:同一份 payload 重播也不會過 → 終止重播
                rejected_count += 1
                _reject_line(raw_line, "上游 400")
            else:
                fail_count += 1
                remaining_lines.append(line + "\n")
                logger.error(
                    f"Retry insert failed for '{cleaned.get('word')}': {e!r}"
                )
        except Exception as e:
            fail_count += 1
            remaining_lines.append(line + "\n")
            logger.error(f"Retry insert failed for '{cleaned.get('word')}': {e!r}")

    # 將仍然失敗的資料原子性寫回 JSONL。每筆各自一行:先前用 strip 過的內容直接
    # writelines,會把多筆失敗黏成同一行,整份佇列一次壞掉
    FAILED_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = Path(str(FAILED_LOG_FILE) + ".tmp")
    with open(tmp_file, "w", encoding="utf-8") as f:
        f.writelines(remaining_lines)
    tmp_file.replace(FAILED_LOG_FILE)

    logger.info(
        f"Retry completed: {success_count} success, {fail_count} fail, {rejected_count} rejected."
    )


if __name__ == "__main__":
    logger.info("開始重試失敗單字...")
    retry_failed_inserts()
    logger.info("完成")
