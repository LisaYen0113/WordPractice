# app/core/scoring.py
"""AI 判分門檻的單一來源。

ai_service(正規化)、srs_service(排程)、test_service(記錯)、tests_route(is_correct)
四方共享同一組語義 — 改門檻只改這裡,不要在任何一處寫死數字。
"""

# score >= 此值:視為答對 → is_correct、熟練度升級、不記錯誤
CORRECT_THRESHOLD = 0.9

# PARTIAL_THRESHOLD <= score < CORRECT_THRESHOLD:部分正確 → 隔天再練,不升級也不歸零
PARTIAL_THRESHOLD = 0.5
