import requests
import json
from fastapi import HTTPException
from app.core.config import SUPABASE_URL, SUPABASE_KEY
from app.core.logger import logger

# 逾時上限:避免上游卡死時請求永遠掛著
REQUEST_TIMEOUT_SECONDS = 10


def _build_headers(method: str, prefer: str = None) -> dict:
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json"
    }

    # 舊式 service_role JWT(eyJ... 三段式)要同時放 Authorization;
    # 新式 sb_secret_... 不是 JWT,放 Authorization 會被上游打回,只能放 apikey
    if SUPABASE_KEY.startswith("eyJ") and SUPABASE_KEY.count(".") == 2:
        headers["Authorization"] = f"Bearer {SUPABASE_KEY}"

    # POST 預設要求回傳插入後的資料(不然 Supabase 回空 body,後續解析會炸);
    # PATCH 等要偵測「0 列被更新」時由呼叫端顯式指定 prefer
    if prefer:
        headers["Prefer"] = prefer
    elif method.upper() == "POST":
        headers["Prefer"] = "return=representation"

    return headers


def supabase_request(
    method: str, table: str, params: dict = None, data: dict = None, prefer: str = None
):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = _build_headers(method, prefer)

    try:
        response = requests.request(
            method.upper(),
            url,
            headers=headers,
            params=params or {},
            data=json.dumps(data) if data else None,
            timeout=REQUEST_TIMEOUT_SECONDS
        )
        response.raise_for_status()

        # 關鍵修正 2：檢查響應內容是否為空
        # 即使設定了 Prefer，某些操作（如 DELETE）仍可能回傳空內容
        # 避免對空字串執行 json() 造成 500 錯誤
        if not response.content:
            return None

        return response.json()

    except requests.exceptions.HTTPError as e:
        # 上游錯誤原文(可能含 schema 資訊)只留在 server log,不回給客戶端
        upstream_status = e.response.status_code if e.response is not None else 500
        logger.error(
            f"Supabase {method.upper()} {table} failed (status={upstream_status}): "
            f"{e.response.text if e.response is not None else e}"
        )
        # 只透傳有語意的 4xx;401/403(憑證問題)與 5xx 收斂成 502,避免客戶端誤判成登入過期
        client_status = upstream_status if upstream_status in (400, 404, 409) else 502
        raise HTTPException(status_code=client_status, detail="Database request failed")
    except Exception as e:
        # 其他非預期錯誤(如連線失敗、解析失敗):原文只留 log
        logger.error(f"Supabase {method.upper()} {table} unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Database request failed")
