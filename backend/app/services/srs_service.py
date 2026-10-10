# app/services/srs_service.py
from datetime import date, timedelta

from app.core.scoring import CORRECT_THRESHOLD, PARTIAL_THRESHOLD

# 熟練度上限:SRS 進階與「標記熟悉」共用同一個天花板
MAX_FAMILIARITY = 5


def interval_days(familiarity: int) -> int:
    """熟練度 n 對應的複習間隔(天):2^n(0→1、1→2、…、5→32)。"""
    return 2 ** familiarity


def familiarity_override(familiar: bool) -> tuple[date, int]:
    """使用者手動標記/取消熟悉時的排程覆寫。

    熟悉 → 熟練度直接拉到上限、排到最遠間隔(2^MAX = 32 天);
    取消熟悉 → 歸零、今天就要複習。
    """
    if familiar:
        return date.today() + timedelta(days=interval_days(MAX_FAMILIARITY)), MAX_FAMILIARITY
    return date.today(), 0


def calculate_next_review_date(score: float, current_familiarity: int):
    if score >= CORRECT_THRESHOLD:
        days = interval_days(current_familiarity)
        new_familiarity = min(MAX_FAMILIARITY, current_familiarity + 1)
    elif score >= PARTIAL_THRESHOLD:
        days = 1
        new_familiarity = current_familiarity
    else:
        days = 0
        new_familiarity = 0

    next_date = date.today() + timedelta(days=days)
    return next_date, new_familiarity
