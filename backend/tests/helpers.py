# tests/helpers.py
"""跨測試檔共用的測試替身。

原本 FakeClock 與 word_detail 在 test_rate_limit.py 與 test_demo_quota.py 各有一份
逐字相同的複本;兩組測的都是「記憶體計數器」這個主題,放同一處才不會改一邊忘一邊。
"""
import uuid


class FakeClock:
    """可手動推進的時鐘:注入 FixedWindowLimiter 的 clock 參數,不必真的等"""

    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def word_detail(word):
    """fill_word_details 的回傳形狀 —— 足以讓 /fill 不炸,內容不重要"""
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
    }
