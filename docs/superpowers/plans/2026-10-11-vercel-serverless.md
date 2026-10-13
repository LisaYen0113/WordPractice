# Vercel 全託管部署實作計畫（無狀態後端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 WordPractice 的前後端都放上 Vercel（免費、不綁卡），後端改成無狀態，並把原本盯 `fly.toml` 的護欄測試改寫成盯新的設定。

**Architecture:** 兩個獨立的 Vercel 專案。前端（`frontend/my-app`）是 CRA 靜態產物加一條 top-level rewrite，把 `/api/:path*` 代理到後端專案；後端（`backend`）是既有的 FastAPI app，靠 `api/index.py` 把 ASGI 物件暴露出去，再用 catch-all rewrite 把任意路徑餵給它。`:path*` 會吃掉 `/api` 前綴，所以**後端路由一個字都不用改**。後端沒有磁碟、沒有常駐程序 —— 狀態是被放棄的，不是被修好的。

**Tech Stack:** FastAPI + uvicorn（本機）、Vercel Functions（Python runtime）、React CRA 5.0.1、Supabase Postgres（PostgREST over HTTPS）、Gemini API、pytest

**Spec:** `docs/superpowers/specs/2026-10-11-vercel-serverless-design.md`

## Global Constraints

每一條都適用於每一個 Task。

- **後端路由不帶 `/api` 前綴。** 前端一律打 `/api/...`，由 rewrite 吃掉前綴；`destination` 若把 `/api` 帶給後端，所有路由會 404。
- **機密只由使用者自己在 Vercel 後台輸入。** 不得寫進任何檔案、不得貼進對話、不得出現在 commit 裡。`backend/.env` 與 `frontend/my-app/.env.local` 都已 gitignore，不要動它們、也不要讀出來貼出去。
- **絕對不要對任何資料庫執行 `schema.sql`。** 那是唯一由人工負責的驗證步驟。
- ~~**`REACT_APP_DEMO_EMAIL` / `REACT_APP_DEMO_PASSWORD` 不要設。** 限流器在 serverless 上擋不住東西（spec D4），JWT 認證是唯一的門；設了等於把門打開給所有人消耗 Gemini 額度。~~ **2026-10-13 反轉：要設。** 代價是正式站沒有訪客入口（功能缺失）。改由後端的示範帳號配額擋 AI 花費 —— spec D13、§7.3。**新約束：`DEMO_USER_ID`（示範帳號的 UUID）必須設在後端專案上**，否則配額靜默失效。
- **Python 一律用 `backend/venv/Scripts/python.exe`。** 這台機器的裸 `python` 是 Microsoft Store 的 stub，`pytest` 也不在 PATH 上。
- **測試指令一律 `cd backend && venv/Scripts/python.exe -m pytest <path> -q`。**
- **後端錯誤訊息的語言：** 4xx（400/404/409/502）用**中文**，5xx 用**英文**。這是給人看的，不要混。
- **DAO 查詢一律帶 `user_id: eq.{user_id}`。** service key 會繞過 RLS，DAO 是唯一防線。
- **commit 格式 `<type>: <description>`**（`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf` / `ci`）。**不要加任何 attribution trailer。**
- **不要把 `npm run build` 輸出到共用的 `frontend/my-app/build/`** —— 另一個 session 在用這個 worktree。真要 build 就 `BUILD_PATH=./build-<name>`，用完刪掉。本計畫不需要跑前端 build。
- **不要動另一個 session 的 commit。**
- 檔案 < 800 行、函式 < 50 行、巢狀 < 4 層、不留 `console.log`、不硬寫值、**不 mutate**（一律產生新物件）。
- **不要繞過 permission classifier 的拒絕。** 被擋下來就回報，不要換路徑重試。

## Review Focus

spec 是願景文件，它沒寫到的地方不等於可以壞掉。以下五項是 spec 暗示、但**沒有任何 Task 的 pytest 會自動抓到**的失敗模式，依「最可能咬人」排序。前三項在 Tasks 3/4 有對應的人工／curl 步驟；後兩項已由測試釘住。

1. **後端專案的 Deployment Protection 沒關（spec D11）。** 症狀是前端的 rewrite 撞到 Vercel 登入牆，每個 API 請求都「成功」地回一頁 HTML —— 前端不會報錯，只會拿到解析不了的東西。Task 3 Step 6 用 `curl -i` 直接驗這件事。
2. **`REACT_APP_API_URL` 沒設或還指著舊後端。** `client.js` 的預設值是 `http://localhost:8000`，build 不會報錯，網站上線後所有請求打回本機。Task 4 Step 5 直接抓 production bundle 搜 `localhost:8000`。
3. **後端專案的實際網址與 `frontend/my-app/vercel.json` 裡假設的不一致。** Vercel 在 `wordpractice-api` 被占用時會給帶 team 後綴的別名。護欄擋得住「忘了填」（`CHANGEME`），擋不住「填了但填錯」—— 後者會讓整個網站 404 而所有測試全綠。Task 4 Step 1 就是為此存在。
4. **`/api` 前綴被漏給後端。** 已有 `test_vercel_rewrite_does_not_leak_api_prefix_to_backend` 釘住（Task 2）。
5. **快取標頭漏掉新的 rewrite source。** `/words/deck` 是每個使用者自己的單字，被 CDN 快取就是跨使用者外洩。已有 `test_vercel_caching_optout_covers_every_rewrite` 釘住（Task 2，沿用舊護欄）。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/core/logger.py` | 修改 | 檔案 handler 建不起來時降級成 console-only 並出聲；import 永不因 `DATA_DIR` 不可寫而失敗 |
| `backend/tests/test_data_dir.py` | 修改 | 改寫 `test_missing_data_dir_parent_fails_loudly` 成新契約（降級、不靜默）；probe 增加 handler 檢查 |
| `backend/api/index.py` | **新增** | Vercel Python runtime 的進入點，唯一責任是把 `app` 暴露出去 |
| `backend/vercel.json` | **新增** | catch-all rewrite 到進入點 + 函式設定 |
| `backend/tests/test_deploy_config.py` | 重寫 | 護欄從盯 `fly.toml` 改成盯兩份 Vercel 設定 |
| `backend/app/core/config.py` | 修改註解 | `DATA_DIR` 的註解從「Fly volume」改成「Vercel /tmp」，並寫明降級行為。**邏輯不動** |
| `backend/fly.toml` | **刪除** | 留著會讓人以為還在用 Fly |
| `frontend/my-app/vercel.json` | 修改 | rewrite 目的地從 `wordpractice.fly.dev` 改成後端 Vercel 專案 |

Task 1 與 Task 2 的檔案完全不重疊（Task 1 只碰 `logger.py` + `test_data_dir.py`），所以兩者可以先後執行而不互相污染。

---

### Task 1: logger 檔案 handler 容錯（TDD）

spec D7。目前 `logger.py:9` 在 **import 時**就 `LOG_DIR.mkdir(exist_ok=True)`，而且 `_build_file_handler()`（`logger.py:86`）還會再開一次檔。`DATA_DIR` 不可寫時整個 app 在 import 階段就死，症狀是「部署成功但每個請求 500」。改成降級到 console-only，**但在 stderr 留下指名路徑的 WARNING**。

> **這是一個刻意修訂，不是回歸修補。** `tests/test_data_dir.py:70` 原本釘住「volume 沒掛上就當場失敗」，而且理由是對的。在 Fly 上那個失敗發生在**部署階段**（健康檢查不過，部署被拒）而且有 SSH 可查；在 Vercel 上同一個失敗移到**執行階段**，使用者沒有 shell，traceback 埋在 dashboard 裡 —— 那不算大聲。原則（不能無聲）保留，機制（當場失敗 → 降級並警告）換掉。改寫測試時要把這段理由留在 docstring 裡。

**Files:**
- Modify: `backend/app/core/logger.py`
- Modify: `backend/tests/test_data_dir.py`

**Interfaces:**
- Consumes: `app.core.config.DATA_DIR`（已存在，不動）
- Produces:
  - `logger._build_file_handler() -> logging.Handler | None` —— 舊簽章回 `logging.Handler`，**新增 `None`**。`None` 代表目錄不可寫。
  - `logger._attach_file_handler(app_logger: logging.Logger) -> None` —— 新函式
  - `logger._is_console_handler(handler: logging.Handler) -> bool` —— 新函式
  - `logger.LOG_DIR` / `logger.LOG_FILE` 仍存在，且**在 import 時不再建立目錄**

- [ ] **Step 1: 改寫測試，讓它描述新契約（RED）**

把 `backend/tests/test_data_dir.py` 的 `_PROBE` 換成下面這版（多了 handler 檢查）：

```python
# 這些都是 import-time 常數,只有在乾淨的子行程裡重新 import 才驗得到
_PROBE = """
import json
import logging
from logging.handlers import RotatingFileHandler

from app.core.config import DATA_DIR
from app.core.logger import LOG_DIR
from app.utils.retry_failed_words import FAILED_LOG_FILE

handlers = logging.getLogger("app.core.logger").handlers

print(json.dumps({
    "data": str(DATA_DIR),
    "log": str(LOG_DIR),
    "queue": str(FAILED_LOG_FILE),
    "file_handlers": sum(isinstance(h, RotatingFileHandler) for h in handlers),
    "console_handlers": sum(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in handlers
    ),
}))
"""
```

把 `test_data_dir_creates_log_dir_on_import` 換成：

```python
def test_data_dir_creates_log_dir_on_import(tmp_path):
    probe = _probe_ok(tmp_path)

    assert (tmp_path / "logs").is_dir()
    assert probe["file_handlers"] == 1
    assert probe["console_handlers"] == 1
```

把 `test_missing_data_dir_parent_fails_loudly` **整條換掉**成下面兩條：

```python
def test_unwritable_data_dir_warns_instead_of_crashing(tmp_path):
    """DATA_DIR 不可寫時,import 要成功,但**必須出聲**。

    原本這條測的是「當場失敗」,理由寫在 config.py:「不能靜默退回容器暫存區」。
    那個理由是對的,但只在 Fly 上成立 —— 那裡失敗發生在部署階段(健康檢查不過,
    部署被拒),而且有 SSH 可查。Vercel 上沒有 shell,同一個失敗會變成
    「部署成功、每個請求 500、traceback 埋在 dashboard 裡」,那不算大聲。

    所以原則(不能無聲)保留,機制換掉:降級到 console-only,並在 stderr
    留下指名 LOG_DIR 路徑的 WARNING。console 是 Vercel 唯一收得到的管道,
    正式環境的 log 因此一點都不會少。
    """
    result = _probe(tmp_path / "not-mounted")

    assert result.returncode == 0, result.stderr
    assert "WARNING" in result.stderr
    assert "not-mounted" in result.stderr


def test_unwritable_data_dir_drops_file_handler_but_keeps_console(tmp_path):
    """降級要降得乾淨:不能留一個每次都寫失敗的檔案 handler,
    但 console handler 必須還在 —— 少了它就是「降級成啞巴」,比原本的當場失敗更糟"""
    probe = _probe_ok(tmp_path / "not-mounted")

    assert probe["file_handlers"] == 0
    assert probe["console_handlers"] == 1
```

- [ ] **Step 2: 跑測試，確認紅燈**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_data_dir.py -q`

Expected: **3 passed, 2 failed**。

紅的**恰好是兩條新測試**，這正是要的形狀：

| 測試 | 結果 | 原因 |
|---|---|---|
| `test_defaults_to_backend_dir_when_data_dir_unset` | pass | 不受影響 |
| `test_data_dir_env_moves_log_and_queue` | pass | 不受影響 |
| `test_data_dir_creates_log_dir_on_import` | pass | `DATA_DIR=tmp_path` 可寫，`mkdir` 成功，兩個 handler 都在 |
| `test_unwritable_data_dir_warns_instead_of_crashing` | **FAIL** | 目前 import 直接炸，`returncode != 0` |
| `test_unwritable_data_dir_drops_file_handler_but_keeps_console` | **FAIL** | `_probe_ok` 的 `returncode == 0` 斷言先失敗 |

若紅燈出現在別的地方（例如 `KeyError`），那是 `_PROBE` 沒改對，停下來查。

- [ ] **Step 3: 實作——把目錄建立移進檔案 handler**

在 `backend/app/core/logger.py`，把第 7-11 行：

```python
# 位置由 DATA_DIR 決定(本機 = backend/logs;正式環境 = Fly volume)
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOG_FILE = LOG_DIR / "words_api.log"
```

改成：

```python
# 位置由 DATA_DIR 決定(本機 = backend/logs;Vercel = /tmp/logs)。
# 目錄不在這裡建 —— 建立失敗的唯一處理點是 _build_file_handler,
# 在那裡失敗可以降級,在這裡失敗就是 import 失敗。
LOG_DIR = DATA_DIR / "logs"

LOG_FILE = LOG_DIR / "words_api.log"
```

- [ ] **Step 4: 實作——`_build_file_handler` 容錯**

把 `_build_file_handler()` 換成：

```python
def _build_file_handler() -> logging.Handler | None:
    """建目錄與開檔都在這裡 —— 這是唯一會因為 DATA_DIR 不可寫而失敗的地方。

    失敗時回 None,由 _attach_file_handler 降級並出聲。原本這裡讓 import
    當場失敗(tests/test_data_dir.py 記著當時的理由);換到 Vercel 後那等於
    「部署成功、每個請求 500」,所以改成降級。

    刻意不加 parents=True:上層目錄不存在就是設定錯了,不該順手生出一整棵樹。
    """
    try:
        LOG_DIR.mkdir(exist_ok=True)
        handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=MAX_LOG_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
            errors="backslashreplace",  # 保險:漏網字元也不能讓整筆 log 消失
        )
    except OSError:
        # FileNotFoundError(上層不存在)與 PermissionError / OSError(唯讀)
        # 都是 OSError 的子類,兩者都代表這裡寫不了
        return None
    handler.setFormatter(_sanitizing_formatter())
    return handler
```

- [ ] **Step 5: 實作——console 先掛，檔案 handler 失敗時出聲**

把 `_configure_logging()`（含前面的註解）換成下面三個函式：

```python
def _is_console_handler(handler: logging.Handler) -> bool:
    # RotatingFileHandler 也是 StreamHandler 的子類,不能只用 isinstance 判斷
    return isinstance(handler, logging.StreamHandler) and not isinstance(
        handler, RotatingFileHandler
    )


def _attach_file_handler(app_logger: logging.Logger) -> None:
    """檔案 handler 建不起來時降級成 console-only,但一定要出聲。

    沉默地失去檔案 log 正是原本「當場失敗」要防的事;既然不能失敗,
    就至少要在 stderr 留下一行指名路徑與後果的警告。
    """
    file_handler = _build_file_handler()
    if file_handler is not None:
        app_logger.addHandler(file_handler)
        return
    app_logger.warning(
        "Log 目錄 %s 不可寫,這次執行只有 console log;檔案 log 與失敗佇列都不會留下。"
        "在 Vercel 上請確認環境變數 DATA_DIR=/tmp 已設定。",
        LOG_DIR,
    )


def _configure_logging() -> None:
    """明確把 handler 掛在 app logger 上。
    basicConfig 在 root 已有 handler 時是 no-op(pytest、部分部署工具),
    會讓安全相關的 log 靜默消失,所以不用 basicConfig。"""
    app_logger = logging.getLogger("app.core.logger")
    app_logger.setLevel(logging.INFO)

    # console 先掛:它不會失敗,而且是 Vercel 唯一收得到的管道。
    # 先有它,下面檔案 handler 失敗時的警告才有地方可以去。
    if not any(_is_console_handler(h) for h in app_logger.handlers):
        app_logger.addHandler(_build_console_handler())

    if not any(isinstance(h, RotatingFileHandler) for h in app_logger.handlers):
        _attach_file_handler(app_logger)
```

注意 `setLevel` 從函式結尾移到前面 —— 警告必須在 logger 已設好等級之後才發出，否則會看 root logger 的臉色。

- [ ] **Step 6: 跑測試，確認綠燈**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_data_dir.py -q`

Expected: **5 passed**。

- [ ] **Step 7: 跑整個測試套件，確認沒有回歸**

Run: `cd backend && venv/Scripts/python.exe -m pytest -q`

Expected: 全綠。**特別注意 `test_logger_sanitize.py` 與 `test_retry_drain.py`** —— 它們都依賴 `logger`，`LOG_DIR` 改動若有副作用會在這裡現形。若有紅燈，先修好再往下。

- [ ] **Step 8: Commit**

```bash
git add backend/app/core/logger.py backend/tests/test_data_dir.py
git commit -m "fix: logger 檔案 handler 容錯,不再因 DATA_DIR 不可寫而擋住啟動"
```

---

### Task 2: Vercel 部署設定與護欄改寫

後端要有一個進入點讓 Vercel 認得，一份 `vercel.json` 把所有路徑餵給它，前端的目的地從 Fly 換成 Vercel，`fly.toml` 刪掉，護欄測試從盯 Fly 改成盯 Vercel。**這一批全部可以在本機驗證完，不必先部署。**

**Files:**
- Create: `backend/api/index.py`
- Create: `backend/vercel.json`
- Delete: `backend/fly.toml`
- Modify: `backend/app/core/config.py`（只改註解）
- Modify: `frontend/my-app/vercel.json`
- Rewrite: `backend/tests/test_deploy_config.py`

**Interfaces:**
- Consumes: `app.main.app`（已存在的 FastAPI 實例）
- Produces:
  - `backend/api/index.py` 暴露名為 `app` 的 ASGI 物件（Vercel 靠偵測這個名字接手）
  - `backend/vercel.json` 的 catch-all rewrite `/(.*)` → `/api/index`
  - 前端 rewrite 目的地 = `https://wordpractice-api.vercel.app/:path*`（**暫定值**，Task 3 拿到真網址後在 Task 4 修正）

- [ ] **Step 1: 先寫新護欄，讓它們紅燈（RED）**

把 `backend/tests/test_deploy_config.py` **整個檔案**換成：

```python
"""部署設定檔的護欄。放在後端測試是因為這裡是唯一會固定跑測試的地方,
不為了驗幾個設定檔另建一套前端測試工具。

2026-10-11 從 Fly 換到 Vercel:原本 5 條盯 fly.toml 的測試已無對象,
改寫成盯 Vercel 的兩份設定(前端 rewrite + 後端函式設定)。"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_VERCEL_JSON = REPO_ROOT / "frontend" / "my-app" / "vercel.json"
BACKEND_VERCEL_JSON = BACKEND_DIR / "vercel.json"
BACKEND_ENTRYPOINT = BACKEND_DIR / "api" / "index.py"
DOCKERFILE = BACKEND_DIR / "Dockerfile"

# 會被人手動填值的設定檔。CHANGEME 殘留一律紅燈。
DEPLOY_CONFIGS = [FRONTEND_VERCEL_JSON, BACKEND_VERCEL_JSON, DOCKERFILE]


# --- Dockerfile / .dockerignore:Vercel 用不到,但仍是逃生口,留著釘 ---


def _dockerignore_lines() -> set:
    text = (BACKEND_DIR / ".dockerignore").read_text(encoding="utf-8")
    return {ln.strip() for ln in text.splitlines() if ln.strip()}


def test_dockerignore_excludes_env():
    """少了這行,backend/.env 的 service_role key 會被打進 image"""
    assert ".env" in _dockerignore_lines()


def test_dockerignore_excludes_venv():
    assert "venv/" in _dockerignore_lines()


def test_dockerfile_listens_on_8080_with_single_worker():
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert '"--port", "8080"' in dockerfile
    assert '"--workers", "1"' in dockerfile


def test_dockerfile_uses_python_312():
    assert DOCKERFILE.read_text(encoding="utf-8").splitlines()[0].strip() == (
        "FROM python:3.12-slim"
    )


def test_fly_cleanup_removed_toml_but_kept_dockerfile():
    """使用者裁定「刪 fly.toml,留 Dockerfile」。留下的理由跟 Fly 無關:
    Vercel 的 Python runtime 若跑不動這個 app,Dockerfile 是改投 Render 的現成逃生口
    (裡面本來就是 uvicorn app.main:app,不需要為了換平台改一個字)"""
    assert not (BACKEND_DIR / "fly.toml").exists()
    assert DOCKERFILE.exists()


# --- 前端:rewrite 代理 ---


def _frontend_config() -> dict:
    return json.loads(FRONTEND_VERCEL_JSON.read_text(encoding="utf-8"))


def _api_rewrite() -> dict:
    matches = [
        r for r in _frontend_config()["rewrites"] if r["source"] == "/api/:path*"
    ]

    assert len(matches) == 1, f"應該恰好一條 /api/:path* rewrite,實際 {len(matches)} 條"
    return matches[0]


def test_vercel_rewrites_api_prefix_to_the_backend_project():
    """:path* 會吃掉 /api 前綴,所以後端路由維持 /words、/tests 不動"""
    assert _api_rewrite()["destination"].endswith("/:path*")


def test_vercel_rewrite_destination_has_no_placeholder():
    """手動填值時最容易漏的一格:沒填就整個網站的 /api 打到不存在的位址"""
    destination = _api_rewrite()["destination"]

    assert "CHANGEME" not in destination
    assert urlparse(destination).hostname


def test_vercel_rewrite_destination_is_a_vercel_app():
    """指回 *.fly.dev 或 localhost 都是舊設定殘留"""
    host = urlparse(_api_rewrite()["destination"]).hostname

    assert host.endswith(".vercel.app")


def test_vercel_rewrite_does_not_leak_api_prefix_to_backend():
    """destination 若變成 .../api/:path*,後端會收到 /api/words/deck → 全部 404。
    換目的地時最容易犯的錯,而其他護欄不會發現。"""
    destination = _api_rewrite()["destination"]

    assert "/api/" not in destination
    assert not destination.endswith("/api")


def test_vercel_disables_rewrite_caching_for_api():
    """Vercel 對新專案預設採信外部來源的 cache 標頭 —— /words/deck 是
    每個使用者自己的單字,被 CDN 快取就是跨使用者外洩"""
    headers = _frontend_config()["headers"]
    api_headers = [h for h in headers if h["source"] == "/api/:path*"]

    assert len(api_headers) == 1
    keys = {h["key"]: h["value"] for h in api_headers[0]["headers"]}
    assert keys["x-vercel-enable-rewrite-caching"] == "0"


def test_vercel_caching_optout_covers_every_rewrite():
    """改 rewrite 的 source 卻忘了改 headers 的 source,就會無聲漏掉快取防護"""
    config = _frontend_config()
    header_sources = {h["source"] for h in config["headers"]}

    for rewrite in config["rewrites"]:
        assert rewrite["source"] in header_sources


# --- 後端:Vercel 函式設定 ---


def _backend_config() -> dict:
    return json.loads(BACKEND_VERCEL_JSON.read_text(encoding="utf-8"))


def test_backend_routes_every_path_to_the_entrypoint():
    """api/index.py 這個單一檔名不會自動吃掉 /words/deck。
    少了 catch-all rewrite,除了 /api/index 以外的路徑全部 404"""
    rewrites = _backend_config()["rewrites"]

    assert rewrites == [{"source": "/(.*)", "destination": "/api/index"}]


def test_backend_entrypoint_exposes_an_asgi_app():
    """Vercel 的 Python runtime 靠偵測名為 app 的 ASGI 物件接手。
    這個檔案沒有 app,整個後端就不存在。

    用子行程驗(與 test_data_dir.py 同手法):要一個乾淨的 import 環境。
    `sys.path.insert(0, 'api')` 模擬 Vercel 從 api/ 底下載入這個檔案的處境,
    而 `from app.main import app` 要能在 cwd = backend/ 時走得通。
    """
    assert BACKEND_ENTRYPOINT.exists(), "backend/api/index.py 不存在,Vercel 找不到函式"

    probe = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; sys.path.insert(0, 'api');"
            " from index import app;"
            " print(type(app).__name__)",
        ],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )

    assert probe.returncode == 0, probe.stderr
    assert probe.stdout.strip().splitlines()[-1] == "FastAPI"


def test_no_changeme_left_in_deploy_configs():
    """佔位符沒填就紅燈 —— 這是舊護欄最核心的價值,換平台不能弄丟。
    逐檔檢查才能指名是哪一份還沒填。"""
    still_placeholder = [
        str(path.relative_to(REPO_ROOT))
        for path in DEPLOY_CONFIGS
        if "CHANGEME" in path.read_text(encoding="utf-8")
    ]

    assert still_placeholder == []
```

- [ ] **Step 2: 跑測試，確認紅燈**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q`

Expected: **10 passed, 4 failed**。

紅的只有這 4 條，而且原因都很直接：

| 紅燈 | 原因 |
|---|---|
| `test_vercel_rewrite_destination_is_a_vercel_app` | destination 還是 `wordpractice.fly.dev` |
| `test_fly_cleanup_removed_toml_but_kept_dockerfile` | `fly.toml` 還在 |
| `test_backend_routes_every_path_to_the_entrypoint` | `backend/vercel.json` 不存在 |
| `test_backend_entrypoint_exposes_an_asgi_app` | `backend/api/index.py` 不存在 |

**另外 10 條在舊的 Fly 設定下就已經是綠的**，這是預期中的，也值得看懂：它們守的是**跨平台仍然成立的契約**（`:path*` 有沒有吃掉前綴、`/api` 有沒有漏給後端、快取標頭有沒有覆蓋每一條 rewrite、佔位符有沒有填），不是「這是不是 Vercel」。這些契約從 Fly 換到 Vercel 一個字都沒變，本來就該繼續綠。

真正的風險因此不在這 10 條裡 —— 而在 `*.vercel.app` 那一條**擋不住「填了但填錯」**（見 Review Focus 第 3 項），所以 Task 4 Step 1 的人工核對不能省。

**先寫測試再改設定是刻意的** —— 護欄要先證明自己會對現狀說不，否則它只是在描述現狀。

- [ ] **Step 3: 建立後端進入點**

新增 `backend/api/index.py`：

```python
# Vercel Python runtime 的進入點。Vercel 會自動偵測名為 `app` 的 ASGI 物件,
# 不需要 mangum 之類的轉接層。其餘一行都不用在這裡做。
from app.main import app  # noqa: F401
```

`sys.path` 由 Vercel 處理（Root Directory = `backend`，而 `app/` 就在那裡），不必手動 append。

- [ ] **Step 4: 建立後端 `vercel.json`**

新增 `backend/vercel.json`：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index" }
  ],
  "functions": {
    "api/index.py": { "maxDuration": 60 }
  }
}
```

`maxDuration` 取 60 而不是 Hobby 上限的 300：`/fill` 要同步等 Gemini，60 秒對單次生成綽綽有餘，設太高只會讓真的卡住的請求佔住額度。

- [ ] **Step 5: 改前端 rewrite 目的地**

`frontend/my-app/vercel.json` 第 6 行，把：

```json
      "destination": "https://wordpractice.fly.dev/:path*"
```

改成：

```json
      "destination": "https://wordpractice-api.vercel.app/:path*"
```

**這是暫定值。** Vercel 在 `wordpractice-api` 被占用時會給帶 team 後綴的別名，Task 3 拿到真網址後要在 Task 4 修正。`headers` 那段**不要動**。

- [ ] **Step 6: 刪掉 `fly.toml`**

```bash
git rm backend/fly.toml
```

- [ ] **Step 7: 更新 `config.py` 的註解**

`backend/app/core/config.py` 第 10-13 行，把：

```python
# 可寫資料目錄(log 與失敗佇列)。不設 DATA_DIR 時指回 backend/,本機行為不變;
# 正式環境設成 Fly volume(例如 /data),重新部署才留得住 log 與待重試的單字。
# 刻意不加 parents=True:上層目錄不存在代表 volume 沒掛上,要當場失敗,
# 不能靜默退回容器暫存區(那樣下次部署就無聲遺失)
```

改成：

```python
# 可寫資料目錄(log 與失敗佇列)。不設 DATA_DIR 時指回 backend/,本機行為不變;
# 正式環境(Vercel)必須設成 /tmp —— serverless 只有 /tmp 可寫,而且內容隨實例消失,
# 所以在那裡的檔案 log 與失敗佇列只是痕跡,不是紀錄。
# 刻意不加 parents=True:上層目錄不存在就是設定錯了。logger 遇到寫不了時會降級成
# console-only 並留下指名路徑的警告,而不是默默把 log 散到別的地方
```

**邏輯那一行不要動**（`DATA_DIR = Path(os.getenv("DATA_DIR", "").strip() or BACKEND_DIR)`）。

- [ ] **Step 8: 跑護欄，確認綠燈**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q`

Expected: **14 passed**。

若 `test_backend_entrypoint_exposes_an_asgi_app` 紅燈，看 `probe.stderr`：若是缺少環境變數，代表 `conftest.py` 的 `os.environ.setdefault` 沒涵蓋到，補進 conftest；若是 `ModuleNotFoundError: app`，代表 `sys.path` 的安排跟 Vercel 不同，**這時不要改測試去遷就，要先確認 Vercel 的實際載入方式**。

- [ ] **Step 9: 跑整個測試套件**

Run: `cd backend && venv/Scripts/python.exe -m pytest -q`

Expected: 全綠。

- [ ] **Step 10: Commit**

```bash
git add backend/api/index.py backend/vercel.json backend/app/core/config.py frontend/my-app/vercel.json backend/tests/test_deploy_config.py
git commit -m "feat: 後端加上 Vercel 進入點與函式設定,護欄改盯 Vercel 而非 Fly"
```

（`git rm backend/fly.toml` 已在 Step 6 進 index，這一併帶上。）

---

### Task 3: 後端上 Vercel，證明它跑得起來【人工 + 我驗證】

**這是整份計畫的風險閘門。** 我到目前為止查證過的是 Vercel 的**額度**（Hobby 函式上限 300 秒 / 2GB / 1 vCPU），**沒有**證明 Vercel 的 Python runtime 跑得動這個 FastAPI app。過了這一關才往下做；沒過就改投 Render（Dockerfile 已經現成可用）。

**Files:** 無。純部署操作。

**Interfaces:**
- Consumes: Task 2 的 `backend/vercel.json` 與 `backend/api/index.py`
- Produces: 後端專案的 **production 網址**（Task 4 要用）

- [ ] **Step 1:【使用者】建立後端專案**

Vercel 後台 → Add New → Project → 匯入 `LisaYen0113/WordPractice`。

- Project Name: `wordpractice-api`
- Root Directory: `backend`
- Framework Preset: `Other`

- [ ] **Step 2:【使用者】設定環境變數**

在 Deploy **之前**，於同一頁的 Environment Variables 填入以下七項。**機密值由你自己輸入，不要貼進對話。**

| 變數 | 值 | 必要性 |
|---|---|---|
| `SUPABASE_URL` | 純專案網址 `https://xxxx.supabase.co` | 必要 |
| `SUPABASE_KEY` | service_role key | 必要 |
| `GEMINI_API_KEY` | | 必要 |
| `SUPABASE_JWT_SECRET` | | 選填 |
| `GEMINI_MODEL` | | 選填 |
| `DATA_DIR` | `/tmp` | **必要** |
| `DEMO_USER_ID` | 示範帳號的 Supabase UUID（**2026-10-13 新增**，spec D13） | **必要** |

兩個陷阱：`SUPABASE_URL` 必須是**純專案網址** —— 帶 `/rest/v1` 或結尾斜線會在開機時被 `config.py:25` 的斜線數檢查擋下（這是刻意的，貼錯格式會拿到明確錯誤而不是難以追查的 401）。`DATA_DIR` 漏設不會讓 app 掛掉，但會讓檔案 log 與失敗佇列消失（Task 3 Step 6 會驗）。

**`DEMO_USER_ID` 是 2026-10-13 補的閘門**（spec D13、§7.3）：公開 demo 帳密之後，這個帳號的付費 AI 呼叫被限成 3 次/小時。值從 Supabase 後台 **Authentication → Users** 複製那一列的 `id`，**不是 email**。漏設或填錯格式不會擋下任何請求，只會在 function log 留一行 ERROR 然後配額整條失效 —— Task 3 Step 7 附近的 log 檢查要一併看這行。

- [ ] **Step 3:【使用者】部署**

按下 Deploy，等它跑完。

- [ ] **Step 4:【使用者】關掉 Deployment Protection**

Settings → Deployment Protection → **Vercel Authentication** → 改成 `Disabled`。

**這一步不能跳過。** 沒關的話前端的 rewrite 會撞到 Vercel 登入牆，每個 API 請求都拿到一頁 HTML 登入畫面 —— 而前端不會報錯，只會拿到解析不了的東西。Step 6 會直接驗這件事。

- [ ] **Step 5:【使用者】抄下 production 網址**

在專案的 Overview 頁複製 production 網址，貼給我。**注意它可能不是 `wordpractice-api.vercel.app`** —— 名稱被占用時 Vercel 會給帶後綴的別名。這個值是 Task 4 Step 1 的輸入。

- [ ] **Step 6:【我】驗證後端真的活著**

拿到網址後跑這三條（`<URL>` 換成實際網址）：

```bash
curl -s -o /dev/null -w 'health: %{http_code}\n' https://<URL>/health
curl -s -o /dev/null -w 'deck(no token): %{http_code}\n' https://<URL>/words/deck
curl -s https://<URL>/ | head -c 300
```

判讀：

| 檢查 | 期望 | 不對代表 |
|---|---|---|
| `/health` | **200** | 500 → 進入點或 runtime 不相容，看 Vercel 的 function log；**這就是觸發逃生口的訊號** |
| `/words/deck` 不帶 token | **401** | 200 → 認證被繞過，**立刻停下**，這是安全性問題 |
| `/` 的輸出 | **不是 HTML 登入頁** | 是登入頁 → Step 4 沒生效，回去關 Deployment Protection |

`/health` 若 500，先看 Vercel 的 function log。若 log 顯示 `from app.main import app` 匯入失敗或 runtime 不支援，**停下來回報**，不要在同一條路上硬試 —— 改用 Dockerfile 轉 Render 是已經備好的替代方案。

`/health` 若**逾時或回 508**，那是 catch-all rewrite `/(.*)` 把自己的目的地 `/api/index` 又匹配了一次，形成迴圈。Vercel 的 rewrite 官方說明是每個請求只套用一次，所以預期不會發生 —— 但這是**推論不是查證**。真發生的話把 `backend/vercel.json` 的 source 改成排除 `/api/index` 的形式（例如 `/((?!api/index).*)`），改完重跑 Task 2 Step 8 的護欄（`test_backend_routes_every_path_to_the_entrypoint` 會紅，因為它比對的是完全相等的字串 —— 這時**改測試去反映新的 source**，不是改回有問題的設定）。

- [ ] **Step 7:【我】確認 `DATA_DIR=/tmp` 生效（§9 第 8 項）**

在 Vercel 的 function log 裡確認**沒有**出現這行：

```
Log 目錄 ... 不可寫,這次執行只有 console log
```

出現代表 `DATA_DIR` 沒設對 —— app 還是活著（這正是 Task 1 的降級），但檔案 log 與失敗佇列不會產生。回去 Step 2 補設，重新部署。

- [ ] **Step 8: 回報結果**

把 Step 6/7 的實際輸出貼給使用者，明確說出「後端在 Vercel 上跑得起來 / 跑不起來」。**在這一步之前不要宣稱部署成功。**

---

### Task 4: 前端接線與端到端驗證【人工 + 我驗證】

後端活了之後，把前端的目的地填成真網址，上線，然後跑 spec §9 的驗證清單。

**Files:**
- Modify: `frontend/my-app/vercel.json`（把 Task 2 的暫定值改成真網址 —— 若相同就不必改）

**Interfaces:**
- Consumes: Task 3 Step 5 的後端 production 網址
- Produces: 可用的網站

- [ ] **Step 1:【我】把暫定值改成真網址**

若 Task 3 拿到的網址不是 `https://wordpractice-api.vercel.app`，改 `frontend/my-app/vercel.json` 的 `destination`。然後：

**實際執行的結果（2026-10-11）：**兩個專案名稱都被別人占用，Vercel 給了帶後綴的別名，所以兩邊都不是暫定值：

| 專案 | 名稱 | Production 網址 |
|---|---|---|
| 前端 | `wordpractice` | `https://wordpractice-beta.vercel.app` |
| 後端 | `word-practice` | `https://word-practice-chi.vercel.app` |

下面 Step 5~7 的指令已用實際網址。**要重新確認時一律從 Vercel 後台複製，不要從本文件抄** —— 本文件其餘段落（Task 2、Task 3）保留的暫定值 `wordpractice-api.vercel.app` 是當時的輸入，不是本專案的站。

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_deploy_config.py -q`

Expected: **14 passed**。

**護欄擋不住「填了但填錯」** —— 它只驗 host 是 `*.vercel.app`、有 `:path*`、不含 `/api`、不含 `CHANGEME`。所以 Step 1 的網址必須是從 Vercel 後台**複製**的，不是憑印象打的。

- [ ] **Step 2:【我】Commit 並推上去**

```bash
git add frontend/my-app/vercel.json
git commit -m "chore: 前端 rewrite 目的地改成後端專案實際網址"
git push
```

若 Step 1 沒改到檔案（暫定值就是真網址），跳過這一步。

- [ ] **Step 3:【使用者】建立前端專案**

Vercel 後台 → Add New → Project → 匯入 `LisaYen0113/WordPractice`。

- Project Name: `wordpractice`
- Root Directory: `frontend/my-app`
- Framework Preset: `Create React App`（Vercel 會自動偵測）

環境變數（**build-time**，改了必須重新部署才會生效）：

| 變數 | 值 |
|---|---|
| `REACT_APP_API_URL` | `/api` |
| `REACT_APP_SUPABASE_URL` | 同 `frontend/my-app/.env.local` |
| `REACT_APP_SUPABASE_ANON_KEY` | 同 `.env.local`（anon 公開金鑰） |
| `REACT_APP_DEMO_EMAIL` | 同 `.env.local`（**2026-10-13 起要設**，見下） |
| `REACT_APP_DEMO_PASSWORD` | 同 `.env.local` |

~~`REACT_APP_DEMO_*` 留空是這一版設計裡最關鍵的一個「不設」：JWT 認證是唯一真正的門，設了 demo 帳密等於在公開網址上把門打開，任何人都能登入並消耗你的 Gemini 額度，而 serverless 上的限流器擋不住這件事。~~

**2026-10-13 反轉。** 留空的代價是正式站**沒有訪客入口**（`demoCredentials()` 回 `null` → 按鈕不渲染），這是功能缺失而不是安全設定。改為：這兩個值**要設**，AI 花費由後端新增的示範帳號配額擋著（**spec D13、§7.3**；後端專案另外要設 `DEMO_USER_ID`）。這三個值都在 gitignore 的 `.env.local` 裡，**不會進部署包**，必須在這裡重建一份。改了要**重新部署**（build-time 內嵌）。

缺 `REACT_APP_SUPABASE_*` 的話網站會停在 `SetupNotice` 的「還差一步」畫面（不會白屏）。

- [ ] **Step 4:【使用者】部署前端**

按下 Deploy，等它跑完。

- [ ] **Step 5:【我】驗證 API 不是打回 localhost**

`REACT_APP_API_URL` 沒設時 `client.js` 會**靜默**退回 `http://localhost:8000`，build 不會報錯。直接翻 production bundle 找證據：

```bash
BUNDLE=$(curl -s https://wordpractice-beta.vercel.app/ | grep -o '/static/js/main\.[a-z0-9]*\.js' | head -1)
echo "bundle: $BUNDLE"
curl -s "https://wordpractice-beta.vercel.app$BUNDLE" | grep -c 'localhost:8000'
```

Expected: `grep -c` 印出 **0**。非 0 代表 `REACT_APP_API_URL` 沒生效，回 Step 3 補設再重新部署。若 `bundle` 那行是空的，代表抓不到 script 標籤，改成手動開 DevTools → Network 確認請求打的是 `/api/words/...`。

- [ ] **Step 6:【我】確認 rewrite 代理真的通**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://wordpractice-beta.vercel.app/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://wordpractice-beta.vercel.app/api/words/deck
```

Expected: **200** 和 **401**。

第一條若回 404，代表 rewrite 沒生效；若回一頁 HTML，代表後端的 Deployment Protection 沒關。第二條若回 200，**立刻停下回報** —— 那是認證被繞過。

- [ ] **Step 7:【我】確認快取防護沒有破洞**

```bash
curl -s -D - -o /dev/null https://wordpractice-beta.vercel.app/api/words/deck | grep -i -E 'HTTP/|cache-control|x-vercel-cache'
```

Expected: **`HTTP/1.1 401`**、`cache-control: no-store`，且**沒有** `x-vercel-cache: HIT`。`/words/deck` 是每個使用者自己的單字，被 CDN 快取就是跨使用者外洩。

**絕對不要用 `curl -sI`（HEAD）。** 後端的 `/health` 與 `/words/deck` 對 HEAD 回 **405**，而 405 也帶 `no-store`、也不是 `HIT` —— 用 HEAD 驗會綠燈通過，但驗到的是 405 的標頭而不是真正的 GET 回應（2026-10-11 實際踩到）。所以上面的 grep 多抓一個 `HTTP/`，讓狀態碼本身出現在證據裡。

- [ ] **Step 8:【使用者】在瀏覽器上跑完整流程**

登入 → 單字清單 → 複習 → 測驗，三個流程都走一次。然後**新增一個單字、送出一次測驗答案**，確認寫入路徑回 200。

寫入路徑要單獨確認的原因：`main.py` 的 `limit_body_size` 對「沒有數字 `Content-Length`」的 POST 一律回 411。這一版沒有 rewrite 重組 body 的疑慮（Vercel 直接把 body 交給函式），但那是**推論不是查證**，所以照樣實測。

- [ ] **Step 9:【使用者】確認本機開發沒被影響**

`uvicorn` + `npm start` 照舊跑得起來。Task 1 動了 `logger.py`，本機的預設路徑是 `backend/logs`，行為應該完全一樣。

### Task 5: 恢復訪客入口並補上示範帳號配額（2026-10-13，spec D13／§7.3）

Task 4 部署完成後才發現的缺口：**正式站沒有訪客入口**。原因是 §7.2 的 `REACT_APP_DEMO_*` 留空（當時的安全決策），不是壞掉 —— 但那是功能缺失。本 Task 把閘門搬到後端，然後恢復入口。

- [x] **Step 1:【我】後端示範帳號配額（TDD）**

新增 `backend/app/core/demo_quota.py`，並在 `words_route.py` 的 `/fill`、`tests_route.py` 的 `/submit_definition` 各掛一行 `dependencies=[Depends(limit_demo_ai)]`。測試：`backend/tests/test_demo_quota.py`（4 條，含「跨端點共用額度」「其他帳號不受影響」「未設 `DEMO_USER_ID` 時不生效」「視窗是一小時不是一分鐘」）。**全套件 270 passed。**

- [ ] **Step 2:【使用者】關閉 Supabase 自助註冊（spec §7.4 第 1 項）**

Supabase 後台 → Authentication → Sign In / Providers → Email → 關掉 **Allow new users to sign up**。**這一步必須在公開 demo 帳密之前做** —— 本 app 沒有註冊畫面，關掉不損失功能；沒關的話，任何人自開一個帳號就繞過 Step 1 的配額。

- [ ] **Step 3:【使用者】把示範帳號的密碼換成高熵字串（spec §7.4 第 2 項）**

現行密碼是 6 位純數字，而 demo email 已寫在公開 repo 的四個測試檔裡。密碼一旦公開就是永久公開。改完要同步更新 `frontend/my-app/.env.local` 與 Vercel 的 `REACT_APP_DEMO_PASSWORD`。

- [ ] **Step 4:【使用者】設後端專案的 `DEMO_USER_ID`**

值是示範帳號的 **UUID**（Supabase 後台 Authentication → Users 複製 `id`，不是 email）。設定後**重新部署**後端。

- [ ] **Step 5:【使用者】設前端專案的 `REACT_APP_DEMO_EMAIL` / `REACT_APP_DEMO_PASSWORD`**

值同 `frontend/my-app/.env.local`（Step 3 換過的新密碼）。這兩個是 **build-time** 內嵌，**設完必須重新部署前端**才會生效。

- [ ] **Step 6:【使用者】驗證（對應 spec §9 第 10~13 項）**

登入頁看得到「訪客展示(免登入)」按鈕；後端 function log 有一行 `Demo quota: 示範帳號 <uuid> ...`；示範帳號打第 4 次 `/api/words/fill` 回 **429**；`/auth/v1/settings` 的 `disable_signup` 是 `true`。

- [ ] **Step 7:【使用者】先演練一次後台救援（spec §7.4 第 3 項）**

持有公開帳密的人可以改掉示範帳號的密碼，讓訪客入口永久失效（email 是 `@example.com`，收不到重設信）。發布前先確認自己會從 Authentication → Users 救回來。

---

## 完成後

- 把 `docs/superpowers/specs/2026-10-11-vercel-serverless-design.md` 的「狀態」從「待 spec 複核」改成「已實作並部署」。
- 更新 `docs/superpowers/specs/2026-10-10-vercel-fly-deploy-design.md` 的作廢橫幅，指向這份計畫的結果。
- 舊計畫 `docs/superpowers/plans/2026-10-10-vercel-fly-deploy.md` 保持原樣不動 —— 它是歷史紀錄。
