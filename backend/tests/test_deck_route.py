"""GET /words/deck:列出呼叫者「全部」的單字(不過濾到期日)。

/review 只回今天到期的字(答對/標記熟悉後就從畫面消失);列表用 /deck,
回全部的字、與 /review 同形狀(WordCard)。
"""
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.routes import words_route
from tests.auth_helpers import auth_headers

client = TestClient(app, raise_server_exceptions=False)


def _word_row(word_id, word="apple", **overrides):
    return {
        "id": str(word_id),
        "word": word,
        "pos": "n.",
        "definition": "蘋果",
        "kk_pronunciation": "[ˈæpəl]",
        "etymology": None,
        "synonyms": None,
        "toeic_examples": None,
        **overrides,
    }


def _patch_deck(monkeypatch, user_words, word_rows=None, capture=None):
    """取代 /deck 的兩個 DAO;不取代的 DAO 一旦被呼叫就代表走錯路徑"""
    capture = capture if capture is not None else {}

    def fake_all_words(user_id):
        capture["user_id"] = user_id
        return user_words

    def fake_words_by_ids(ids):
        capture["ids"] = ids
        return word_rows if word_rows is not None else []

    def explode_due_today(*args, **kwargs):
        raise AssertionError("/deck 不能用只回今日到期的 DAO")

    monkeypatch.setattr(words_route, "get_all_user_words", fake_all_words)
    monkeypatch.setattr(words_route, "get_words_by_ids", fake_words_by_ids)
    monkeypatch.setattr(words_route, "get_user_words_due_today", explode_due_today)
    return capture


def test_deck_passes_canonical_uuid_to_dao(monkeypatch):
    capture = _patch_deck(monkeypatch, [])

    user_id = uuid.uuid4()
    response = client.get("/words/deck", headers=auth_headers(user_id))

    assert response.status_code == 200
    assert response.json() == []
    assert capture["user_id"] == user_id  # JWT sub 正規化成 UUID 才進 DAO


def test_deck_returns_cards_for_all_words_including_not_due(monkeypatch):
    # 一顆已標記熟悉(排到未來、不在今日複習)的字也必須在清單裡
    not_due_word = uuid.uuid4()
    due_word = uuid.uuid4()
    user_words = [
        {"word_id": str(not_due_word), "familiarity_score": 5},
        {"word_id": str(due_word), "familiarity_score": 0},
    ]
    rows = [
        _word_row(not_due_word, "benevolent"),
        _word_row(due_word, "attire", pos="v."),
    ]
    _patch_deck(monkeypatch, user_words, rows)

    response = client.get("/words/deck", headers=auth_headers())

    assert response.status_code == 200
    cards = response.json()
    assert {c["word"] for c in cards} == {"benevolent", "attire"}
    # 熟悉度來自 user_words 的 join,不是預設值
    assert {c["word"]: c["familiarity_score"] for c in cards} == {
        "benevolent": 5,
        "attire": 0,
    }


def test_deck_empty_list_skips_second_query(monkeypatch):
    capture = _patch_deck(monkeypatch, [])

    response = client.get("/words/deck", headers=auth_headers())

    assert response.status_code == 200
    assert "ids" not in capture  # 沒字就不該再打 words 表


def test_deck_card_shape_matches_review(monkeypatch):
    word_id = uuid.uuid4()
    capture = _patch_deck(
        monkeypatch,
        [{"word_id": str(word_id), "familiarity_score": 2}],
        [
            _word_row(
                word_id,
                "resilient",
                etymology="源自拉丁語 resilire",
                synonyms=["tough"],
                toeic_examples=["Be resilient."],
            )
        ],
    )

    response = client.get("/words/deck", headers=auth_headers())

    assert response.json() == [
        {
            "word_id": str(word_id),
            "word": "resilient",
            "pos": "n.",
            "definition": "蘋果",
            "kk_pronunciation": "[ˈæpəl]",
            "etymology": "源自拉丁語 resilire",
            "synonyms": ["tough"],
            "toeic_examples": ["Be resilient."],
            "familiarity_score": 2,
        }
    ]
    assert capture["ids"] == [str(word_id)]


def test_deck_endpoint_is_rate_limited(monkeypatch):
    # /deck 每次兩個 PostgREST 查詢 → 與 /review 同級(寬鬆的)每使用者上限
    _patch_deck(monkeypatch, [])

    headers = auth_headers()  # 同一位使用者
    for _ in range(words_route.DECK_REQUESTS_PER_MINUTE):
        assert client.get("/words/deck", headers=headers).status_code == 200

    limited = client.get("/words/deck", headers=headers)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1


def test_review_still_returns_cards_for_due_words(monkeypatch):
    """/review 改用共用 _build_cards 後,帶資料的路徑必須原封不動(重構釘子)"""
    word_id = uuid.uuid4()
    monkeypatch.setattr(
        words_route,
        "get_user_words_due_today",
        lambda user_id, today: [{"word_id": str(word_id), "familiarity_score": 3}],
    )
    monkeypatch.setattr(
        words_route, "get_words_by_ids", lambda ids: [_word_row(word_id, "attire")]
    )

    response = client.get("/words/review", headers=auth_headers())

    assert response.status_code == 200
    assert response.json() == [
        {
            "word_id": str(word_id),
            "word": "attire",
            "pos": "n.",
            "definition": "蘋果",
            "kk_pronunciation": "[ˈæpəl]",
            "etymology": None,
            "synonyms": None,
            "toeic_examples": None,
            "familiarity_score": 3,
        }
    ]


def test_deck_and_review_rate_limits_use_separate_buckets(monkeypatch):
    """限流 key 是「端點名:使用者」→ /deck 打滿不該殃及 /review"""
    monkeypatch.setattr(words_route, "get_all_user_words", lambda user_id: [])
    monkeypatch.setattr(words_route, "get_user_words_due_today", lambda user_id, today: [])

    headers = auth_headers()  # 同一位使用者
    for _ in range(words_route.DECK_REQUESTS_PER_MINUTE):
        assert client.get("/words/deck", headers=headers).status_code == 200

    assert client.get("/words/review", headers=headers).status_code == 200
