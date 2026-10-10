# app/core/config.py
import os
from pathlib import Path

from dotenv import load_dotenv

# 載入 backend/.env(不覆蓋已存在的環境變數,正式環境可直接用系統環境變數)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _require_env(name: str) -> str:
    """讀取必要環境變數;缺少時立即報錯,避免金鑰再被寫回程式碼"""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"環境變數 {name} 未設定:請複製 backend/.env.example 為 backend/.env 並填入值"
        )
    return value


# 只接受純專案網址。帶路徑(如 /rest/v1)或結尾斜線會讓 JWKS、issuer、PostgREST 全壞,
# 而症狀(全部 401/503)會誤導成「去設 SUPABASE_JWT_SECRET」→ 靜默降級成 HS256,
# 所以開機直接擋,不給它壞掉的機會
SUPABASE_URL = _require_env("SUPABASE_URL").rstrip("/")
if SUPABASE_URL.count("/") != 2:
    raise RuntimeError(
        "SUPABASE_URL 必須是純專案網址(例如 https://abcd.supabase.co):"
        "不可含路徑(如 /rest/v1)或結尾斜線"
    )
SUPABASE_KEY = _require_env("SUPABASE_KEY")
GEMINI_API_KEY = _require_env("GEMINI_API_KEY")

# Gemini 模型名可換:Google 會淘汰舊模型(2026-10 起 gemini-2.5-flash 對新金鑰直接 404),
# 換模型不必改程式,在 .env 設 GEMINI_MODEL=... 即可
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_GEMINI_MODEL

# 選填:只有 legacy HS256 簽章的專案才需要填;新專案預設用非對稱簽章(JWKS)自動驗證
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
