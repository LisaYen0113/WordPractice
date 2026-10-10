"""空 DB 全流程:fill 生成單字後自動加入複習清單;重複字回既有;失敗只記檔不再同步重跑佇列"""
import json
import types
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.services import test_service, words_service


class FakeGenaiClient:
    """假的 google-genai client:固定回一段文字(模擬 candidates/parts 結構)"""

    def __init__(self, text):
        self._text = text
        self.models = self

    def generate_content(self, *args, **kwargs):
        part = types.SimpleNamespace(text=self._text)
        content = types.SimpleNamespace(parts=[part])
        candidate = types.SimpleNamespace(content=content)
        return types.SimpleNamespace(candidates=[candidate])


def _gemini_client_with(text):
    return FakeGenaiClient(text)


def _valid_gemini_json(word="apple"):
    return json.dumps(
        {
            "word": word,
            "pos": "n.",
            "definition": "蘋果",
            "kk_pronunciation": "[ˈæpəl]",
            "etymology": "古英語 æppel",
            "synonyms": ["fruit"],
            "antonyms": [],
            "inflections": ["apples"],
            "phrases": ["an apple a day"],
            "toeic_examples": ["I ate an apple."],
        }
    )


def _word_row(word="apple"):
    return {
        "id": str(uuid.uuid4()),
        "word": word,
        "pos": "n.",
        "definition": "蘋果",
        "kk_pronunciation": "[ˈæpəl]",
        "etymology": None,
        "synonyms": [],
        "antonyms": [],
        "inflections": [],
        "phrases": [],
        "toeic_examples": [],
        "created_at": "2026-10-10T00:00:00+00:00",
    }


class FakeAIResult:
    def __init__(self, score, feedback="還行", mistake_type=None):
        self.score = score
        self.ai_feedback = feedback
        self.ai_mistake_type = mistake_type


# ---------- /words/fill 自動加入複習清單 ----------


def test_fill_creates_deck_row_for_caller(monkeypatch):
    user_id = uuid.uuid4()
    row = _word_row()
    monkeypatch.setattr(words_service, "client", _gemini_client_with(_valid_gemini_json()))
    monkeypatch.setattr(words_service, "insert_word", lambda data: row)
    created = []
    monkeypatch.setattr(
        words_service, "create_user_word", lambda u, w, t: created.append((u, w, t)) or {"id": "deck-1"}
    )

    result = words_service.fill_word_details("apple", user_id)

    assert result.word == "apple"
    assert result.id == row["id"]
    assert created == [(str(user_id), row["id"], date.today().isoformat())]


def test_fill_skips_deck_row_when_insert_result_has_no_id(monkeypatch):
    monkeypatch.setattr(words_service, "client", _gemini_client_with(_valid_gemini_json()))
    monkeypatch.setattr(words_service, "insert_word", lambda data: None)  # 舊介面/異常回傳

    def unexpected(*args, **kwargs):
        raise AssertionError("id 從缺時不應建立複習列")

    monkeypatch.setattr(words_service, "create_user_word", unexpected)

    result = words_service.fill_word_details("apple", uuid.uuid4())

    assert result.word == "apple"
    assert result.id is None


def test_fill_tolerates_deck_conflict(monkeypatch):
    # 複習列已存在(409)→ 正常回傳,不影響生成結果
    row = _word_row()
    monkeypatch.setattr(words_service, "client", _gemini_client_with(_valid_gemini_json()))
    monkeypatch.setattr(words_service, "insert_word", lambda data: row)

    def conflict(u, w, t):
        raise HTTPException(status_code=409, detail="Database request failed")

    monkeypatch.setattr(words_service, "create_user_word", conflict)

    result = words_service.fill_word_details("apple", uuid.uuid4())
    assert result.id == row["id"]


# ---------- words UNIQUE 重複:回既有字,不進失敗佇列 ----------


def test_fill_reuses_existing_word_on_unique_violation(monkeypatch):
    user_id = uuid.uuid4()
    existing = _word_row()
    monkeypatch.setattr(words_service, "client", _gemini_client_with(_valid_gemini_json()))

    def duplicate(data):
        raise HTTPException(status_code=409, detail="Database request failed")

    monkeypatch.setattr(words_service, "insert_word", duplicate)
    monkeypatch.setattr(words_service, "get_word_by_text", lambda word: existing)
    logged = []
    monkeypatch.setattr(words_service, "log_failed_word", lambda d: logged.append(d))
    created = []
    monkeypatch.setattr(
        words_service, "create_user_word", lambda u, w, t: created.append((u, w, t))
    )

    result = words_service.fill_word_details("apple", user_id)

    assert result.id == existing["id"]
    assert logged == []  # 重複不是「失敗」,不進失敗檔
    assert created and created[0][1] == existing["id"]


def test_fill_duplicate_with_empty_lookup_still_logs(monkeypatch):
    monkeypatch.setattr(words_service, "client", _gemini_client_with(_valid_gemini_json()))

    def duplicate(data):
        raise HTTPException(status_code=409, detail="Database request failed")

    monkeypatch.setattr(words_service, "insert_word", duplicate)
    monkeypatch.setattr(words_service, "get_word_by_text", lambda word: None)
    logged = []
    monkeypatch.setattr(words_service, "log_failed_word", lambda d: logged.append(d))

    result = words_service.fill_word_details("apple", uuid.uuid4())

    assert result.id is None
    assert len(logged) == 1 and logged[0]["word"] == "apple"


# ---------- 失敗只記檔,請求內不再重跑佇列(搬家) ----------


def test_fill_insert_failure_logs_instead_of_replaying_queue(monkeypatch):
    monkeypatch.setattr(words_service, "client", _gemini_client_with(_valid_gemini_json()))

    def boom(data):
        raise ConnectionError("db down")

    monkeypatch.setattr(words_service, "insert_word", boom)
    logged = []
    monkeypatch.setattr(words_service, "log_failed_word", lambda d: logged.append(d))
    monkeypatch.setattr(words_service, "create_user_word", lambda *a, **k: None)

    result = words_service.fill_word_details("apple", uuid.uuid4())

    assert result.word == "apple"  # 降級:仍回傳生成結果
    assert len(logged) == 1 and logged[0]["word"] == "apple"
    # 結構保證:service 不再引用同步重跑整份佇列的函式
    assert not hasattr(words_service, "retry_failed_inserts")


def test_fill_unparseable_response_logs_and_raises(monkeypatch):
    monkeypatch.setattr(words_service, "client", _gemini_client_with("這不是 JSON"))
    logged = []
    monkeypatch.setattr(words_service, "log_failed_word", lambda d: logged.append(d))

    with pytest.raises(ValueError):
        words_service.fill_word_details("apple", uuid.uuid4())

    assert len(logged) == 1 and logged[0]["word"] == "apple"


def test_fill_gemini_exception_logs_and_raises(monkeypatch):
    class ExplodingModels:
        def generate_content(self, *args, **kwargs):
            raise RuntimeError("gemini 500")

    class ExplodingClient:
        def __init__(self):
            self.models = ExplodingModels()

    monkeypatch.setattr(words_service, "client", ExplodingClient())
    logged = []
    monkeypatch.setattr(words_service, "log_failed_word", lambda d: logged.append(d))

    with pytest.raises(RuntimeError):
        words_service.fill_word_details("apple", uuid.uuid4())

    assert len(logged) == 1 and logged[0]["word"] == "apple"
    assert "raw_response" in logged[0]


def test_fill_missing_required_field_logs_and_raises(monkeypatch):
    incomplete = json.dumps({"word": "apple", "definition": "蘋果"})  # 缺 pos / kk_pronunciation
    monkeypatch.setattr(words_service, "client", _gemini_client_with(incomplete))
    logged = []
    monkeypatch.setattr(words_service, "log_failed_word", lambda d: logged.append(d))

    with pytest.raises(ValueError):
        words_service.fill_word_details("apple", uuid.uuid4())

    assert len(logged) == 1 and logged[0]["word"] == "apple"


# ---------- test_service:進度列 get-or-create ----------


def _patch_definition_test(monkeypatch, *, score, progress_sequence, create_result=None, create_error=None):
    """progress_sequence: 每次 get_user_word_progress 依序回傳的清單"""
    responses = list(progress_sequence)

    monkeypatch.setattr(
        test_service, "get_word_basic", lambda wid: [{"word": "apple", "definition": "a fruit"}]
    )
    monkeypatch.setattr(
        test_service, "judge_definition", lambda word, definition, user_zh: FakeAIResult(score)
    )

    def fake_progress(u, w):
        return responses.pop(0) if responses else []

    monkeypatch.setattr(test_service, "get_user_word_progress", fake_progress)

    if create_error is not None:
        monkeypatch.setattr(test_service, "create_user_word", create_error)
    else:
        monkeypatch.setattr(
            test_service, "create_user_word", lambda u, w, t: create_result
        )

    updates = []

    def fake_update(user_id, row_id, data):
        updates.append((row_id, data))

    monkeypatch.setattr(test_service, "update_user_word", fake_update)
    mistakes = []
    monkeypatch.setattr(test_service, "record_mistake", lambda data: mistakes.append(data))
    return updates, mistakes


def test_submit_creates_progress_row_when_missing(monkeypatch):
    # 空 DB 首次測驗:沒有進度列 → 建一列再更新,不再 IndexError → 500
    updates, _ = _patch_definition_test(
        monkeypatch,
        score=1.0,
        progress_sequence=[[]],
        create_result={"id": "row-1", "familiarity_score": 0, "error_count": 0},
    )

    result = test_service.process_definition_test(uuid.uuid4(), uuid.uuid4(), "蘋果")

    assert result.score == 1.0
    assert updates[0][0] == "row-1"
    assert updates[0][1]["familiarity_score"] == 1  # 答對 → 熟練度 +1


def test_submit_refetches_progress_after_create_conflict(monkeypatch):
    # 併發競態:create 409(別人先建了)→ 重查拿到那一列,照常更新
    existing = [{"id": "row-9", "familiarity_score": 3, "error_count": 2}]

    def conflict(u, w, t):
        raise HTTPException(status_code=409, detail="Database request failed")

    updates, _ = _patch_definition_test(
        monkeypatch,
        score=1.0,
        progress_sequence=[[], existing],
        create_error=conflict,
    )

    result = test_service.process_definition_test(uuid.uuid4(), uuid.uuid4(), "蘋果")

    assert result.score == 1.0
    assert updates[0][0] == "row-9"
    assert updates[0][1]["familiarity_score"] == 4


def test_submit_500_when_progress_cannot_be_initialized(monkeypatch):
    # 異常狀況:create 409 後重查還是空 → 500,不是 IndexError
    def conflict(u, w, t):
        raise HTTPException(status_code=409, detail="Database request failed")

    _patch_definition_test(
        monkeypatch,
        score=1.0,
        progress_sequence=[[], []],
        create_error=conflict,
    )

    with pytest.raises(HTTPException) as excinfo:
        test_service.process_definition_test(uuid.uuid4(), uuid.uuid4(), "蘋果")

    assert excinfo.value.status_code == 500


def test_submit_wrong_answer_records_mistake(monkeypatch):
    user_id = uuid.uuid4()
    word_id = uuid.uuid4()
    updates, mistakes = _patch_definition_test(
        monkeypatch,
        score=0.2,
        progress_sequence=[[{"id": "row-2", "familiarity_score": 2, "error_count": 0}]],
    )

    result = test_service.process_definition_test(user_id, word_id, "亂答")

    assert result.score == 0.2
    assert updates[0][1]["error_count"] == 1
    assert updates[0][1]["familiarity_score"] == 0  # 答錯 → 歸零重來
    assert len(mistakes) == 1
    assert mistakes[0]["test_type"] == "eng_to_zh"
    assert mistakes[0]["is_correct"] is False
    assert mistakes[0]["user_id"] == str(user_id)
