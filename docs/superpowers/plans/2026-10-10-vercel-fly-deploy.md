# Vercel + Fly.io 部署實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端部署到 Vercel、後端部署到 Fly.io，讓瀏覽器只看得到一個網域，且本機開發流程完全不變。

**Architecture:** Vercel 以單一專案（root directory = `frontend/my-app`）託管 CRA 靜態產物，並用 top-level rewrite 把 `/api/:path*` 代理到 Fly.io 上的 FastAPI（`:path*` 吃掉 `/api` 前綴，所以後端路由不動）。Fly 端是 1 台常駐機器 + 1 個 volume：volume 掛在 `/data`，log 與失敗單字佇列寫進去，重新部署才留得住。後端唯一的功能性改動是新增 `DATA_DIR` 環境變數。

**Tech Stack:** FastAPI / uvicorn（Python 3.12）、pytest、Docker（`python:3.12-slim`）、Fly.io（flyctl）、Vercel、Create React App 5。

**Spec:** `docs/superpowers/specs/2026-10-10-vercel-fly-deploy-design.md`

## 執行狀態（2026-10-10）

**Task 1–6 已完成並 commit**：`44c2443`（DATA_DIR）、`c3345ba`（/health）、`b207446`（no-store）、`8d4ffd7`（Dockerfile）、`305d16c`（fly.toml）、`1dbe7f1`（vercel.json）、`ad344e9`（護欄補強）。**Task 7 尚未執行** —— 需要你自己的 Fly / Vercel 帳號。

全套件 **261 passed**。實測 commit 基線是 178；下面各步驟寫的 218／222／227／239 是撰寫當下的工作目錄快照，之後因為同時進行的 folders 工作而不斷變動（那份工作從 40 個測試長到 61 個）。重新基準化的過程記在 `.superpowers/sdd/2026-10-10-vercel-fly-deploy/progress.md`，該檔也記著執行期間的所有判斷與取捨。

**Task 7 動工前必讀**：`folders` 功能要先 commit，再 `fly deploy`。`main.py` 對 `app.routes.folders_route` 的 import 已經在 commit 裡，但那個模組還沒 commit，所以乾淨檢出的樹會 import 失敗；而 `fly deploy` 是從工作目錄建 image，未 commit 的檔案會一起上線。詳見 Task 7 Step 3。

## Global Constraints

- Python 版本：**3.12**（Dockerfile 用 `python:3.12-slim`，本機 venv 為 3.12.4）。
- 容器連接埠固定 **8080**，uvicorn 必須 `--workers 1`（限流計數器在 process 記憶體，多 worker 會各自計數）。
- Fly region = **`nrt`**；volume 掛載點與 `DATA_DIR` 都必須是 **`/data`**。
- `DATA_DIR` 未設定時必須等於 `backend/` 目錄 —— 本機行為與改動前**逐字節相同**。
- 後端路由維持 `/words`、`/tests`、`/folders`，**不加 `/api` 前綴**（前綴由 Vercel 的 rewrite 吃掉）。
- 所有註解與使用者可見訊息一律**繁體中文**，標點用全形。
- **機密不得落地**：`backend/.env` 與 `frontend/my-app/.env.local` 的內容不可寫進任何新檔案、不可貼進對話。部署時由使用者自己在終端機輸入。
- 不新增 `.md` 文件（規格書已是維運指令的來源）。
- 測試一律用 `backend/venv/Scripts/python.exe -m pytest` 執行。

## Review Focus

以下五類是規格暗示、但沒有任務的自然測試會覆盖到的失敗模式。每一條都已在對應任務中釘上測試（最後一條依規格 §11 明示排除，改以人工驗證覆蓋）：

1. **`DATA_DIR` 指向不存在的上層目錄**（volume 沒掛上）—— 期望**開機就失敗**，不可靜默退回容器暫存區；退回等於 log 與待重試單字在下次部署時無聲消失。→ Task 1
2. **未預期例外（500）的回應**走 `ServerErrorMiddleware`，在所有使用者 middleware 之外，不會經過新的 middleware；`Cache-Control: no-store` 必須在錯誤處理器內手動補。→ Task 3
3. **411 / 413 的回應**由 `limit_body_size` 產生，新 middleware 必須是**最外層**才蓋得到。→ Task 3
4. **`.dockerignore` 被刪改** → service_role key 被打進 image。→ Task 4
5. **`REACT_APP_API_URL` 沒在 Vercel 設** → production build 靜默指回 `http://localhost:8000`，整個網站壞掉但 build 成功。規格 §11 明示排除自動偵測，改在 Task 7 用瀏覽器網路面板人工確認。→ Task 7

---

### Task 1: `DATA_DIR` —— 讓可寫路徑可設定

**Files:**
- Modify: `backend/app/core/config.py`（在 `load_dotenv` 之後、`_require_env` 之前插入）
- Modify: `backend/app/core/logger.py:4-10`
- Modify: `backend/app/utils/retry_failed_words.py:18-20`
- Test: `backend/tests/test_data_dir.py`（新增）

**Interfaces:**
- Consumes: 無（第一個任務）
- Produces: `app.core.config.DATA_DIR` —— `pathlib.Path`，未設 `DATA_DIR` 環境變數時等於 `backend/` 絕對路徑。`app.core.logger.LOG_DIR` 與 `app.utils.retry_failed_words.FAILED_LOG_FILE` 都由它推導。

- [x] **Step 1: 寫失敗的測試**

建立 `backend/tests/test_data_dir.py`：

```python
"""DATA_DIR:log 與失敗佇列的位置可設定;本機不設時行為與改動前相同"""
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

# 這些都是 import-time 常數,只有在乾淨的子行程裡重新 import 才驗得到
_PROBE = """
import json

from app.core.config import DATA_DIR
from app.core.logger import LOG_DIR
from app.utils.retry_failed_words import FAILED_LOG_FILE

print(json.dumps({
    "data": str(DATA_DIR),
    "log": str(LOG_DIR),
    "queue": str(FAILED_LOG_FILE),
}))
"""


def _probe(data_dir=None):
    """在子行程 import 一次。回傳 CompletedProcess,失敗案例要看 stderr。"""
    env = os.environ.copy()
    env.pop("DATA_DIR", None)  # 繼承來的值不能影響斷言
    if data_dir is not None:
        env["DATA_DIR"] = str(data_dir)
    return subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def _probe_ok(data_dir=None) -> dict:
    result = _probe(data_dir)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_defaults_to_backend_dir_when_data_dir_unset():
    probe = _probe_ok()

    assert Path(probe["data"]) == BACKEND_DIR
    assert Path(probe["log"]) == BACKEND_DIR / "logs"
    assert Path(probe["queue"]) == BACKEND_DIR / "logs" / "failed_words.jsonl"


def test_data_dir_env_moves_log_and_queue(tmp_path):
    probe = _probe_ok(tmp_path)

    assert Path(probe["data"]) == tmp_path
    assert Path(probe["log"]) == tmp_path / "logs"
    assert Path(probe["queue"]) == tmp_path / "logs" / "failed_words.jsonl"


def test_data_dir_creates_log_dir_on_import(tmp_path):
    _probe_ok(tmp_path)

    assert (tmp_path / "logs").is_dir()


def test_missing_data_dir_parent_fails_loudly(tmp_path):
    """volume 沒掛上時要大聲失敗:靜默退回容器暫存區 = 下次部署無聲遺失 log 與待重試單字"""
    result = _probe(tmp_path / "not-mounted")

    assert result.returncode != 0
    assert "FileNotFoundError" in result.stderr
```

- [x] **Step 2: 執行測試，確認失敗**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_data_dir.py -q
```

預期：**4 failed**，全部都是子行程 `ImportError: cannot import name 'DATA_DIR'`。其中 `test_defaults_to_backend_dir_when_data_dir_unset` 是刻意的回歸鎖 —— 它現在因為 import 失敗而紅燈，改動完成後必須轉綠並持續證明「本機行為沒變」。

- [x] **Step 3: 在 `config.py` 加入 `DATA_DIR`**

`backend/app/core/config.py`，插在第 8 行的 `load_dotenv(...)` 之後、`_require_env` 定義之前：

```python
# 可寫資料目錄(log 與失敗佇列)。不設 DATA_DIR 時指回 backend/,本機行為不變;
# 正式環境設成 Fly volume(例如 /data),重新部署才留得住 log 與待重試的單字。
# 刻意不加 parents=True:上層目錄不存在代表 volume 沒掛上,要當場失敗,
# 不能靜默退回容器暫存區(那樣下次部署就無聲遺失)
BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR", "").strip() or BACKEND_DIR)
```

- [x] **Step 4: 讓 `logger.py` 改讀 `DATA_DIR`**

`backend/app/core/logger.py`，把第 1-10 行改成：

```python
import logging
import re
from logging.handlers import RotatingFileHandler

from app.core.config import DATA_DIR

# 位置由 DATA_DIR 決定(本機 = backend/logs;正式環境 = Fly volume)
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOG_FILE = LOG_DIR / "words_api.log"
```

**注意**：`from pathlib import Path` 必須整行刪除 —— 原本全檔只有第 7 行用到 `Path`，留著就是死 import。

- [x] **Step 5: 讓失敗佇列改讀 `DATA_DIR`**

`backend/app/utils/retry_failed_words.py`，第 12-13 行的 import 區塊加入 config，並改掉第 19-20 行：

```python
from app.core.config import DATA_DIR
from app.core.logger import logger
```

```python
# 位置由 DATA_DIR 決定(本機 = backend/logs;正式環境 = Fly volume)
FAILED_LOG_FILE = DATA_DIR / "logs" / "failed_words.jsonl"
```

`from pathlib import Path` **要保留** —— 同檔第 176 行 `tmp_file = Path(str(FAILED_LOG_FILE) + ".tmp")` 還在用。

- [x] **Step 6: 執行新測試，確認通過**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_data_dir.py -q
```

預期：4 passed。

- [x] **Step 7: 執行完整測試套件，確認沒有回歸**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest -q
```

預期：**222 passed**（基線 218 + 新增 4）。`test_retry_drain.py` 用 `monkeypatch.setattr(retry_failed_words, "FAILED_LOG_FILE", ...)` 在測試時才換路徑，不受這次改動影響；`test_logger_sanitize.py` 只直接建 formatter，也不受影響。

- [x] **Step 8: Commit**

```bash
git add backend/app/core/config.py backend/app/core/logger.py backend/app/utils/retry_failed_words.py backend/tests/test_data_dir.py
git commit -m "refactor: 以 DATA_DIR 決定 log 與失敗佇列位置

本機不設時指回 backend/,行為與改動前相同;正式環境指向 Fly volume。
刻意不加 parents=True:上層目錄不存在代表 volume 沒掛上,要當場失敗
而不是靜默寫進容器暫存區。"
```

---

### Task 2: `GET /health`

**Files:**
- Modify: `backend/app/main.py`（在 router 掛載之後加入）
- Test: `backend/tests/test_health.py`（新增）

**Interfaces:**
- Consumes: Task 1 無相依
- Produces: HTTP `GET /health` → `200 {"status": "ok"}`。Task 5 的 `fly.toml` health check 打這個路徑。

- [x] **Step 1: 寫失敗的測試**

建立 `backend/tests/test_health.py`：

```python
"""Fly 的健康檢查端點:不驗身分、不碰資料庫"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)


def test_health_returns_ok_without_auth():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [x] **Step 2: 執行測試，確認失敗**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_health.py -q
```

預期：FAIL —— `404 Not Found`（`redirect_slashes=False`，不會被導去別的路由）。

- [x] **Step 3: 加入端點**

`backend/app/main.py`，接在三個 `app.include_router(...)` 之後：

```python
@app.get("/health")
async def health():
    """Fly 的健康檢查:不驗身分、不碰資料庫,只證明行程活著"""
    return {"status": "ok"}
```

- [x] **Step 4: 執行測試，確認通過**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_health.py -q
```

預期：1 passed。

- [x] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_health.py
git commit -m "feat: 新增 GET /health 供 Fly 健康檢查使用"
```

---

### Task 3: 所有回應標上 `Cache-Control: no-store`

**Files:**
- Modify: `backend/app/main.py`（middleware 加在 CORS **之後**；錯誤處理器補標頭）
- Test: `backend/tests/test_cache_headers.py`（新增）

**Interfaces:**
- Consumes: Task 2 的 `/health`（測試會用到）
- Produces: 所有回應帶 `Cache-Control: no-store`。這是規格 D8 的第二層保險 —— Vercel 對 2026-04-06 後建立的專案預設採信外部來源的 cache 標頭，而 `/words/deck`、`/words/review` 回傳的是每個使用者自己的單字。

- [x] **Step 1: 寫失敗的測試**

建立 `backend/tests/test_cache_headers.py`：

```python
"""API 回應不可被 CDN 快取:Vercel 的 rewrite 預設會採信上游 cache 標頭,
而 /words/deck、/words/review 回傳的是每個使用者自己的單字"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)


# 掛在真實 app 上,走完整 middleware 堆疊
@app.get("/__test_boom_cache__")
def _boom_test_route():
    raise RuntimeError("boom")


def test_normal_response_is_not_cacheable():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


def test_unauthorized_response_is_not_cacheable():
    response = client.get("/words/deck")

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_oversized_body_response_is_not_cacheable():
    # 413 由 limit_body_size 產生 → middleware 要最外層才蓋得到
    response = client.post("/words/fill", json={"word": "a" * 70000})

    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"


def test_unhandled_error_response_is_not_cacheable():
    # 500 走 ServerErrorMiddleware,在所有使用者 middleware 之外 → 由錯誤處理器補
    response = client.get("/__test_boom_cache__")

    assert response.status_code == 500
    assert response.headers["cache-control"] == "no-store"
```

- [x] **Step 2: 執行測試，確認失敗**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_cache_headers.py -q
```

預期：4 failed —— 前三條是 `KeyError: 'cache-control'`，第四條也是。

- [x] **Step 3: 加入 middleware（位置很重要）**

`backend/app/main.py`，**接在 `app.add_middleware(CORSMiddleware, ...)` 區塊之後**：

```python
# 必須在 CORS 之後 add:Starlette 最後 add 的是最外層,這樣才會連
# limit_body_size 產生的 411/413 都蓋到。Vercel 的 rewrite 預設採信上游
# cache 標頭,這行擋掉跨使用者快取
@app.middleware("http")
async def no_store(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response
```

- [x] **Step 4: 在錯誤處理器補標頭**

`backend/app/main.py`，把 `_apply_cors_for_error` 改名並補一行（該函式全檔只有一處呼叫、無測試引用）：

```python
def _apply_error_headers(request: Request, response: JSONResponse) -> JSONResponse:
    """未預期例外的回應不經過任何使用者 middleware(ServerErrorMiddleware 在最外層),
    這裡手動補上標頭,否則瀏覽器只會看到 network error、CDN 也可能快取。"""
    origin = request.headers.get("origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Cache-Control"] = "no-store"
    return response
```

同時把 `unhandled_exception_handler` 裡的呼叫改成 `_apply_error_headers(request, response)`。

- [x] **Step 5: 執行測試，確認通過**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_cache_headers.py -q
```

預期：4 passed。

- [x] **Step 6: 執行完整測試套件**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest -q
```

預期：**227 passed**。`test_error_handler.py` 仍須全過（它驗 500 的 CORS 標頭，改名不能改壞）。

- [x] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_cache_headers.py
git commit -m "feat: 所有回應加上 Cache-Control: no-store

Vercel 的 rewrite 對 2026-04-06 後建立的專案預設採信上游 cache 標頭,
而 /words/deck 與 /words/review 回傳的是每個使用者自己的單字。
middleware 放在最外層以涵蓋 411/413;500 走 ServerErrorMiddleware,
在使用者 middleware 之外,由錯誤處理器補上。"
```

---

### Task 4: `Dockerfile` 與 `.dockerignore`

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Test: `backend/tests/test_deploy_config.py`（新增，Task 5、6 會繼續往這個檔案加測試）

**Interfaces:**
- Consumes: Task 1 的 `DATA_DIR`
- Produces: 容器在 **8080** 監聽，啟動指令 `uvicorn app.main:app --workers 1`。Task 5 的 `fly.toml` `internal_port` 必須等於這個數字（有測試釘住）。

- [x] **Step 1: 寫失敗的測試**

建立 `backend/tests/test_deploy_config.py`：

```python
"""部署設定檔的護欄。放在後端測試是因為這裡是唯一會固定跑測試的地方,
不為了驗四個設定檔另建一套前端測試工具。"""
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def _dockerignore_lines() -> set:
    text = (BACKEND_DIR / ".dockerignore").read_text(encoding="utf-8")
    return {ln.strip() for ln in text.splitlines() if ln.strip()}


def test_dockerignore_excludes_env():
    """少了這行,backend/.env 的 service_role key 會被打進 image"""
    assert ".env" in _dockerignore_lines()


def test_dockerignore_excludes_venv():
    assert "venv/" in _dockerignore_lines()


def test_dockerfile_listens_on_8080_with_single_worker():
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")

    assert '"--port", "8080"' in dockerfile
    assert '"--workers", "1"' in dockerfile


def test_dockerfile_uses_python_312():
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")

    assert dockerfile.splitlines()[0].strip() == "FROM python:3.12-slim"
```

- [x] **Step 2: 執行測試，確認失敗**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：4 failed —— `FileNotFoundError: ...\.dockerignore`。

- [x] **Step 3: 建立 `.dockerignore`**

`backend/.dockerignore`：

```
venv/
.env
.env.*
__pycache__/
*.py[cod]
.pytest_cache/
.coverage
logs/
tests/
supabase/
requirements-dev.txt
pytest.ini
```

`venv/` 是數百 MB 的 Windows venv，進了 image 不但肥還會蓋掉容器裡的 Linux 套件；`.env` 是真正的機密。

- [x] **Step 4: 建立 `Dockerfile`**

`backend/Dockerfile`：

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# 先複製 requirements 再安裝:依賴層能被快取,改程式碼不必重裝依賴
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 單一 worker:限流計數器在 process 記憶體,多 worker 會各自計數而失準
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```

容器裡沒有 `backend/.env`，`config.py` 的 `load_dotenv` 會靜默略過，環境變數由 Fly 提供 —— 這是 `config.py` 原本就設計好的路徑。

- [x] **Step 5: 執行測試，確認通過**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：4 passed。

- [x] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore backend/tests/test_deploy_config.py
git commit -m "build: 新增後端 Dockerfile 與 .dockerignore

.dockerignore 必備:否則 backend/.env(service_role key)與整個 Windows
venv/ 都會被打進 image。單一 worker 是因為限流計數器在 process 記憶體。"
```

---

### Task 5: `fly.toml`

**Files:**
- Create: `backend/fly.toml`
- Test: `backend/tests/test_deploy_config.py`（追加測試）

**Interfaces:**
- Consumes: Task 4 的 8080 連接埠與 `/health`（Task 2）
- Produces: Fly app 設定 —— region `nrt`、volume 掛 `/data`、`DATA_DIR=/data`、常駐不停機。`app` 與 `source` 是部署時才知道的值，用 `CHANGEME-` 前綴佔位。

- [x] **Step 1: 寫失敗的測試**

在 `backend/tests/test_deploy_config.py` 末尾追加：

```python
def _fly_toml() -> str:
    return (BACKEND_DIR / "fly.toml").read_text(encoding="utf-8")


def test_fly_internal_port_matches_dockerfile():
    """兩邊不一致 = 部署後永遠不會健康"""
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")
    docker_port = re.search(r'"--port",\s*"(\d+)"', dockerfile).group(1)
    fly_port = re.search(r"internal_port\s*=\s*(\d+)", _fly_toml()).group(1)

    assert docker_port == fly_port


def test_fly_data_dir_matches_volume_mount():
    """DATA_DIR 沒對上掛載點 = log 寫進容器暫存區,重新部署即消失"""
    data_dir = re.search(r'DATA_DIR\s*=\s*"([^"]+)"', _fly_toml()).group(1)
    mount = re.search(r'destination\s*=\s*"([^"]+)"', _fly_toml()).group(1)

    assert data_dir == mount


def test_fly_keeps_the_machine_always_running():
    """限流計數器在記憶體,停機再啟會歸零"""
    fly_toml = _fly_toml()

    assert "auto_stop_machines = false" in fly_toml
    assert "min_machines_running = 1" in fly_toml


def test_fly_health_check_hits_health_endpoint():
    fly_toml = _fly_toml()

    assert 'path = "/health"' in fly_toml


def test_fly_primary_region_is_tokyo():
    assert 'primary_region = "nrt"' in _fly_toml()
```

- [x] **Step 2: 執行測試，確認失敗**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：5 failed —— `FileNotFoundError: ...\fly.toml`。

- [x] **Step 3: 建立 `fly.toml`**

`backend/fly.toml`：

```toml
# fly launch 會產生一份,這份是取代它的正式版
app = "CHANGEME-app-name"
primary_region = "nrt"

[build]

[env]
  # log 與失敗佇列寫進 volume;不對上掛載點的話會寫進容器內、重新部署即消失
  DATA_DIR = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  # 保持常溫:限流計數器在記憶體,停機再啟動會歸零
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/health"

[[mounts]]
  source = "CHANGEME-volume-name"
  destination = "/data"
```

`hkg` 已被 Fly 下架（2025-09 Region Consolidation），亞洲可選的是 `nrt`（東京）、`sin`（新加坡）、`bom`（孟買）。

- [x] **Step 4: 執行測試，確認通過**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：9 passed。

- [x] **Step 5: Commit**

```bash
git add backend/fly.toml backend/tests/test_deploy_config.py
git commit -m "build: 新增 fly.toml(東京 nrt、單機常駐、volume 掛 /data)

app 與 volume 名稱待 fly launch 後填入。"
```

---

### Task 6: `vercel.json`

**Files:**
- Create: `frontend/my-app/vercel.json`
- Test: `backend/tests/test_deploy_config.py`（追加測試）

**Interfaces:**
- Consumes: Task 5 的 Fly app 名稱（`CHANGEME-app-name`）
- Produces: Vercel 的 rewrite 與標頭設定。`/api/:path*` → `https://CHANGEME-app-name.fly.dev/:path*`。

- [x] **Step 1: 寫失敗的測試**

先在 `backend/tests/test_deploy_config.py` 檔頭把 `import json` 加進 import 區塊（跟既有的 `import re` 放一起），再於檔案末尾追加：

```python
VERCEL_JSON = REPO_ROOT / "frontend" / "my-app" / "vercel.json"


def _vercel_config() -> dict:
    return json.loads(VERCEL_JSON.read_text(encoding="utf-8"))


def test_vercel_rewrites_api_prefix_to_fly():
    """:path* 會吃掉 /api 前綴,所以後端路由維持 /words、/tests 不動"""
    rewrites = _vercel_config()["rewrites"]

    assert len(rewrites) == 1
    assert rewrites[0]["source"] == "/api/:path*"
    assert rewrites[0]["destination"].endswith(".fly.dev/:path*")


def test_vercel_disables_rewrite_caching_for_api():
    """Vercel 對新專案預設採信外部來源的 cache 標頭 —— /words/deck 是
    每個使用者自己的單字,被 CDN 快取就是跨使用者外洩"""
    headers = _vercel_config()["headers"]
    api_headers = [h for h in headers if h["source"] == "/api/:path*"]

    assert len(api_headers) == 1
    keys = {h["key"]: h["value"] for h in api_headers[0]["headers"]}
    assert keys["x-vercel-enable-rewrite-caching"] == "0"


def test_vercel_caching_optout_covers_every_rewrite():
    """改 rewrite 的 source 卻忘了改 headers 的 source,就會無聲漏掉快取防護"""
    config = _vercel_config()
    header_sources = {h["source"] for h in config["headers"]}

    for rewrite in config["rewrites"]:
        assert rewrite["source"] in header_sources
```

- [x] **Step 2: 執行測試，確認失敗**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：3 failed —— `FileNotFoundError: ...\frontend\my-app\vercel.json`。

- [x] **Step 3: 建立 `vercel.json`**

`frontend/my-app/vercel.json`：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://CHANGEME-app-name.fly.dev/:path*"
    }
  ],
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [
        { "key": "x-vercel-enable-rewrite-caching", "value": "0" }
      ]
    }
  ]
}
```

放在 `frontend/my-app/` 底下（Vercel 專案的 root directory 會設在那裡），**不是 repo 根目錄** —— 根目錄的 `vercel.json` 是 services 模式的做法，本設計不使用。

- [x] **Step 4: 執行測試，確認通過**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：12 passed。

- [x] **Step 5: 執行完整測試套件**

```bash
cd backend && ./venv/Scripts/python.exe -m pytest -q
```

預期：**239 passed**（218 基線 + Task 1 的 4 + Task 2 的 1 + Task 3 的 4 + Task 4 的 4 + Task 5 的 5 + Task 6 的 3）。

- [x] **Step 6: Commit**

```bash
git add frontend/my-app/vercel.json backend/tests/test_deploy_config.py
git commit -m "build: 新增 vercel.json(代理 /api 到 Fly 並關閉 rewrite 快取)

:path* 吃掉 /api 前綴,後端路由不必改。明確關閉外部 rewrite 快取:
/words/deck 與 /words/review 回傳的是每個使用者自己的單字。"
```

---

### Task 7: 部署與驗證（人工，需要使用者本人的帳號操作）

**Files:** 無新增檔案。會就地填入 Task 4-6 的 `CHANGEME-` 佔位值。

**Interfaces:**
- Consumes: Task 1-6 全部
- Produces: 一個上線的服務

**前置：安裝 flyctl。** 這台機器目前沒有 `fly` 指令，而我沒有你的 Fly 帳號，這步要你自己在 PowerShell 執行：

```powershell
iwr https://fly.io/install.ps1 -useb | iex
fly auth login
```

本機**不需要** Docker —— `fly deploy` 預設用 Fly 的遠端 builder 建 image。

- [ ] **Step 1: 建立 Fly app 與 volume**

```bash
cd backend
fly launch --no-deploy          # 會產生 fly.toml/Dockerfile;保留我們寫的版本,只抄下它給的 app 名稱
fly volumes create wordpractice_data --size 1 --region nrt
```

把 `backend/fly.toml` 的 `app` 改成 `fly launch` 給的名字、`source` 改成 `wordpractice_data`。

**`fly launch` 會想覆寫 `fly.toml`。** 填完名字後跑一次護欄測試，確認我們的設定沒被改掉：

```bash
cd backend && ./venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q
```

預期：12 passed。若紅燈，表示 `fly launch` 動了 `fly.toml`，把 Task 5 Step 3 的內容整份貼回去。

- [ ] **Step 2: 設定後端機密（自己輸入，不要貼進對話）**

```bash
fly secrets set SUPABASE_URL=... SUPABASE_KEY=... GEMINI_API_KEY=...
```

值從 `backend/.env` 抄。`SUPABASE_URL` 必須是**純專案網址**（`https://xxxx.supabase.co`）—— `config.py:25` 會檢查斜線數恰為 2，帶 `/rest/v1` 或結尾斜線會在開機時被擋下。`SUPABASE_JWT_SECRET`、`GEMINI_MODEL` 有需要再設。

- [ ] **Step 3: 部署後端並確認健康**

**先確認 `folders` 功能已經 commit。** `fly deploy` 是從工作目錄建 image，所以未 commit 的檔案也會一起上線；而 `main.py` 對 `app.routes.folders_route` 的 import 已經在 commit 裡了，沒有那個檔案的話，乾淨 checkout 出來的樹根本 import 不起來。兩件事一起解決：把 `folders` 做完並 commit，再部署。

```bash
fly deploy
curl https://<app-name>.fly.dev/health
```

預期：`{"status":"ok"}`。

- [ ] **Step 4: 確認認證沒有被繞過**

```bash
curl -i https://<app-name>.fly.dev/words/deck
```

預期：**401**。若回 200，表示繞過了 JWT 認證，立刻停下來查。

- [ ] **Step 5: 確認 volume 真的生效**

```bash
fly ssh console -C "ls -la /data/logs"
fly deploy
fly ssh console -C "ls -la /data/logs"
```

預期：第二次部署後，`words_api.log` 還在（檔案時間是前一次部署的時間）。

- [ ] **Step 6: 確認排水指令在正式環境可用**

```bash
fly ssh console -C "python -m app.utils.retry_failed_words"
```

預期：正常執行（沒有待重試項目時回報 0 筆）。這是選擇 Fly 而非 serverless 的主要理由之一。

- [ ] **Step 7: 建立 Vercel 專案**

在 Vercel 後台：Import Git Repository → **Root Directory 設 `frontend/my-app`** → Framework Preset 會自動認成 Create React App。

環境變數（**Build-time**，值從 `frontend/my-app/.env.local` 抄，自己貼進 Vercel 後台）：

| 名稱 | 值 |
|---|---|
| `REACT_APP_API_URL` | `/api` |
| `REACT_APP_SUPABASE_URL` | 同 `.env.local` |
| `REACT_APP_SUPABASE_ANON_KEY` | 同 `.env.local` |
| `REACT_APP_DEMO_EMAIL` | 選填 |
| `REACT_APP_DEMO_PASSWORD` | 選填 |

把 `frontend/my-app/vercel.json` 的 `CHANGEME-app-name` 換成 Step 1 的 app 名稱，commit 後再部署。改完同樣跑一次護欄測試（`pytest tests/test_deploy_config.py -q`，預期 13 passed）—— 其中 `test_vercel_destination_matches_fly_app_name` 會直接拿 `fly.toml` 的 `app` 去比對 rewrite 的目的地，名字兩邊打得不一致會當場紅燈。

- [ ] **Step 8: 端到端驗證（規格 §9）**

在瀏覽器打開 Vercel 網址，逐項確認：

1. 登入頁正常（不是停在 SetupNotice 的「還差一步」畫面）。
2. **開 DevTools → Network，確認 API 請求打的是 `/api/words/...` 而不是 `localhost:8000`** —— 這是最容易漏掉、且 build 不會報錯的失敗模式（`REACT_APP_API_URL` 沒設時 `client.js` 會靜默退回 localhost）。
3. 單字清單、複習、測驗三個流程都能跑完。
4. **寫入路徑要單獨確認（這一項最容易漏）。** 從 Vercel 網址新增一個單字、送出一次測驗答案，在 Network 面板確認是 **200**。`main.py` 的 `limit_body_size` 對「沒有數字 `Content-Length`」或帶 `Transfer-Encoding` 的 POST 一律回 **411**；本機與 `<app>.fly.dev` 直連時瀏覽器一定會帶 `Content-Length`，但 Vercel 的 rewrite 是否把 body 重組成 chunked 沒有文件保證。若真的回 411，原因就是這個 —— 對照組是直接打 `https://<app>.fly.dev/words/fill`，那裡應該正常。
   - 真的中了就改 `limit_body_size`：改成讀取請求 body 時累計位元組、超過上限即中止，藉此容許 chunked。**不要拿掉這個檢查** —— `<app>.fly.dev` 是公開的，拿掉等於讓 64KB 上限失效。
5. 隨機挑一個 `/api/...` 回應，確認 `Cache-Control: no-store` 有出現、且沒有被 CDN 快取（回應標頭不含 `x-vercel-cache: HIT`）。
6. 本機照舊 `uvicorn` + `npm start`，確認開發流程沒被影響。

- [ ] **Step 9: 確認區域**

到 Supabase Dashboard → Project Settings → General → Region 確認專案區域。若在新加坡，把 `backend/fly.toml` 的 `primary_region` 改成 `sin` 後重新部署（東京到新加坡的來回延遲約 70-90ms，值得改）。

---

## 完成後仍未涵蓋（規格 §10、§11）

- 部署時會停機（單機 + volume 的固有限制）。
- 不能水平擴充（限流綁單一 process）。
- volume 快照不是備份。
- preview 部署共用正式後端與資料庫。
- `<app>.fly.dev` 本身是公開的，知道網址的人可繞過 Vercel 直接打 API（JWT 認證仍有效）。要加固可在 Vercel 用 `routes` transform 帶共享密鑰標頭。
