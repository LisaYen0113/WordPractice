# app/main.py
import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import GEMINI_MODEL
from app.core.logger import logger
from app.routes.words_route import router as words_router
from app.routes.tests_route import router as tests_router
from app.routes.folders_route import router as folders_router

# 這次的事故模式是「模型被 Google 悄悄停用,請求時才 404」→
# 啟動時就把生效的模型名記進 log,出問題一眼可查 env 有沒有吃到
logger.info(f"Gemini model in use: {GEMINI_MODEL}")

# CORS 設定
ALLOWED_ORIGINS = [
    "http://localhost:3000",  # 靜態預覽(production build)
    "http://localhost:3001",  # CRA dev server
    # 之後部署可加入正式網址
]

# 請求 body 大小上限:兩個端點的正常 body 都不到 1KB,超過直接擋掉
MAX_BODY_BYTES = 64 * 1024

app = FastAPI(
    title="Word Learning API",
    debug=False,
    redirect_slashes=False,  # 結尾斜線的 307 會反射 Host 標頭(開放轉址),直接關掉
)


def _apply_error_headers(request: Request, response: JSONResponse) -> JSONResponse:
    """未預期例外的回應不經過任何使用者 middleware(ServerErrorMiddleware 在最外層),
    這裡手動補上標頭,否則瀏覽器只會看到 network error、CDN 也可能快取。"""
    origin = request.headers.get("origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Cache-Control"] = "no-store"
    return response


# 未預期例外:詳細內容只寫進 server log,回應一律用通用訊息(避免洩漏原始碼/內部資訊)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(
        f"Unhandled error on {request.method} {request.url.path}: {exc}",
        exc_info=exc,
    )
    response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    return _apply_error_headers(request, response)


# 驗證失敗:不原封回顯輸入(input/ctx 可能含超長內容或殘缺代理對),只留欄位與原因
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"loc": err.get("loc"), "msg": err.get("msg"), "type": err.get("type")}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


# body 大小上限(定義在 CORS 之前,讓 413 也帶得到 CORS 標頭)
@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        # 只檢查 content-length 會被 Transfer-Encoding: chunked 完全繞過
        # (沒有長度上限的 body 會被整份讀進記憶體才輪到認證)→ 兩個寫入端點
        # 一律帶 content-length,沒帶或 chunked 直接擋
        raw_length = request.headers.get("content-length")
        if request.headers.get("transfer-encoding") or not (raw_length and raw_length.isdigit()):
            return JSONResponse(status_code=411, content={"detail": "Content-Length required"})
        if int(raw_length) > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],  # 429 的重試秒數要讓瀏覽器 JS 讀得到
)

# 必須在 CORS 之後 add:Starlette 最後 add 的是最外層,這樣才會連
# limit_body_size 產生的 411/413 都蓋到。Vercel 的 rewrite 預設採信上游
# cache 標頭,這行擋掉跨使用者快取
@app.middleware("http")
async def no_store(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(words_router, prefix="/words")
app.include_router(tests_router, prefix="/tests")
app.include_router(folders_router, prefix="/folders")


@app.get("/health")
async def health():
    """Fly 的健康檢查:不驗身分、不碰資料庫,只證明行程活著"""
    return {"status": "ok"}


# 伺服器啟動
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
