# app/core/demo_quota.py
"""示範帳號的付費 AI 小額配額。

公開 demo 帳密之後,任何人都能登入,並直接呼叫付費 AI 端點(/words/fill 與
/tests/submit_definition 都會打 Gemini)。前端展示模式不會呼叫這兩個端點
(自評畫面取代 AI 判分),但 UI 擋不住繞過去的直接呼叫 —— 所以額度改在後端按帳號計。

配額屬於**帳號**,兩個端點共用同一個計數:在意的是「這個帳號能燒多少 Gemini」,
不是「單一端點被打了幾次」。非示範帳號不受影響,只走原本的每分鐘限流。

**這是墊高門檻,不是封死**(繼承 rate_limit.py 的同一個限制):計數器在記憶體,
每個 serverless 實例各算各的、冷啟動歸零,並行打多個實例可以拿到近 N 倍。
要真正的硬上限,得把計數器搬進 Supabase(spec §11)。

**而且它只擋「用示範帳號」這條路。** Supabase 專案若開放自助註冊,任何人拿前端
bundle 裡的 anon key 就能自己開一個帳號,那個帳號不是示範帳號,直接繞過這個配額。
本 app 沒有註冊畫面(前端只呼叫 signInWithPassword),所以關掉 Supabase 的
「Allow new users to sign up」不損失任何功能 —— 那才是花費的界線,這個配額是第二層。

兩個細節讓「3 次」實際上比字面寬鬆,都是刻意的:
- 固定視窗不是滑動視窗:跨視窗邊界最多可拿到 5 次(與 rate_limit.py 同)。
- 額度算**請求數**,不是 AI 呼叫數 —— body 不合法的請求(422)照樣扣,
  因為依賴比 body 驗證先跑。方向是超扣,對花費而言是安全的那一邊。

沒設 DEMO_USER_ID 時整道閘門不生效 —— 本機開發就是這樣(維護示範字庫才不會被自己擋),
所以正式環境漏設等於靜默失效,只留一行 WARNING。import 時那行 log 就是為了讓漏設看得見。
**值填錯同樣是靜默的**:格式不對會印 ERROR;**格式對但填成別人的 id 則完全看不出來**
(示範帳號不受保護,而那個帳號被限成 3 次/小時)。後台複製時確認是示範帳號那一列。
"""
import os
import uuid

from fastapi import Depends

from app.core.auth import get_current_user_id
from app.core.logger import logger
from app.core.rate_limit import FixedWindowLimiter

DEMO_AI_REQUESTS_PER_HOUR = 3
DEMO_AI_WINDOW_SECONDS = 3600

_limiter = FixedWindowLimiter(
    max_requests=DEMO_AI_REQUESTS_PER_HOUR, window_seconds=DEMO_AI_WINDOW_SECONDS
)

# import 時讀一次只為了印狀態;實際判斷每次請求重讀(與 auth.py 同一慣例:
# 不在 import 時把策略凍結,測試與臨時改環境變數都能立即生效)
def _fingerprint(value: str) -> str:
    """只留前 4 字與長度 —— 填錯時最可能是誤貼了密碼,不能原樣進 Vercel log"""
    return f"{value[:4]}…(len={len(value)})"


def _announce_startup_state(demo_user_id: str, is_production: bool) -> None:
    """import 時出聲。這是漏設／填錯唯一看得見的痕跡,所以抽成函式讓它受測。

    等級刻意分兩級:未設在本機是正常(WARNING),在正式站是「公開帳號沒閘門」(ERROR);
    格式不對一律 ERROR。
    """
    if not demo_user_id:
        message = "Demo quota: DEMO_USER_ID 未設 — 示範帳號的付費 AI 不受小額配額限制"
        if is_production:
            logger.error(f"{message}(這是正式環境 —— 公開的 demo 帳號沒有這道閘門)")
        else:
            logger.warning(f"{message}(本機開發如此是正常的)")
        return

    try:
        uuid.UUID(demo_user_id)
    except ValueError:
        logger.error(
            f"Demo quota: DEMO_USER_ID 不是合法 UUID({_fingerprint(demo_user_id)})"
            " — 配額不會生效,公開的示範帳號將不受此限"
        )
        return

    logger.info(
        f"Demo quota: 示範帳號 {demo_user_id} 的付費 AI 上限 "
        f"{DEMO_AI_REQUESTS_PER_HOUR} 次 / {DEMO_AI_WINDOW_SECONDS // 60} 分鐘"
    )


_configured_demo_id = os.getenv("DEMO_USER_ID", "").strip()
# 正式站的漏設要更大聲:Vercel 的 function log 通常只留 WARNING 以上
_is_production = os.getenv("VERCEL_ENV", "").strip() == "production"
_announce_startup_state(_configured_demo_id, _is_production)


def limit_demo_ai(user_id: uuid.UUID = Depends(get_current_user_id)) -> None:
    """付費 AI 端點掛這個依賴:示範帳號共用小額配額,其他帳號直接放行。

    比對用解析後的 UUID(容忍大小寫與大括號寫法);解析失敗就當作不是示範帳號 ——
    設定值寫壞的後果由 import 時那行 ERROR log 負責讓人看見。
    """
    demo_user_id = os.getenv("DEMO_USER_ID", "").strip()
    if not demo_user_id:
        return

    try:
        is_demo_account = uuid.UUID(demo_user_id) == user_id
    except ValueError:
        is_demo_account = False

    if is_demo_account:
        _limiter.check(f"demo-ai:{user_id}")
