# app/core/rate_limit.py
"""單程序記憶體固定視窗限流:key = (端點, 已驗證的使用者)。

- 身分取自 get_current_user_id(驗簽後),所以 key 不可偽造
- 時間源可注入(clock=...),測試不需真的等
- 注意:狀態在 process 記憶體內;多 worker 會各自計數,重啟即歸零
"""
import threading
import time
import uuid
from typing import Callable, Dict, Optional, Tuple

from fastapi import Depends, HTTPException

from app.core.auth import get_current_user_id

# 超過這個 key 數量就清一次過期項,避免 dict 隨不同使用者無限增長
_PRUNE_THRESHOLD = 1024


class FixedWindowLimiter:
    def __init__(
        self,
        max_requests: int,
        window_seconds: int,
        clock: Optional[Callable[[], float]] = None,
    ):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._clock = clock or time.monotonic
        self._windows: Dict[str, Tuple[float, int]] = {}  # key -> (視窗起點, 次數)
        # FastAPI 會把同步依賴丟進 threadpool → check 可能是多執行緒同時呼叫;
        # 沒有鎖的話 read-modify-write 會漏算(實測 40 執行緒可超收)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """未超限就計數;超限丟 429 + Retry-After"""
        with self._lock:
            now = self._clock()
            window_start, count = self._windows.get(key, (now, 0))

            if now - window_start >= self.window_seconds:  # 過期 → 開新視窗
                window_start, count = now, 0

            if count >= self.max_requests:
                retry_after = max(1, int(self.window_seconds - (now - window_start) + 0.999))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests, please try again later",
                    headers={"Retry-After": str(retry_after)},
                )

            self._windows[key] = (window_start, count + 1)

            if len(self._windows) > _PRUNE_THRESHOLD:
                self._prune(now)

    def _prune(self, now: float) -> None:
        expired = [k for k, (start, _) in self._windows.items() if now - start >= self.window_seconds]
        for key in expired:
            del self._windows[key]


def rate_limited(endpoint_name: str, max_requests_per_minute: int) -> Callable:
    """建一個 FastAPI 依賴:先驗身分再限流(每使用者每分鐘),回傳 user_id"""
    limiter = FixedWindowLimiter(max_requests=max_requests_per_minute, window_seconds=60)

    def _check(user_id: uuid.UUID = Depends(get_current_user_id)) -> uuid.UUID:
        limiter.check(f"{endpoint_name}:{user_id}")
        return user_id

    return _check
