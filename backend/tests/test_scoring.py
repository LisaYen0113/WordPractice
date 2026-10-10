"""門檻常數單一來源(app/core/scoring.py)的語義釘住。

ai_service 正規化、srs_service 排程、test_service 記錯、tests_route is_correct
四方共享同一組門檻;任何一處改數字,這裡的行為定義不變。
"""
from datetime import date, timedelta
from pathlib import Path

from app.core.scoring import CORRECT_THRESHOLD, PARTIAL_THRESHOLD
from app.services.srs_service import (
    MAX_FAMILIARITY,
    calculate_next_review_date,
    familiarity_override,
    interval_days,
)


def test_thresholds_are_ordered():
    assert 0.0 < PARTIAL_THRESHOLD < CORRECT_THRESHOLD <= 1.0


def test_at_correct_threshold_advances_familiarity():
    _, familiarity = calculate_next_review_date(CORRECT_THRESHOLD, 0)
    assert familiarity == 1


def test_just_below_correct_threshold_keeps_familiarity():
    _, familiarity = calculate_next_review_date(CORRECT_THRESHOLD - 0.001, 3)
    assert familiarity == 3  # 部分正確:維持熟練度、隔天再練


def test_at_partial_threshold_keeps_familiarity():
    _, familiarity = calculate_next_review_date(PARTIAL_THRESHOLD, 3)
    assert familiarity == 3


def test_below_partial_threshold_resets_familiarity():
    _, familiarity = calculate_next_review_date(PARTIAL_THRESHOLD - 0.001, 3)
    assert familiarity == 0


# ---------- 手動標記熟悉(與 SRS 進階共用同一組間隔常數) ----------


def test_interval_days_is_power_of_two():
    assert interval_days(0) == 1
    assert interval_days(1) == 2
    assert interval_days(3) == 8
    assert interval_days(MAX_FAMILIARITY) == 32


def test_advance_interval_uses_same_source_as_interval_days():
    # 答對的間隔與 interval_days 同源,不能各算各的
    next_date, _ = calculate_next_review_date(CORRECT_THRESHOLD, 3)
    assert next_date == date.today() + timedelta(days=interval_days(3))


def test_mark_familiar_pins_agreed_contract():
    # 前端契約:熟悉 = 熟練度 5、今天+32 天(2^5);取消熟悉 = 0、今天
    assert familiarity_override(True) == (date.today() + timedelta(days=32), 5)
    assert familiarity_override(False) == (date.today(), 0)


def test_mark_familiar_true_uses_max_familiarity():
    next_date, familiarity = familiarity_override(True)
    assert familiarity == MAX_FAMILIARITY
    assert next_date == date.today() + timedelta(days=interval_days(MAX_FAMILIARITY))


def test_max_familiarity_matches_db_check_constraint():
    """MAX_FAMILIARITY 與 schema.sql 的 CHECK 是同一條線:只改程式碼會讓
    mark_familiar 在真實資料庫直接 400 → 用 schema 檔把兩邊釘住"""
    schema_path = Path(__file__).resolve().parents[1] / "supabase" / "schema.sql"
    sql = schema_path.read_text(encoding="utf-8")

    assert f"familiarity_score between 0 and {MAX_FAMILIARITY}" in sql
