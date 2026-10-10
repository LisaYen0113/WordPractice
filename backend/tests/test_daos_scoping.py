"""DAO 層的租戶範圍:service key 繞過 RLS,DAO 的 user_id 條件是唯一防線"""
import uuid

import pytest
from fastapi import HTTPException

from app.daos import user_words_dao, words_dao


def _capture(monkeypatch, result):
    captured = {}

    def fake_request(method, table, params=None, data=None, prefer=None):
        captured.update(method=method, table=table, params=params, data=data, prefer=prefer)
        return result

    monkeypatch.setattr(user_words_dao, "supabase_request", fake_request)
    return captured


def test_update_user_word_is_scoped_to_user(monkeypatch):
    row = {"id": "row-1", "familiarity_score": 2}
    captured = _capture(monkeypatch, [row])

    user_id = uuid.uuid4()
    row_id = uuid.uuid4()
    result = user_words_dao.update_user_word(str(user_id), str(row_id), {"familiarity_score": 2})

    assert result == [row]
    assert captured["method"] == "PATCH"
    assert captured["table"] == "user_words"
    assert captured["params"]["id"] == f"eq.{row_id}"
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    # 沒回列就代表 0 列被更新 → 必須要求 representation 才偵測得到
    assert captured["prefer"] == "return=representation"


def test_update_user_word_raises_when_no_row_matched(monkeypatch):
    # scoped PATCH 靜默 0 列(列被刪或 id 不屬該使用者)→ 明確報錯,不能假成功
    _capture(monkeypatch, [])

    with pytest.raises(HTTPException) as excinfo:
        user_words_dao.update_user_word("u-1", "row-x", {"familiarity_score": 1})

    assert excinfo.value.status_code == 500


def test_get_user_words_due_today_scoped_to_user_and_due(monkeypatch):
    captured = _capture(monkeypatch, [])

    user_id = uuid.uuid4()
    user_words_dao.get_user_words_due_today(str(user_id), "2026-10-10")

    assert captured["method"] == "GET"
    assert captured["table"] == "user_words"
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    assert captured["params"]["next_review_date"] == "lte.2026-10-10"
    # /review 也回 WordCard → select 不同步改的話 folder_id 會靜默變 null
    assert captured["params"]["select"] == "word_id,familiarity_score,folder_id"


def test_get_all_user_words_scoped_and_not_due_filtered(monkeypatch):
    captured = _capture(monkeypatch, [])

    user_id = uuid.uuid4()
    user_words_dao.get_all_user_words(str(user_id))

    assert captured["method"] == "GET"
    assert captured["table"] == "user_words"
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    # 列表要看到全部的字(含已排到未來的)→ 絕不能帶到期日過濾
    assert "next_review_date" not in captured["params"]
    # 同一天加入的字(日期相同)要有穩定次序,否則清單每次重整都跳動
    assert captured["params"]["order"] == "next_review_date.asc,id.asc"
    # 上限也要在(拿掉會讓 /deck 無界)
    assert captured["params"]["limit"] == "200"
    # 前端要靠 folder_id 做資料夾篩選 → 一定要抓出來
    assert captured["params"]["select"] == "word_id,familiarity_score,folder_id"


def test_get_user_word_progress_scoped_to_user_and_word(monkeypatch):
    captured = _capture(monkeypatch, [])

    user_id = uuid.uuid4()
    word_id = uuid.uuid4()
    user_words_dao.get_user_word_progress(str(user_id), str(word_id))

    assert captured["params"]["user_id"] == f"eq.{user_id}"
    assert captured["params"]["word_id"] == f"eq.{word_id}"


def test_create_user_word_unwraps_representation(monkeypatch):
    row = {"id": "deck-1", "familiarity_score": 0}
    monkeypatch.setattr(user_words_dao, "supabase_request", lambda *a, **k: [row])

    assert user_words_dao.create_user_word("u-1", "w-1", "2026-10-10") == row


def test_create_user_word_returns_none_for_empty_representation(monkeypatch):
    monkeypatch.setattr(user_words_dao, "supabase_request", lambda *a, **k: [])

    assert user_words_dao.create_user_word("u-1", "w-1", "2026-10-10") is None


def test_get_words_by_ids_batches_to_keep_url_short(monkeypatch):
    """200 個 UUID 一次串進 in.(...) 約 7.9KB,逼近 8KB URL 上限 → 必須分批"""
    calls = []

    def fake_request(method, table, params=None, data=None, prefer=None):
        calls.append(params)
        return []

    monkeypatch.setattr(words_dao, "supabase_request", fake_request)

    ids = [str(uuid.uuid4()) for _ in range(200)]
    words_dao.get_words_by_ids(ids)

    assert len(calls) == 4  # 200 ÷ 每批 50
    collected = []
    for params in calls:
        batch = params["id"][len("in.("):-1].split(",")
        assert len(batch) <= 50
        assert len(params["id"]) < 2000  # 每批都遠離 URL 上限
        # 只抓 WordCard 需要的欄位,別把用不到的欄位乘 200 筆傳輸
        assert params["select"] == (
            "id,word,pos,definition,kk_pronunciation,etymology,synonyms,toeic_examples"
        )
        collected.extend(batch)
    assert collected == ids  # 一個都不能漏、順序不變


def test_update_user_word_folder_is_scoped_to_user_and_word(monkeypatch):
    row = {"word_id": "w-1", "folder_id": "f-1"}
    captured = _capture(monkeypatch, [row])

    user_id = uuid.uuid4()
    word_id = uuid.uuid4()
    folder_id = uuid.uuid4()
    result = user_words_dao.update_user_word_folder(
        str(user_id), str(word_id), str(folder_id)
    )

    assert result == row
    assert captured["method"] == "PATCH"
    assert captured["table"] == "user_words"
    # 條件是 (user_id, word_id) —— word_id 是 words.id,不是 user_words.id
    assert captured["params"]["user_id"] == f"eq.{user_id}"
    assert captured["params"]["word_id"] == f"eq.{word_id}"
    assert captured["data"] == {"folder_id": str(folder_id)}
    assert captured["prefer"] == "return=representation"


def test_update_user_word_folder_accepts_null_to_uncategorize(monkeypatch):
    captured = _capture(monkeypatch, [{"word_id": "w-1", "folder_id": None}])

    user_words_dao.update_user_word_folder("u-1", "w-1", None)

    # null 要原樣送出(移回未分類),不能被轉成字串 "None"
    assert captured["data"] == {"folder_id": None}


def test_update_user_word_folder_raises_404_when_word_not_in_list(monkeypatch):
    # 空結果 = 這個字不在呼叫者的清單裡(或已經被刪)→ 404,不是 500
    _capture(monkeypatch, [])

    with pytest.raises(HTTPException) as excinfo:
        user_words_dao.update_user_word_folder("u-1", "w-x", None)

    assert excinfo.value.status_code == 404
