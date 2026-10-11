# Vercel 全託管部署設計（無狀態後端）

- 日期：2026-10-11
- 狀態：設計已與使用者逐段確認並取得三項裁定，待 spec 複核
- **取代**：`2026-10-10-vercel-fly-deploy-design.md`（Fly.io 版本，因平台改政策而不可行）
- 前置批次：無（與「資料夾功能」批次彼此獨立）

## 1. 背景與為什麼換掉 Fly

上一版設計把後端放在 Fly.io：一台常駐機器 + 一個 1GB volume。理由是這份程式碼建立在**常駐程序**的三個假設上 —— logger 寫本機檔案、失敗佇列寫本機檔案並靠 CLI 排水、限流計數器在 process 記憶體。Fly 讓三個假設全部成立，後端幾乎不用改。

2026-10-11 執行 Task 7 時撞到硬牆。`fly apps create wordpractice --org personal` 回：

```
Error: We need your payment information to continue!
Add a credit card or buy credit: https://fly.io/dashboard/yu-fan-yen/billing
```

**Fly.io 已取消新帳號的免費層**，建 app 前必須先綁卡。`fly apps list` 確認「No apps found」—— 什麼都沒建成。使用者裁定：**不綁卡。**

重新盤點後的硬事實：**免費 + 持久磁碟 + 不綁卡，目前沒有平台同時給。**

| 平台 | 不用卡 | 持久磁碟 | 實測／查證到的代價 |
|---|---|---|---|
| Render 免費 web service | 是 | **否** | 0.1 vCPU / 512 MB；閒置 15 分鐘就睡，醒來 30–60 秒 |
| Vercel Functions (Hobby) | 是 | **否**（只有 `/tmp`） | 冷啟動 1–5 秒 |
| Koyeb | **否** | — | 2026-02 起要卡，含 $29 預授權 |
| Northflank | **否** | — | — |
| Railway | **否** | — | 每月 $1 額度，不夠跑一個服務 |
| Oracle Cloud Always Free | **否** | 是 | 免費但驗身分要卡 |

**因此本設計推翻「後端必須有狀態」這個前提，改採無狀態，兩邊都放 Vercel。**

這不是說上一版算錯了 —— 上一版對事實的判斷（serverless 會打破那三個假設）是對的。改變的是**約束**：多了「不能綁卡」這一條，而在這個約束下，「三個假設全部成立」的選項已經不存在。權衡的結果是：**接受那三個假設被打破，換取不用卡、1 vCPU / 2 GB、1–5 秒冷啟動。**

### 為什麼是 Vercel 而不是 Render

兩者都不用卡。Vercel 勝出的理由不只是規格：

1. **前端本來就要放 Vercel。** 同一個帳號、同一個後台，少一組憑證要管。
2. **1 vCPU / 2 GB 對 0.1 vCPU / 512 MB** —— 20 倍 CPU。
3. **冷啟動 1–5 秒對 30–60 秒。** 單字 App 一天開個幾次，每次罰一分鐘是不能接受的體驗。
4. 既有的 rewrite 架構**一個字都不用改**，只要換目的地。

## 2. 範圍

**納入**

- `backend/api/index.py`（新）—— ASGI 進入點
- `backend/vercel.json`（新）—— catch-all rewrite 與函式設定
- `backend/app/core/logger.py` —— 檔案 handler 改為容錯
- `backend/app/core/config.py` —— `DATA_DIR` 註解更新
- `frontend/my-app/vercel.json` —— rewrite 目的地改指後端專案
- `backend/tests/test_deploy_config.py` —— 護欄改盯新的設定
- **刪除** `backend/fly.toml`
- 部署與維運步驟（寫進文件，不建 CI）

**保留**

- `backend/Dockerfile` 與 `backend/.dockerignore` —— Fly 用不到了，但本機與其他平台仍好用，且已有測試釘住
- `GET /health`、`Cache-Control: no-store`、`DATA_DIR` 這三個 Task 1–3 的後端改動**全部保留**，語意不變

**明示排除**

- 限流改用共享儲存（維持記憶體實作，見 D4）
- 失敗佇列改寫進資料庫（見 D5）
- Vercel services 模式與任何 service binding
- 自訂網域、CI/CD 自動部署
- 後端其他邏輯的重構
- 前端程式碼的任何改動

## 3. 已定案的決策

| # | 決策 | 理由 |
|---|---|---|
| D1 | 後端部署到 **Vercel Functions**，不是 Fly、不是 Render | 見 §1。不用卡、規格最好、與前端同平台 |
| D2 | 前後端是**兩個獨立的 Vercel 專案**，用 rewrite 相連 | 兩者的 build 方式毫無共通點（CRA 靜態產物 vs Python 函式），而 Vercel 專案的 Root Directory 只能有一個。合併會逼出 `frontend/my-app/api/` 這種把後端塞進前端的畸形結構 |
| D3 | 前端用 top-level rewrite **代理** `/api/:path*` → 後端專案網址 | **沿用上一版 D3**：瀏覽器只跟 Vercel 同源講話 → 完全沒有跨域請求，不必維護 CORS allowlist，後端真實網址也不會出現在前端 bundle 裡 |
| D4 | 限流**維持記憶體實作，接受它在 serverless 上大幅弱化** | 使用者裁定「接受無狀態」。在 serverless 上每個實例各算各的、冷啟動歸零。**真正的門是 JWT 認證**（每個端點都要），加上 `REACT_APP_DEMO_*` 不設，能呼叫 AI 端點的只有使用者本人 —— 此時限流防的是自己的無窮迴圈。列為已知限制（§10），不假裝它有效 |
| D5 | 失敗佇列**維持寫檔，接受它在 serverless 上是唯寫的** | 同上裁定。`DATA_DIR=/tmp` 時它照常寫入、格式不變、測試照過，但**沒有排水路徑**：`/tmp` 隨實例消失，而 CLI 排水指令在沒有 SSH 的平台上叫不到。刻意不刪 —— 刪掉會讓「AI 產生成功但寫入 DB 失敗」這個情況完全失去痕跡。列為已知限制（§10） |
| D6 | `DATA_DIR=/tmp` 由 **Vercel 環境變數**設定，不改程式預設值 | 本機不設 → 指回 `backend/`，行為與現在完全相同。與上一版 D6 同精神 |
| D7 | **logger 的檔案 handler 必須容錯** | `logger.py:9` 在 **import 時**就 `LOG_DIR.mkdir()`。若 `DATA_DIR` 指向唯讀位置，整個 app 在 import 階段就掛掉，連 `/health` 都回不了 —— 症狀會是「部署成功但 500」，極難追。這是本設計唯一非改不可的程式碼 |
| D8 | 保留 `x-vercel-enable-rewrite-caching: 0` **且擴大覆蓋到所有 rewrite** | **沿用上一版 D8 且理由不變**：`/words/deck`、`/words/review` 回傳的是每個使用者自己的單字，一旦被 CDN 快取就是跨使用者資料外洩 |
| D9 | 前端維持 `REACT_APP_API_URL=/api` | 沿用上一版 D9。production 與 preview 自動共用同一份設定 |
| D10 | `src/api/client.js` **不改** | 沿用上一版 D10。預設值 `http://localhost:8000` 保留給本機 |
| D11 | 明確**關閉後端專案的 Deployment Protection** | 後端專案若開了 Vercel Authentication，前端的 rewrite 會撞到登入牆而拿到 401/HTML 登入頁，症狀是「API 全部回傳一頁 HTML」。必須在驗證清單裡確認（§9） |
| D12 | 不改用 Vercel container runtime | 沿用上一版 D11 的結論：官方文件明講 container 套用同一組 Vercel Functions 限制，解決不了根本問題 |

## 4. 架構

```
瀏覽器
  │  只認得一個網域
  ▼
https://wordpractice.vercel.app          ← Vercel 專案 1（前端）
  │  CRA 靜態產物
  │  vercel.json: rewrite /api/:path* → 後端專案
  ▼
https://wordpractice-api.vercel.app      ← Vercel 專案 2（後端）
  │  FastAPI，掛在 api/index.py
  │  rewrite /(.*) → /api/index
  ▼
Supabase Postgres (PostgREST over HTTPS)  +  Gemini API
```

**關鍵性質**

- 瀏覽器只看得到 Vercel 前端的網域。後端網址只出現在 Vercel 的伺服器設定裡。
- 前端 → 後端是 **Vercel 邊緣發起的伺服器對伺服器呼叫**，不是瀏覽器發起的 → **CORS 完全不觸發**。
- `:path*` 吃掉 `/api` 前綴，所以後端看到的路由仍是 `/words/deck`，**後端路由一個字都不用改**。
- 後端沒有磁碟、沒有常駐程序、沒有 SSH。這是本設計的核心取捨，不是疏漏。

**專案名稱**

| 專案 | Root Directory | 用途 |
|---|---|---|
| `wordpractice` | `frontend/my-app` | 前端靜態網站 |
| `wordpractice-api` | `backend` | 後端函式 |

後端專案的實際 production 網址，**要等專案建立後才能確定** —— Vercel 在 `wordpractice-api` 被占用時會給 `wordpractice-api-<team>.vercel.app` 這種帶後綴的別名。因此 `frontend/my-app/vercel.json` 的 `destination` 先填 `https://wordpractice-api.vercel.app/:path*`，建立後照實際網址修正。護欄測試會擋住「忘了改」（§6）。

## 5. 後端改動

### 5.1 `backend/api/index.py`（新）

Vercel 的 Python runtime 會把 `api/` 底下的檔案當成函式。這個檔案只做一件事：把既有的 ASGI app 暴露出去。

```python
# api/index.py
# Vercel Python runtime 的進入點。Vercel 自動偵測名為 `app` 的 ASGI 物件,
# 不需要 mangum 之類的轉接層。其餘一行都不用在這裡做。
from app.main import app  # noqa: F401
```

`sys.path` 由 Vercel 處理（Root Directory = `backend`，而 `app/` 就在那裡），不需手動 append。

### 5.2 `backend/vercel.json`（新）

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

- catch-all rewrite：`api/index.py` 這個單一檔名不會自動吃掉 `/words/deck` 這種路徑，要明示把所有路徑導到它。
- `maxDuration: 60`：Hobby 上限是 300 秒，取 60 是因為 `/fill` 要同步等 Gemini。60 秒對單次生成綽綽有餘；設太高只會讓真的卡住的請求佔用額度。

### 5.3 `app/core/logger.py` —— 檔案 handler 容錯（D7）

現在的樣子（`logger.py:8-9`，**在 import 時執行**）：

```python
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
```

改成：目錄建不起來時**放棄檔案 handler、保留 console handler**，而不是讓 import 失敗。console handler 本來就存在（`_build_console_handler`），Vercel 的 log 檢視器收的就是 stdout，所以正式環境的 log **一點都不會少**。

有兩件事在寫實作計畫時才查出來，補記在這裡：

**(a) 只擋 `mkdir` 不夠。** `_build_file_handler()`（`logger.py:86`）會 `RotatingFileHandler(LOG_FILE)` 真的開檔。目錄不存在時那裡同樣拋 `FileNotFoundError`。所以容錯要包住**檔案 handler 的建構**，不是只包 `mkdir`。做法是把目錄建立移進 `_build_file_handler()`，讓它成為唯一會因 `DATA_DIR` 不可寫而失敗的地方，失敗時回 `None`。

**(b) 降級必須出聲，不能靜默。** 這一版原本寫的是「靜默失去檔案 log」（§7.1、§10），但那正好違反 `tests/test_data_dir.py:70` 已經釘住的原則：

> 原設計的理由是「volume 沒掛上時要大聲失敗：靜默退回容器暫存區 = 下次部署無聲遺失 log 與待重試單字」

**原則不變，機制換掉。** 在 Fly 上「當場失敗」是對的：失敗發生在**部署階段**（健康檢查不過，部署被拒），而且有 SSH 可查。在 Vercel 上同一個失敗發生在**執行階段** —— 部署成功、每個請求 500、traceback 埋在 dashboard 的 log 裡，而使用者沒有 shell。那不算「大聲」。

所以改成：**降級到 console-only，但在 stderr 留下指名路徑與後果的 WARNING**。失去檔案 log 可以接受（serverless 上本來就留不住，§10），無聲失去不行。這也讓 §11 原本「把降級寫成明確警告」這一項當場完成，不必留到後續。

**因此 `tests/test_data_dir.py` 的 `test_missing_data_dir_parent_fails_loudly` 要一起改寫**，不是留著讓它紅燈。新契約：`DATA_DIR` 不可寫時 import **成功**、沒有檔案 handler、console handler 仍在、stderr 有指名路徑的警告。改寫時要保留原本的理由註解，並寫明為什麼換平台後行為改變 —— 那是刻意的修訂，不是漏掉的回歸。

這是本設計唯一非改不可的程式邏輯。改動範圍限於 `logger.py` 與 `tests/test_data_dir.py`。

### 5.4 `app/core/config.py` —— 只改註解

`DATA_DIR = Path(os.getenv("DATA_DIR", "").strip() or BACKEND_DIR)` **邏輯不動**。把第 10 行「正式環境指向 Fly volume」的註解改成現況。**不改預設值**（D6）。

### 5.5 保留不動的後端改動

Task 1–3 已完成並 commit（`44c2443` DATA_DIR、`c3345ba` `/health`、`b207446` `no-store`）。這三項**全部保留**，語意完全不變。

## 6. 護欄測試（`backend/tests/test_deploy_config.py`）

現有 13 條測試盯的是 `fly.toml` 與 `frontend/my-app/vercel.json` 的一致性。`fly.toml` 刪掉後要改寫成盯新的設定。**新護欄要能擋住這幾件事：**

1. `frontend/my-app/vercel.json` 的 rewrite 目的地**不含 `CHANGEME`**（沿用舊護欄的核心價值：佔位符沒填就紅燈）
2. rewrite 目的地 host 是 `*.vercel.app`（不是 `*.fly.dev`，也不是 localhost）
3. rewrite 出現 `:path*`，且**沒有**把 `/api` 前綴帶給後端（`destination` 不得以 `/api` 結尾或含 `/api/`）
4. `x-vercel-enable-rewrite-caching: 0` 的 header 規則**覆蓋每一條 rewrite 的 source**
5. `backend/vercel.json` 存在，且 catch-all rewrite 指向 `/api/index`
6. `backend/api/index.py` 存在且暴露 `app`
7. **`backend/fly.toml` 不存在** —— 留著會讓人以為還在用 Fly
8. `backend/Dockerfile` 仍存在 —— 是刻意保留的，不許被順手清掉
9. 全部設定檔（含 `backend/vercel.json`）都沒有 `CHANGEME` 殘留

## 7. 環境變數

### 7.1 後端專案（`wordpractice-api`）

**全部用 Vercel 後台設定。** 機密值由**使用者自己輸入，不要貼進任何對話或檔案**。

| 變數 | 值 | 必要性 |
|---|---|---|
| `SUPABASE_URL` | 純專案網址 `https://xxxx.supabase.co` | 必要 |
| `SUPABASE_KEY` | service_role | 必要 |
| `GEMINI_API_KEY` | | 必要 |
| `SUPABASE_JWT_SECRET` | | 選填 |
| `GEMINI_MODEL` | | 選填 |
| `DATA_DIR` | `/tmp` | **必要**（D6） |

`SUPABASE_URL` 必須是**純專案網址**。`config.py:25` 會檢查斜線數恰為 2，帶 `/rest/v1` 或結尾斜線會在**開機時**被擋下 —— 這是刻意的，貼錯格式會拿到明確錯誤而不是難以追查的 401。

⚠️ **`DATA_DIR` 漏設的後果**：預設值是 `backend/`，在 Vercel 上是唯讀的。有了 D7 的容錯，app 不會掛、`/health` 照回 200，但**檔案 log 與失敗佇列都不會產生**。這是可接受的降級（stdout 還在，Vercel 收的就是它），而且 **stderr 會有一行指名 `LOG_DIR` 路徑的 WARNING**（§5.3(b)）。§9 第 8 項就是在看這行警告有沒有出現 —— 有出現代表 `DATA_DIR` 沒設對。

### 7.2 前端專案（`wordpractice`，**build-time**）

沿用上一版，**值不變**：

| 變數 | 值 |
|---|---|
| `REACT_APP_API_URL` | `/api` |
| `REACT_APP_SUPABASE_URL` | 同 `frontend/my-app/.env.local` |
| `REACT_APP_SUPABASE_ANON_KEY` | 同 `.env.local`（anon 公開金鑰） |
| `REACT_APP_DEMO_EMAIL` / `REACT_APP_DEMO_PASSWORD` | **建議不設** |

這些在 gitignore 的 `.env.local` 裡，**不會進部署包**，必須在 Vercel 專案設定裡重建一份。

⚠️ **`REACT_APP_DEMO_*` 是這一版設計裡最關鍵的一個「不設」。** JWT 認證是唯一真正的門（D4），而設了 demo 帳密就等於把門打開給所有人 —— 公開網址上任何人都能登入並消耗你的 Gemini 額度。**限流器在 serverless 上擋不住這件事**（每個實例各算各的）。留空。

缺 `REACT_APP_SUPABASE_*` 的話網站會停在 `SetupNotice` 的「還差一步」畫面（不會白屏）。

## 8. 部署與維運

```text
# 一次性
Vercel 後台 → Add New → Project → 匯入 LisaYen0113/WordPractice
  專案 1:名稱 wordpractice      Root Directory = frontend/my-app
  專案 2:名稱 wordpractice-api  Root Directory = backend
兩個專案都設定 §7 的環境變數
後端專案 → Settings → Deployment Protection → 關閉           (D11)
抄下後端專案的 production 網址,填進 frontend/my-app/vercel.json 的 destination
跑護欄測試,再重新部署前端

# 日常
Vercel 後台的 Deployments 頁看 log(不叫 fly logs 了)
push 到 GitHub 即自動部署
```

**沒有停機時間**（與上一版不同）：Vercel 是滾動替換，不像 Fly 的單機 + volume 需要中斷。

**沒有排水指令**：`python -m app.utils.retry_failed_words` 在 Vercel 上無處可跑（沒有 SSH，且佇列在別的實例的 `/tmp` 裡）。這是 D5 的直接後果。

## 9. 驗證方式

1. `curl https://wordpractice-api.vercel.app/health` → `{"status":"ok"}`。
2. `curl -i https://wordpractice-api.vercel.app/words/deck` **不帶 token** → **401**。回 200 表示認證被繞過，停下來查。
3. **`curl -i https://wordpractice-api.vercel.app/` 不得回 HTML 登入頁** —— 這是 D11 的檢查。若回一頁 Vercel 登入畫面，表示 Deployment Protection 沒關，前端的 rewrite 會全部撞牆。
4. 從 Vercel 前端網域登入，單字清單、複習、測驗三個流程都正常。
5. **開 DevTools → Network，確認 API 請求打的是 `/api/words/...` 而不是 `localhost:8000`。** 這是最容易漏掉、且 build 不會報錯的失敗模式（`REACT_APP_API_URL` 沒設時 `client.js` 會靜默退回 localhost）。
6. **寫入路徑單獨確認。** 新增一個單字、送出一次測驗答案，確認回 **200**。`main.py` 的 `limit_body_size` 對「沒有數字 `Content-Length`」的 POST 一律回 411 —— 這一版沒有 rewrite 重組 body 的疑慮（Vercel 直接把 body 交給函式），但這是**推論不是查證**，所以照樣實測。
7. 隨機挑一個 `/api/...` 回應，確認帶 `Cache-Control: no-store`，且不含 `x-vercel-cache: HIT`。
8. **`DATA_DIR=/tmp` 確實生效**：在 Vercel 的 function log 裡確認 app 正常啟動，且沒有出現「目錄不可寫」的降級訊息。
9. 本機照舊 `uvicorn` + `npm start`，確認開發流程沒被影響。

## 10. 已知限制與取捨

**這一版新增的（使用者 2026-10-11 明確裁定接受）**

- **限流器在 serverless 上實質只剩裝飾。** 每個實例各算各的、冷啟動歸零。真正的門是 JWT 認證 + 不設 demo 帳密。要修就得把計數器搬進 Supabase（§11）。
- **失敗單字佇列在 serverless 上是唯寫的。** `DATA_DIR=/tmp` 時照常寫入、格式不變，但 `/tmp` 隨實例消失，且沒有排水路徑。刻意保留而不刪除，是為了讓「AI 產生成功但寫入 DB 失敗」留下痕跡。要修就得搬進 Supabase（§11）。
- **`DATA_DIR` 漏設會失去檔案 log**（stdout 仍在，且 stderr 有警告，不致命）。見 §7.1。
- **`/tmp` 上的 `RotatingFileHandler` 沒有實際觀察過。** `maxBytes=2MB` × `backupCount=5` 上限 12MB，遠低於 Vercel `/tmp` 的 512MB，但輪替在冷啟動之間的行為（每個新實例都是空目錄）只是推論。不影響正確性，只影響「log 能往回追多久」。

**沿用上一版、仍然成立的**

- **preview 部署共用正式後端與資料庫。** rewrite 目標寫死在 `vercel.json`，所有 preview 都代理到同一個後端專案。
- **後端網址本身是公開的。** 知道 `wordpractice-api.vercel.app` 的人可繞過前端直接打 API。JWT 認證仍然有效。要加固可在前端用 `routes` transform 帶共享密鑰標頭，後端驗證 —— 本設計**不含**這項。
- **Hobby 方案僅限非商業用途。** 這是個人單字 App，符合。
- **Vercel Hobby 不能連「組織擁有的」Git repo。** `LisaYen0113/WordPractice` 是個人帳號，不受影響（已查證）。

**已消失的舊限制**

- ~~部署時會停機~~ —— Vercel 滾動替換，不再成立。
- ~~volume 快照不是備份~~ —— 沒有 volume 了。
- ~~`hkg` 不可用~~ —— 不再選 Fly 區域。

## 11. 後續（不在本批）

- 失敗單字佇列搬進 Supabase 表，讓補救機制不再依賴實例。
- 限流改用 Supabase 共享計數器，取回跨實例的正確性。
- 前端 build 時若缺 `REACT_APP_API_URL`，在 production build 直接報錯，避免靜默指回 localhost。
- 加共享密鑰標頭，讓後端只接受來自前端的流量。
- 讓 `DATA_DIR` 降級反映在 `/health` 上（例如回 503 而不是照回 200）。現在只看得到 log 警告，而且只有去翻 function log 的人才看得到。
- ~~把 `DATA_DIR` 的降級寫成啟動時的明確警告，而不是靜默~~ —— 已於本批完成（§5.3）。
