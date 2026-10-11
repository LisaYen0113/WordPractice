"""失敗佇列排水:409/無效列/上游 400 都要終止重播;真失敗保留且一筆一行(不合併)"""
import json

from fastapi import HTTPException

from app.utils import retry_failed_words


def _valid_entry(word):
    return {"word": word, "pos": "n.", "definition": "d", "kk_pronunciation": "[k]"}


def _write_queue(tmp_path, entries):
    path = tmp_path / "failed_words.jsonl"
    path.write_text(
        "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in entries),
        encoding="utf-8",
    )
    return path


def _remaining_entries(queue):
    """每行都必須是完整 JSON — 行被合併的話這裡直接 json.loads 爆掉"""
    lines = [ln for ln in queue.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return [json.loads(ln) for ln in lines]


def test_drain_drops_duplicates_and_keeps_real_failures(tmp_path, monkeypatch):
    queue = _write_queue(tmp_path, [_valid_entry("apple"), _valid_entry("banana")])
    monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", queue)

    def fake_insert(word_data):
        if word_data["word"] == "banana":
            raise HTTPException(status_code=409, detail="Database request failed")
        raise ConnectionError("db down")

    monkeypatch.setattr(retry_failed_words, "insert_word", fake_insert)

    retry_failed_words.retry_failed_inserts()

    remaining = _remaining_entries(queue)
    assert [e["word"] for e in remaining] == ["apple"]  # 真失敗留著;409 丟掉不再重播


def test_drain_keeps_multiple_failures_as_separate_lines(tmp_path, monkeypatch):
    # 回歸:先前 strip + writelines 會把多筆重新入列的字黏成同一行,整份佇列一次壞掉
    entries = [_valid_entry(w) for w in ("apple", "berry", "cherry")]
    queue = _write_queue(tmp_path, entries)
    monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", queue)

    def fake_insert(word_data):
        raise ConnectionError("db down")

    monkeypatch.setattr(retry_failed_words, "insert_word", fake_insert)

    retry_failed_words.retry_failed_inserts()

    remaining = _remaining_entries(queue)
    assert [e["word"] for e in remaining] == ["apple", "berry", "cherry"]


def test_drain_rejects_invalid_entries_to_rejected_file(tmp_path, monkeypatch):
    # 毒列:必填欄位不全(Gemini 失敗後留下的 {"word": ..., "raw_response": ""})
    queue = _write_queue(
        tmp_path,
        [
            {"word": "apple", "raw_response": ""},
            {"pos": "n.", "definition": "d", "kk_pronunciation": "[k]"},  # 沒有 word
            _valid_entry("berry"),
        ],
    )
    monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", queue)
    monkeypatch.setattr(retry_failed_words, "insert_word", lambda data: {"id": "row-1"})

    retry_failed_words.retry_failed_inserts()

    assert _remaining_entries(queue) == []  # 無效列全部終止重播
    rejected = (tmp_path / "failed_words.rejected.jsonl").read_text(encoding="utf-8")
    assert "apple" in rejected
    assert "berry" not in rejected  # 有效列正常寫入,不進 rejected


def test_drain_rejects_upstream_400_instead_of_replaying(tmp_path, monkeypatch):
    queue = _write_queue(tmp_path, [_valid_entry("apple")])
    monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", queue)

    def bad_request(data):
        raise HTTPException(status_code=400, detail="Database request failed")

    monkeypatch.setattr(retry_failed_words, "insert_word", bad_request)

    retry_failed_words.retry_failed_inserts()

    assert _remaining_entries(queue) == []
    rejected = (tmp_path / "failed_words.rejected.jsonl").read_text(encoding="utf-8")
    assert "apple" in rejected


def test_drain_rejects_unparseable_line(tmp_path, monkeypatch):
    queue = tmp_path / "failed_words.jsonl"
    queue.write_text("這行既不是 JSON 也沒有任何 { } 區塊\n", encoding="utf-8")
    monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", queue)
    monkeypatch.setattr(retry_failed_words, "insert_word", lambda data: {"id": "x"})

    retry_failed_words.retry_failed_inserts()

    assert _remaining_entries(queue) == []
    rejected = (tmp_path / "failed_words.rejected.jsonl").read_text(encoding="utf-8")
    assert "這行既不是 JSON" in rejected


def test_drain_parses_raw_response_with_json_fence(tmp_path, monkeypatch):
    # 真實佇列的主格式:raw_response 裡是 ```json ...``` 包住的內容
    fenced = "前言\n```json\n" + json.dumps(_valid_entry("proficiency"), ensure_ascii=False) + "\n```"
    queue = _write_queue(tmp_path, [{"word": "proficiency", "raw_response": fenced}])
    monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", queue)
    inserted = []
    monkeypatch.setattr(
        retry_failed_words, "insert_word", lambda data: inserted.append(data) or {"id": "row-1"}
    )

    retry_failed_words.retry_failed_inserts()

    assert inserted[0]["word"] == "proficiency"
    assert inserted[0]["pos"] == "n."
    assert _remaining_entries(queue) == []


def test_unwritable_queue_does_not_break_the_fallback_response(tmp_path, monkeypatch):
    """DATA_DIR 不可寫(設計上允許的降級狀態)時,寫不進失敗佇列不能把請求打掛。

    log_failed_word 是純副作用。它一拋錯,words_service._insert_or_reuse 的降級
    return 就永遠到不了 → /fill 回 500,而且 Gemini 已經生成、已經付費的那份內容
    整個丟掉,只留在 log 裡。這個狀態的代價應該只是「少一筆佇列」。
    """
    from app.services import words_service

    blocker = tmp_path / "blocker"
    blocker.write_text("我是檔案,不是目錄", encoding="utf-8")  # mkdir 會在這裡炸
    monkeypatch.setattr(
        retry_failed_words, "FAILED_LOG_FILE", blocker / "logs" / "failed_words.jsonl"
    )

    def failing_insert(word_data):
        raise RuntimeError("Supabase 掛了")

    monkeypatch.setattr(words_service, "insert_word", failing_insert)

    result = words_service._insert_or_reuse({"word": "probe"}, "probe", "raw response")

    assert result == {"id": None, "word": "probe"}
