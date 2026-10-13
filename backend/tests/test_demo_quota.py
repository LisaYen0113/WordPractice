"""示範帳號的付費 AI 小額配額:公開 demo 帳密之後,防止有人繞過 UI 直接打 API 燒 Gemini。

配額屬於**帳號**而不是端點,所以 /words/fill 與 /tests/submit_definition 合計一個額度。
前端展示模式不會呼叫這兩個端點(自評畫面取代 AI 判分),這道閘門擋的是直接呼叫。
"""
import logging
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core import demo_quota
from app.main import app
from app.routes import tests_route, words_route
from tests.auth_helpers import auth_headers
from tests.helpers import FakeClock, word_detail

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _fresh_quota_windows(monkeypatch):
    """每個測試都從乾淨的計數器開始。

    每個測試各自用新的 uuid4 當示範帳號,key 本來就不會撞;但 _limiter._windows 是
    行程共用的,留著舊資料會讓「哪天改成固定 UUID」變成難以察覺的順序相依。
    """
    from app.core import demo_quota

    monkeypatch.setattr(demo_quota._limiter, "_windows", {})


def _stub_paid_ai(monkeypatch):
    """兩個付費端點的後半段都換成假的:這裡只驗閘門,不驗 AI"""
    monkeypatch.setattr(words_route, "fill_word_details", lambda word, user_id: word_detail(word))
    monkeypatch.setattr(
        tests_route,
        "process_definition_test",
        lambda user_id, word_id, user_zh: SimpleNamespace(score=1.0, ai_feedback="很好"),
    )


def _fill(headers):
    return client.post("/words/fill", json={"word": "apple"}, headers=headers)


def _submit(headers):
    return client.post(
        "/tests/submit_definition",
        json={"word_id": str(uuid.uuid4()), "user_input_zh": "蘋果"},
        headers=headers,
    )


def test_demo_account_shares_one_quota_across_both_ai_endpoints(monkeypatch):
    demo_id = uuid.uuid4()
    monkeypatch.setenv("DEMO_USER_ID", str(demo_id))
    _stub_paid_ai(monkeypatch)
    headers = auth_headers(demo_id)

    assert _fill(headers).status_code == 200
    assert _fill(headers).status_code == 200
    # 第 3 次換端點:額度是跨端點共用的,換一個端點不會重新計數
    assert _submit(headers).status_code == 200

    exhausted = _fill(headers)
    assert exhausted.status_code == 429
    assert int(exhausted.headers["retry-after"]) >= 1


def test_other_accounts_are_not_touched_by_the_demo_quota(monkeypatch):
    monkeypatch.setenv("DEMO_USER_ID", str(uuid.uuid4()))  # 配額掛在別人身上
    _stub_paid_ai(monkeypatch)
    headers = auth_headers()

    for _ in range(4):  # 超過 demo 的 3 次,一般使用者不受影響
        assert _fill(headers).status_code == 200
    # 另一個付費端點也一樣:閘門不能漏到一般使用者身上
    assert _submit(headers).status_code == 200


def test_no_demo_quota_when_demo_user_id_is_unset(monkeypatch):
    monkeypatch.delenv("DEMO_USER_ID", raising=False)
    _stub_paid_ai(monkeypatch)
    headers = auth_headers()

    for _ in range(4):
        assert _fill(headers).status_code == 200


def test_quota_is_three_per_hour_not_per_minute(monkeypatch):
    """視窗長度必須是一小時:換成一分鐘就等於 4320 次/天,配額形同虛設。

    直接對模組內那個真實的 limiter 注入假時鐘 —— 用模組自己的設定值受測,
    不是另外造一個 limiter(不然改壞了也測不出來)。
    """
    demo_id = uuid.uuid4()
    monkeypatch.setenv("DEMO_USER_ID", str(demo_id))
    _stub_paid_ai(monkeypatch)
    clock = FakeClock()
    monkeypatch.setattr(demo_quota._limiter, "_clock", clock)
    headers = auth_headers(demo_id)

    for _ in range(3):
        assert _fill(headers).status_code == 200
    assert _fill(headers).status_code == 429

    clock.advance(3599)  # 差一秒滿一小時 → 還不能恢復
    assert _fill(headers).status_code == 429

    clock.advance(1)
    assert _fill(headers).status_code == 200


def test_braced_and_uppercase_demo_user_id_still_matches(monkeypatch):
    """docstring 宣稱容忍大小寫與大括號:比對要用解析後的 UUID,不是字串比對。

    後台複製貼上時很容易帶到不同寫法;字串比對會靜默放行整個示範帳號。
    """
    demo_id = uuid.uuid4()
    monkeypatch.setenv("DEMO_USER_ID", "{" + str(demo_id).upper() + "}")
    _stub_paid_ai(monkeypatch)
    headers = auth_headers(demo_id)

    for _ in range(3):
        assert _fill(headers).status_code == 200
    assert _fill(headers).status_code == 429


def test_malformed_demo_user_id_fails_open(monkeypatch):
    """填壞了不擋人(本機才不會被自己擋死),代價是配額失效 —— 由 import 的 ERROR log 出聲。

    這條把「fail open」釘成契約:哪天想改成 fail closed(正式站直接 500),
    會先紅在這裡,強迫改的人正面面對那個決定。
    """
    monkeypatch.setenv("DEMO_USER_ID", "示範帳號@example.com")  # 典型的填錯:填成 email
    _stub_paid_ai(monkeypatch)
    headers = auth_headers()

    for _ in range(4):
        assert _fill(headers).status_code == 200


def test_startup_unset_is_error_in_production(caplog):
    """正式站漏設要 ERROR 級 —— 那是「公開帳號沒有閘門」唯一看得見的痕跡,
    而 Vercel 的 function log 通常只留 WARNING 以上,INFO/WARNING 會被淹掉。
    """
    with caplog.at_level(logging.WARNING):
        demo_quota._announce_startup_state("", is_production=True)

    assert [record.levelno for record in caplog.records] == [logging.ERROR]


def test_startup_unset_is_only_a_warning_locally(caplog):
    """本機不設是刻意的(否則維護示範字庫會被自己擋):WARNING 就好,不要每次開發都噴 ERROR"""
    with caplog.at_level(logging.WARNING):
        demo_quota._announce_startup_state("", is_production=False)

    assert [record.levelno for record in caplog.records] == [logging.WARNING]


def test_startup_never_logs_the_raw_misconfigured_value(caplog):
    """填錯時最可能是把密碼貼進了 UUID 欄 —— log 只能留指紋,不能把值原樣記下來"""
    pasted_password = "hunter2-not-a-uuid"
    with caplog.at_level(logging.WARNING):
        demo_quota._announce_startup_state(pasted_password, is_production=True)

    assert [record.levelno for record in caplog.records] == [logging.ERROR]
    assert pasted_password not in caplog.text
    assert "hunt" in caplog.text  # 前 4 字留著,足以認出自己貼錯什麼
