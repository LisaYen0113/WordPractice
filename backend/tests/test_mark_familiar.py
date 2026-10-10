"""標記熟悉:手動覆寫 SRS 排程(service + route)。

familiar=true → 熟練度上限 5、排到 2^5=32 天後;false → 歸零、今天到期。
只寫 familiarity_score + next_review_date:人為覆寫不算一次複習,
不動 last_review_date、不記 mistake。
"""
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.routes import words_route
from app.services import familiarity_service
from tests.auth_helpers import auth_headers

client = TestClient(app, raise_server_exceptions=False)

TODAY = date.today()
FAMILIAR_NEXT_DATE = (TODAY + timedelta(days=32)).isoformat()

PROGRESS_ROW = {"id": "row-1", "familiarity_score": 0, "error_count": 0}


class TestSetWordFamiliarityService:
    def _patch(self, monkeypatch, progress_rows, updated_rows):
        captured = {}

        def fake_progress(user_id, word_id):
            captured["progress_args"] = (user_id, word_id)
            return progress_rows

        def fake_update(user_id, row_id, data):
            captured["update_args"] = (user_id, row_id, data)
            return updated_rows

        monkeypatch.setattr(familiarity_service, "get_user_word_progress", fake_progress)
        monkeypatch.setattr(familiarity_service, "update_user_word", fake_update)
        return captured

    def test_mark_familiar_sets_max_score_and_32_day_interval(self, monkeypatch):
        captured = self._patch(
            monkeypatch,
            [PROGRESS_ROW],
            [{"id": "row-1", "familiarity_score": 5, "next_review_date": FAMILIAR_NEXT_DATE}],
        )
        user_id, word_id = uuid.uuid4(), uuid.uuid4()

        result = familiarity_service.set_word_familiarity(user_id, word_id, True)

        assert captured["progress_args"] == (str(user_id), str(word_id))
        assert captured["update_args"] == (
            str(user_id),
            "row-1",
            {"familiarity_score": 5, "next_review_date": FAMILIAR_NEXT_DATE},
        )
        assert result == {
            "word_id": word_id,
            "familiarity_score": 5,
            "next_review_date": FAMILIAR_NEXT_DATE,
            "familiar": True,
        }

    def test_unmark_familiar_resets_to_zero_and_today(self, monkeypatch):
        captured = self._patch(
            monkeypatch,
            [{"id": "row-9", "familiarity_score": 5, "error_count": 0}],
            [{"id": "row-9", "familiarity_score": 0, "next_review_date": TODAY.isoformat()}],
        )

        result = familiarity_service.set_word_familiarity(uuid.uuid4(), uuid.uuid4(), False)

        assert captured["update_args"][1] == "row-9"  # 以進度列 id 更新,不是 word_id
        assert captured["update_args"][2] == {
            "familiarity_score": 0,
            "next_review_date": TODAY.isoformat(),
        }
        assert result["familiarity_score"] == 0
        assert result["familiar"] is False

    def test_only_touches_familiarity_and_next_review_date(self, monkeypatch):
        # 標記熟悉是人為覆寫、不是一次複習 → 不能連帶動 last_review_date/error_count
        captured = self._patch(
            monkeypatch,
            [PROGRESS_ROW],
            [{"id": "row-1", "familiarity_score": 5, "next_review_date": FAMILIAR_NEXT_DATE}],
        )

        familiarity_service.set_word_familiarity(uuid.uuid4(), uuid.uuid4(), True)

        assert set(captured["update_args"][2]) == {"familiarity_score", "next_review_date"}

    def test_response_reflects_db_row_not_local_guess(self, monkeypatch):
        # DB 若正規化/改寫了值,回應必須忠實反映資料庫實際存的狀態
        self._patch(
            monkeypatch,
            [PROGRESS_ROW],
            [{"id": "row-1", "familiarity_score": 4, "next_review_date": "2030-01-01"}],
        )

        result = familiarity_service.set_word_familiarity(uuid.uuid4(), uuid.uuid4(), True)

        assert result["familiarity_score"] == 4
        assert result["next_review_date"] == "2030-01-01"

    def test_unknown_word_raises_404_without_writing(self, monkeypatch):
        updated = []

        monkeypatch.setattr(familiarity_service, "get_user_word_progress", lambda u, w: [])
        monkeypatch.setattr(
            familiarity_service, "update_user_word", lambda *a, **k: updated.append(a)
        )

        with pytest.raises(HTTPException) as excinfo:
            familiarity_service.set_word_familiarity(uuid.uuid4(), uuid.uuid4(), True)

        assert excinfo.value.status_code == 404
        assert updated == []  # 沒有進度列就不能寫

    def test_dao_error_propagates_unchanged(self, monkeypatch):
        # DAO 的 scoped PATCH 沒中列會拋 500;service 不能吞掉它假成功
        def boom(user_id, row_id, data):
            raise HTTPException(status_code=500, detail="Failed to update review progress")

        monkeypatch.setattr(
            familiarity_service, "get_user_word_progress", lambda u, w: [PROGRESS_ROW]
        )
        monkeypatch.setattr(familiarity_service, "update_user_word", boom)

        with pytest.raises(HTTPException) as excinfo:
            familiarity_service.set_word_familiarity(uuid.uuid4(), uuid.uuid4(), True)

        assert excinfo.value.status_code == 500


def _patch_route_service(monkeypatch, result=None, error=None):
    captured = {}

    def fake_service(user_id, word_id, familiar):
        captured.update(user_id=user_id, word_id=word_id, familiar=familiar)
        if error is not None:
            raise error
        return result

    monkeypatch.setattr(words_route, "set_word_familiarity", fake_service)
    return captured


def _ok_result(word_id):
    return {
        "word_id": word_id,
        "familiarity_score": 5,
        "next_review_date": FAMILIAR_NEXT_DATE,
        "familiar": True,
    }


class TestMarkFamiliarRoute:
    def test_passes_canonical_uuid_and_bool_to_service(self, monkeypatch):
        word_id = uuid.uuid4()
        captured = _patch_route_service(monkeypatch, result=_ok_result(word_id))

        user_id = uuid.uuid4()
        response = client.post(
            "/words/mark_familiar",
            json={"word_id": str(word_id), "familiar": True},
            headers=auth_headers(user_id),
        )

        assert response.status_code == 200
        assert captured["user_id"] == user_id  # JWT sub 正規化成 UUID 才進 service
        assert captured["word_id"] == word_id
        assert captured["familiar"] is True

    def test_response_shape(self, monkeypatch):
        word_id = uuid.uuid4()
        _patch_route_service(monkeypatch, result=_ok_result(word_id))

        response = client.post(
            "/words/mark_familiar",
            json={"word_id": str(word_id), "familiar": True},
            headers=auth_headers(),
        )

        assert response.json() == {
            "word_id": str(word_id),
            "familiarity_score": 5,
            "next_review_date": FAMILIAR_NEXT_DATE,
            "familiar": True,
        }

    def test_404_from_service_propagates_with_detail(self, monkeypatch):
        _patch_route_service(
            monkeypatch,
            error=HTTPException(status_code=404, detail="這個字不在你的單字庫中"),
        )

        response = client.post(
            "/words/mark_familiar",
            json={"word_id": str(uuid.uuid4()), "familiar": True},
            headers=auth_headers(),
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "這個字不在你的單字庫中"

    @pytest.mark.parametrize(
        "payload",
        [
            {"word_id": "not-a-uuid", "familiar": True},
            {"word_id": None, "familiar": True},
            {"word_id": str(uuid.uuid4()), "familiar": "maybe"},
            {"word_id": str(uuid.uuid4())},  # 缺 familiar
        ],
    )
    def test_rejects_malformed_body(self, payload):
        response = client.post("/words/mark_familiar", json=payload, headers=auth_headers())
        assert response.status_code == 422

    def test_rate_limited_per_user(self, monkeypatch):
        word_id = uuid.uuid4()
        _patch_route_service(monkeypatch, result=_ok_result(word_id))

        headers = auth_headers()
        payload = {"word_id": str(word_id), "familiar": True}
        for _ in range(words_route.MARK_FAMILIAR_REQUESTS_PER_MINUTE):
            assert (
                client.post("/words/mark_familiar", json=payload, headers=headers).status_code
                == 200
            )

        limited = client.post("/words/mark_familiar", json=payload, headers=headers)
        assert limited.status_code == 429
        assert int(limited.headers["retry-after"]) >= 1

    def test_unexpected_error_is_generic_500(self, monkeypatch):
        _patch_route_service(
            monkeypatch, error=RuntimeError("internal detail at C:\\github\\secret.py")
        )

        response = client.post(
            "/words/mark_familiar",
            json={"word_id": str(uuid.uuid4()), "familiar": True},
            headers=auth_headers(),
        )

        assert response.status_code == 500
        assert "secret.py" not in response.text
        assert "internal detail" not in response.text
