# Vercel + Fly.io 部署設計

- 日期：2026-10-10
- 狀態：架構與區域已與使用者逐段確認，待 spec 複核
- 前置批次：無（與「資料夾功能」批次彼此獨立）

## 1. 背景與目標

專案目前只能在開發機上跑：FastAPI 用 uvicorn 起在 8000，CRA 用 `npm start` 起在 3000，兩者靠 localhost 互相找到對方。整個 repo 沒有任何部署設定 —— 沒有 Dockerfile、沒有 `vercel.json`、沒有 `fly.toml`、沒有 docker-compose。

目標是把前端放上 Vercel、後端放上 Fly.io，而且**使用者只看得到一個網域**。

**成功標準**

1. 前端在 Vercel、後端在 Fly.io，瀏覽器只看得到 Vercel 的網域。
2. **本機開發流程完全不變** —— uvicorn 與 `npm start` 照舊，不必先跑任何部署工具。
3. 後端的 log 檔與失敗單字佇列，在正式環境能存活過重新部署。
4. 失敗單字佇列的排水指令在正式環境仍可執行（原本靠本機檔案，雲端上很容易失效）。
5. 使用者的單字資料**不會因為 CDN 快取而跨使用者外洩**。

## 2. 範圍

**納入**

- `backend/Dockerfile`、`backend/.dockerignore`、`backend/fly.toml`
- `frontend/my-app/vercel.json`
- 後端新增 `DATA_DIR` 環境變數，並讓 logger 與失敗佇列改讀它
- 後端新增 `GET /health`
- API 回應加上 `Cache-Control: no-store`
- 部署與維運指令（寫進文件，不建 CI）

**明示排除**

- Vercel services 模式與任何 service binding（理由見 D2）
- 限流改用共享儲存（維持單機記憶體實作）
- 失敗單字佇列改寫進資料庫
- CI/CD 自動部署（先用 `fly deploy` 手動）
- 自訂網域
- 後端其他邏輯的重構

## 3. 已定案的決策

| # | 決策 | 理由 |
|---|---|---|
| D1 | 後端部署到 **Fly.io**，不是 Vercel | 這份程式碼建立在「常駐程序」的三個假設上：logger 寫本機檔案、失敗佇列寫本機檔案並靠 CLI 排水、限流計數器在 process 記憶體（`rate_limit.py` 檔頭自己寫明了）。Serverless 三個全打破。Fly 讓三個假設全部成立，後端幾乎不用改 |
| D2 | **不用 Vercel services，也不加任何 binding** | 原始指示假設後端也在 Vercel。實際上：(a) 前端是 CRA 靜態產物，binding 只注入到 function 的執行環境，靜態網站讀不到；(b) 前端→後端是**瀏覽器**發起的呼叫，本來就不在 binding 的適用範圍；(c) Vercel 上只剩前端一個服務，services 模式沒有意義 |
| D3 | 用 top-level rewrite **代理** `/api/:path*` → Fly，而不是讓前端直接打 Fly 網址 | 瀏覽器只跟 Vercel 同源講話 → 正式環境**完全沒有跨域請求**，不必維護 CORS allowlist，也不必為每個 preview 網域做設定。附帶好處：Fly 的真實網址不會出現在前端 bundle 裡 |
| D4 | 後端固定**一台機器 + 一個 volume** | 限流計數器在 process 記憶體，多實例會各自計數而失準。Fly 的 volume 只能掛在一台機器上，剛好強制了這個約束 |
| D5 | 區域 = **`nrt`（東京）** | 使用者選擇「亞洲」。**`hkg` 已被 Fly 下架**（2025-09 Region Consolidation 砍掉 17 區），不可選。若 Supabase 專案實際在新加坡，改 `sin` 即可 |
| D6 | volume 只放 `logs/`，路徑由新的 `DATA_DIR` 環境變數決定 | 改動最小：本機不設 `DATA_DIR` → 指回 `backend/logs`，行為與現在完全相同 |
| D7 | Dockerfile 用 `--workers 1` | 多 worker 會各自持有計數器，每使用者的限流會鬆掉 |
| D8 | **明確關閉** Vercel 對 `/api/:path*` 的 rewrite 快取 | Vercel 對 2026-04-06 之後建立的專案，預設採信外部來源的 cache 標頭。`/words/deck`、`/words/review` 是回傳「每個使用者自己的單字」的 GET，一旦被 CDN 快取就是跨使用者資料外洩 |
| D9 | 前端用相對路徑 `REACT_APP_API_URL=/api` | production 與 preview 部署自動共用同一份設定，不必為每個 preview 網域各自設定 |
| D10 | `src/api/client.js` **不改** | 預設值 `http://localhost:8000` 保留給本機；正式環境由 Vercel 的 build-time 環境變數覆蓋 |
| D11 | 不用 Vercel container runtime | 官方文件明講 container 套用同一組 Vercel Functions 限制（執行完即棄、只有 `/tmp` 可寫），解決不了根本問題 |

## 4. 架構

```
        瀏覽器
          │  https://<專案>.vercel.app     ← 使用者只看得到這一個網域
          ▼
┌─────────────────────────────────┐
│ Vercel（單一專案，非 services）    │
│ root directory = frontend/my-app │
│                                 │
│  /api/:path*  ──rewrite─────────┼──►  https://<app>.fly.dev/:path*
│  其他路徑      ──► CRA 靜態檔      │
└─────────────────────────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────────┐
                        │ Fly.io（1 台機器 + 1 volume）  │
                        │ uvicorn :8080，--workers 1    │
                        │ /data ← volume               │
                        │   logs/words_api.log         │
                        │   logs/failed_words.jsonl    │
                        └─────────────────────────────┘
                                      │
                                      ▼
                            Supabase REST + Gemini
```

**請求流程**

1. 瀏覽器請求 `https://<專案>.vercel.app/api/words/deck`，帶 `Authorization: Bearer <JWT>`。
2. Vercel 的 rewrite 把 `/api/words/deck` 轉成 `https://<app>.fly.dev/words/deck`（`:path*` 吃掉前綴），並在 CDN 邊緣代理，瀏覽器網址不變。
3. FastAPI 收到 `/words/deck`，用既有的 `get_current_user_id` 驗 JWT 後回傳資料。
4. 回應原路回到瀏覽器。整個過程對瀏覽器而言是**同源請求**。

注意 `/api` 前綴**由 Vercel 的 rewrite 吃掉**，所以後端路由維持 `/words/*`、`/tests/*` 不動 —— 這是外部 rewrite 相對 services 模式的優勢（services 的 `destination.path` 不會改變服務看到的路徑）。

`folders_router` 也在同一組路由下，一併被代理，不需要額外設定。

## 5. 後端改動

### 5.1 新增 `DATA_DIR`（`app/core/config.py`）

```python
BACKEND_DIR = Path(__file__).resolve().parents[2]

# 可寫資料目錄(log 與失敗佇列)。本機不設 → 指回 backend/,行為與現在完全相同;
# 正式環境指向 Fly volume(/data),重新部署才留得住
DATA_DIR = Path(os.getenv("DATA_DIR", "").strip() or BACKEND_DIR)
```

`app/core/logger.py:7` 與 `app/utils/retry_failed_words.py:20` 改讀 `DATA_DIR`：

```python
# logger.py
LOG_DIR = DATA_DIR / "logs"

# retry_failed_words.py
FAILED_LOG_FILE = DATA_DIR / "logs" / "failed_words.jsonl"
```

**這是整個後端唯一的功能性改動。** 路由、CORS、限流、服務層全部不動。

全後端只有三處用 `Path(__file__)` 定位檔案，其中兩處就是上面這兩個；`failed_words.rejected.jsonl` 與 `.tmp` 檔都由 `FAILED_LOG_FILE` 推導（`.with_name()` / `+ ".tmp"`），所以改一行就涵蓋三個檔案。第三處是 `config.py:8` 的 `load_dotenv(backend/.env)` —— 容器裡沒有那個檔案，`load_dotenv` 會靜默略過，環境變數直接由 Fly 提供。`config.py` 的註解本來就寫了「不覆蓋已存在的環境變數，正式環境可直接用系統環境變數」，這條路是作者原本就設計好的。

`config.py` 只 import `os`／`pathlib`／`dotenv`，不 import logger，所以 `logger.py` 反向 import `DATA_DIR` 不會造成循環。

### 5.2 新增 `GET /health`（`app/main.py`）

讓 Fly 的 health check 有端點可打（約 4 行）。不驗身分、不碰資料庫，只回 `{"status": "ok"}`。

### 5.3 API 回應加 `Cache-Control: no-store`（`app/main.py`）

在 `main.py` 加一層 middleware，為所有回應加上 `Cache-Control: no-store`。作為 D8 的第二層保險 —— 即使 Vercel 的設定被改動或繼承了不同預設，上游也不會給出可快取的訊號。

## 6. 新檔案

### 6.1 `backend/Dockerfile`

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# 先複製 requirements 再安裝:依賴層能被快取,改程式碼不必重裝依賴
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 單一 worker:限流計數器在 process 記憶體,多 worker 會各自計數
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```

（本機 venv 為 Python 3.12.4，故用 `python:3.12-slim`。）

### 6.2 `backend/.dockerignore`

**必須存在。** 沒有它的話，`backend/.env`（內含真實的 `SUPABASE_KEY` 與 `GEMINI_API_KEY`）與整個 `venv/` 都會被打進 image。

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

### 6.3 `backend/fly.toml`

```toml
app = "<app-name>"
primary_region = "nrt"

[build]

[env]
  # log 與失敗佇列寫進 volume;不設的話會寫進容器內、重新部署即消失
  DATA_DIR = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  # 保持常溫:限流計數器在記憶體,停機再啟會歸零
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
  source = "<volume-name>"
  destination = "/data"
```

`internal_port` 必須與 Dockerfile 的 `--port` 一致。`app` 與 `source` 由 `fly launch`／`fly volumes create` 產生後填入。

### 6.4 `frontend/my-app/vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://<app-name>.fly.dev/:path*"
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

放在 `frontend/my-app/` 底下（因為 Vercel 專案的 root directory 設在那裡），**不是 repo 根目錄** —— 根目錄的位置是 services 模式的做法，本設計不使用。

`:path*` 會吃掉 `/api` 前綴，所以後端看到的是 `/words/deck`。

## 7. 環境變數

### 7.1 Fly（後端）

機密值一律用 `fly secrets set`，**由使用者自己在終端機輸入，不要貼進任何對話或檔案**。

`SUPABASE_URL` 必須是**純專案網址**（`https://xxxx.supabase.co`）。`config.py:25` 會檢查斜線數是否恰為 2，帶 `/rest/v1` 或結尾斜線會讓程式在開機時直接擋下 —— 這是刻意的，貼錯格式會拿到明確錯誤而不是難以追查的 401。

| 變數 | 來源 | 必要性 |
|---|---|---|
| `SUPABASE_URL` | `backend/.env` | 必要（import 時檢查，缺了起不來） |
| `SUPABASE_KEY` | `backend/.env`（service_role） | 必要 |
| `GEMINI_API_KEY` | `backend/.env` | 必要 |
| `SUPABASE_JWT_SECRET` | `backend/.env` | 選填 |
| `GEMINI_MODEL` | `backend/.env` | 選填 |

非機密值放 `fly.toml` 的 `[env]`：`DATA_DIR=/data`。

### 7.2 Vercel（前端，**build-time**）

| 變數 | 值 |
|---|---|
| `REACT_APP_API_URL` | `/api` |
| `REACT_APP_SUPABASE_URL` | 同 `frontend/my-app/.env.local` |
| `REACT_APP_SUPABASE_ANON_KEY` | 同 `.env.local`（anon 公開金鑰） |
| `REACT_APP_DEMO_EMAIL` / `REACT_APP_DEMO_PASSWORD` | 選填 |

這些在 gitignore 的 `.env.local` 裡，**不會進部署包**，所以必須在 Vercel 專案設定裡重建一份。缺 `REACT_APP_SUPABASE_*` 的話網站會停在 `SetupNotice` 的「還差一步」畫面（不會白屏）。

## 8. 部署與維運

```bash
# 一次性
fly launch --no-deploy          # 產生 fly.toml 與 Dockerfile 骨架,再併入 §6 的內容
fly volumes create <volume-name> --size 1 --region nrt
fly secrets set SUPABASE_URL=... SUPABASE_KEY=... GEMINI_API_KEY=...

# 部署
fly deploy

# 日常
fly logs
fly status
fly ssh console -C "python -m app.utils.retry_failed_words"   # 排水失敗單字佇列
```

Vercel 端：建立專案 → Root Directory 設 `frontend/my-app` → 設定 §7.2 的環境變數 → 部署。

## 9. 驗證方式

1. `curl https://<app>.fly.dev/health` 回 `{"status":"ok"}`。
2. `curl https://<app>.fly.dev/words/deck` **不帶 token** → 401（確認認證沒被繞過）。
3. 從 Vercel 網域登入，單字清單、複習、測驗三個流程都正常。
4. `curl -I https://<專案>.vercel.app/api/words/deck` 確認回應帶 `Cache-Control: no-store`，且沒有被 CDN 快取。
5. `fly deploy` 一次後，`fly ssh console -C "ls -la /data/logs"` 確認舊的 log 檔還在（驗證 volume 真的生效）。
6. 本機照舊跑 uvicorn + `npm start`，確認開發流程沒被影響。

## 10. 已知限制與取捨

- **部署時會停機。** 單機 + volume 的組合，`fly deploy` 期間服務中斷（Fly 文件明講）。對這個應用可接受。
- **不能水平擴充。** 限流綁在單一 process，要擴充就得先把計數器搬到共享儲存（Supabase 或 Redis）。目前流量不需要。
- **volume 快照不是備份。** Fly 每天快照、預設保留 5 天，官方明講不該當主要備份手段。
- **preview 部署共用正式後端與資料庫。** 因為 rewrite 目標寫死在 `vercel.json`，所有 preview 都代理到同一個 Fly app。
- **Fly 網址本身是公開的。** 知道 `<app>.fly.dev` 的人可以繞過 Vercel 直接打 API。JWT 認證仍然有效，但少了 Vercel 這層。要加固可在 Vercel 用 `routes` transform 帶一組共享密鑰標頭，後端驗證 —— 本設計**不含**這項。
- **`hkg` 不可用**，已於 2025-09 被 Fly 下架。

## 11. 後續（不在本批）

- 失敗單字佇列改寫進 Supabase 表，讓補救機制不再依賴單機檔案。
- 限流改用共享儲存，換取水平擴充能力。
- 前端 build 時若缺 `REACT_APP_API_URL`，在 production build 直接報錯，避免靜默指回 localhost。
- 加 `x-origin-secret` 共享密鑰，讓 Fly 只接受來自 Vercel 的流量。
- CI/CD：push 即部署。
