# Vercel Python runtime 的進入點。Vercel 會自動偵測名為 `app` 的 ASGI 物件,
# 不需要 mangum 之類的轉接層。其餘一行都不用在這裡做。
from app.main import app  # noqa: F401
