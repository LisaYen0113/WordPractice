# 資料夾功能設計（批次 2）

- 日期：2026-10-10
- 狀態：已與使用者逐段確認（§1 資料模型、§2 後端 API、§3 前端），待 spec 複核
- 前置批次：批次 1「刪除單字」（尚未動工，與本批無相依）

## 1. 背景與目標

WordPractice 目前把使用者的單字攤成一個平面清單，只用「未學習／已學習」兩個分頁區分。使用者要能自己分類（例如「TOEIC」「常錯」「課本 Unit 3」），並且**只練某一疊**。

這個功能同時是後續功能的基礎：批次 3 的學習紀錄與配對測驗，出題範圍與統計都會用到分類。

**成功標準**

1. 使用者可以建立／改名／刪除資料夾，並把任一個字指定到某個資料夾。
2. 選了某個資料夾，清單只顯示該資料夾的字。
3. 選了某個資料夾，開始測驗時只考該資料夾裡**已開啟測驗**的字。
4. **刪除資料夾不會損失任何複習進度**（熟悉度、錯誤次數、複習排程全部原封不動）。

## 2. 範圍

**納入**

- `folders` 資料表、`user_words.folder_id`、對應 RLS 與 grants
- 資料夾 CRUD 端點、指派端點
- `/deck` 帶出 `folder_id`
- 前端：資料夾 chip 列、詳情頁指派、改名／刪除 UI

**明示排除**

- 一個字同時屬於多個資料夾（標籤模式）
- 資料夾手動排序（`sort_order`）、巢狀資料夾
- 名稱不分大小寫去重
- `quizEnabled` 持久化到 DB
- 拖曳指派
- 批次 1（刪除單字）與批次 3（學習紀錄／配對測驗）

## 3. 已定案的決策

| # | 決策 | 理由 |
|---|---|---|
| D1 | 一個單字**只屬於一個資料夾**；`NULL` = 未分類 | 使用者選擇。只需一個可為空的外鍵，不需關聯表，UI 語意最直覺 |
| D2 | 刪資料夾時，裡面的字**回到「未分類」** | 使用者選擇。用 `ON DELETE SET NULL` 在 DB 層保證，應用層寫錯也傷不到複習進度 |
| D3 | 測驗出題範圍**跟著目前選中的資料夾** | 使用者選擇。`quizEnabled` 本來就是前端 session-local 篩選，這個維度幾乎免費 |
| D4 | 後端只做 CRUD，**篩選留在前端** | `/deck` 現狀已是全量載入（`limit: 200`）。前端篩選與既有 `tab`、`quizEnabled` 一致；切換資料夾不需打 API，也就不必新增 loading／競態處理 |
| D5 | 名稱**區分大小寫**，`unique (user_id, name)` | YAGNI。要不分大小寫需再加 generated column |
| D6 | 不加 `sort_order`、不加 `updated_at` | YAGNI，列表按 `created_at` |
| D7 | `GET /folders` **不回字數** | 前端手上已有完整 deck（上限 200 筆），字數自己算 |
| D8 | 測驗範圍**只跟資料夾，不跟 `tab`** | 維持現況（`quizWordCount` 本來就忽略 `tab`），只新增一個維度 |
| D9 | 刪除目前選中的資料夾後，篩選**退回「全部」** | 避免停在一個不存在的 id，畫面空白且無提示 |

## 4. 資料模型

`backend/supabase/schema.sql` 追加（沿用檔頭「可重複執行」的 `if not exists` 寫法）：

```sql
-- ============ folders:使用者自訂的單字分類 ============
create table if not exists public.folders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    unique (user_id, name)
);

alter table public.user_words
    add column if not exists folder_id uuid
    references public.folders (id) on delete set null;

create index if not exists user_words_folder_idx
    on public.user_words (user_id, folder_id);

alter table public.folders enable row level security;

drop policy if exists "folders_select_own" on public.folders;
create policy "folders_select_own"
    on public.folders for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own"
    on public.folders for insert
    to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own"
    on public.folders for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_delete_own"
    on public.folders for delete
    to authenticated
    using (auth.uid() = user_id);

grant select, insert, update, delete on public.folders to authenticated;
revoke all on public.folders from anon;
```

### 4.1 修補 `user_words` 的 RLS 漏洞（必要，非選配）

現有 `user_words` 的 insert／update 政策是 `with check (auth.uid() = user_id)` —— **只驗那一列屬於呼叫者，沒有驗 `folder_id` 指向的資料夾也屬於呼叫者**。加上 `folder_id` 之後，拿 anon／authenticated key 直接打 PostgREST 就能把字丟進別人的資料夾。

```sql
drop policy if exists "user_words_insert_own" on public.user_words;
create policy "user_words_insert_own"
    on public.user_words for insert
    to authenticated
    with check (
        auth.uid() = user_id
        and (folder_id is null or exists (
            select 1 from public.folders f
            where f.id = folder_id and f.user_id = auth.uid()
        ))
    );

drop policy if exists "user_words_update_own" on public.user_words;
create policy "user_words_update_own"
    on public.user_words for update
    to authenticated
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and (folder_id is null or exists (
            select 1 from public.folders f
            where f.id = folder_id and f.user_id = auth.uid()
        ))
    );
```

delete 政策不用改。子查詢在評估時同樣受 `folders_select_own` 約束，語意正確。

這道鎖與 §5.2 的後端擁有者檢查是**兩層不同防線**：RLS 擋直接打 PostgREST 的 anon key，DAO 擋走後端 API 的請求（後端用 service key，會繞過 RLS）。

## 5. 後端 API

新增檔案沿用既有分層（對齊 `daos/user_words_dao.py`、`schemas/words.py`、`routes/words_route.py`）：

- `app/daos/folders_dao.py`
- `app/schemas/folders.py`
- `app/routes/folders_route.py`
- `app/main.py` 加 `app.include_router(folders_router, prefix="/folders")`

### 5.1 端點

| Method | Path | Body | 成功回應 | 限流常數 |
|---|---|---|---|---|
| GET | `/folders` | — | `200` `[{id, name, created_at}]`（`created_at` 升冪） | `FOLDERS_READ_REQUESTS_PER_MINUTE = 60` |
| POST | `/folders` | `{name}` | `200` 新資料夾 | `FOLDERS_WRITE_REQUESTS_PER_MINUTE = 20` |
| PATCH | `/folders/{folder_id}` | `{name}` | `200` 更新後資料夾 | 同上 |
| DELETE | `/folders/{folder_id}` | — | `204` | 同上 |
| PUT | `/words/{word_id}/folder` | `{folder_id: uuid \| null}` | `200` `{word_id, folder_id}` | `SET_FOLDER_REQUESTS_PER_MINUTE = 60` |

限流沿用 `rate_limited("<name>", N)` 依賴 + 模組層常數，比照 `words_route.py:23-28`（依賴名 `folders_read` / `folders_write` / `set_folder`）。`PUT /words/{word_id}/folder` 放在 `words_route.py`（掛在 `/words` prefix 下），其餘四個在 `folders_route.py`。

**`word_id` 的語意（實作時最容易寫錯的一點）**：路徑上的 `word_id` 是 **`words.id`**（字典字庫的 id），**不是** `user_words.id`。與 `POST /mark_familiar` 的 `MarkFamiliarRequest.word_id` 一致 —— `words_route.py:43` 的 `_build_cards` 把 `w["id"]` 放進 `WordCard.word_id`，前端 `w.id` 拿到的就是它。因此指派一律以 `word_id` 為條件，不可用列 id。

### 5.2 DAO 規則

沿用 `user_words_dao.py:64` 的註解所述原則：**service key 會繞過 RLS，DAO 是唯一防線**，因此每個查詢都必須帶 `user_id` 範圍。

- `list_folders(user_id)` — `GET folders?user_id=eq.{user_id}&select=id,name,created_at&order=created_at.asc`
- `create_folder(user_id, name)` — `POST folders`（`Prefer: return=representation` 已由 `supabase_client._build_headers` 預設帶上），回傳新列
- `rename_folder(user_id, folder_id, name)` — `PATCH folders?id=eq.{folder_id}&user_id=eq.{user_id}` + `prefer="return=representation"`；**空結果必須 raise**（沿用 `update_user_word` 對「scoped PATCH 靜默回 204、假成功」的防護）
- `delete_folder(user_id, folder_id)` — `DELETE folders?id=eq.{folder_id}&user_id=eq.{user_id}`。**必須確認真的刪掉**：PostgREST 對 0 列的 DELETE 也回 204，因此要帶 `prefer="return=representation"`、回傳空陣列時 raise 404
- `get_folder(user_id, folder_id)` — `GET folders?id=eq.{folder_id}&user_id=eq.{user_id}`，供擁有者驗證
- `update_user_word_folder(user_id, word_id, folder_id)` — `PATCH user_words?user_id=eq.{user_id}&word_id=eq.{word_id}`，`data={"folder_id": folder_id}` + `prefer="return=representation"`；空結果 raise **404** `Word not found`

  刻意**不**沿用 `update_user_word` 的兩步查詢（`get_user_word_progress` 取列 id → 再 PATCH by id）：指派不需要先讀任何欄位，而 `unique (user_id, word_id)` 保證最多中一列。也刻意**不**沿用它的 500 —— 那邊的 500 是「剛讀到的列竟然寫不進去」的不變量被破壞；這邊空結果就是「這個字不在你的清單裡」，是客戶端錯誤，404 才誠實。

### 5.2.1 `/deck` 與 `/review` 的改動（三個地方，缺一不可）

1. `user_words_dao.get_all_user_words` 的 `select`：`word_id,familiarity_score` → `word_id,familiarity_score,folder_id`
2. `user_words_dao.get_user_words_due_today` 的 `select`：同樣要加 `folder_id`。**`/review` 也回 `WordCard`**，不同步改的話它的 `folder_id` 會靜默變成 `null`
3. `schemas/words.py` 的 `WordCard` 加 `folder_id: Optional[uuid.UUID] = None`；`words_route.py:37` 的 `_build_cards` 目前只建 `id_to_fam`，要一併帶出 `folder_id`（把 map 改成 `id → 該列`，或再加一個 `id_to_folder`）

### 5.3 擁有者驗證（安全關鍵）

`PUT /words/{word_id}/folder` 必須同時確認兩件事：

1. 那一列 `user_words` 屬於呼叫者 → 由 DAO 的 `user_id` 範圍達成
2. `folder_id`（非 null 時）指向的資料夾屬於呼叫者 → 呼叫 `get_folder(user_id, folder_id)`

驗證失敗一律回 **404，不是 403** —— 不洩漏「這個 id 存在、只是不是你的」。

### 5.4 驗證（`schemas/folders.py`）

- `name`：必填、`strip_whitespace=True`、`min_length=1`、`max_length=50`。全空白經 strip 後長度為 0 → 由 `min_length` 擋下並回 422（沿用 `main.py` 的 `RequestValidationError` 處理器，不回顯原始輸入）
- `folder_id`：`uuid.UUID | None`

### 5.5 錯誤對應

| 情境 | 狀態碼 | detail | 前端顯示 |
|---|---|---|---|
| 名稱重複（違反 `unique (user_id, name)`） | **409** | `Folder name already exists` | 「已經有同名資料夾」 |
| 資料夾不存在／不屬於自己 | 404 | `Folder not found` | 「找不到這個資料夾」 |
| 要指派的字不在自己的清單 | 404 | `Word not found` | 「找不到這個單字」 |

名稱重複這條：`supabase_client.py:65` 已經把上游 409 透傳（`upstream_status in (400, 404, 409)`），但 detail 是刻意通用的 `Database request failed`（避免洩漏 schema）。因此 **service 層要攔截 409 並改寫 detail** 成 `Folder name already exists`。

後端 detail 一律用英文，與現有 `Failed to update review progress`、`Failed to generate word details` 一致；中文訊息由前端映射。

## 6. 前端

### 6.1 新增檔案

| 檔案 | 職責 |
|---|---|
| `src/api/folders.js` | `fetchFolders / createFolder / renameFolder / deleteFolder`，薄封裝（比照 `src/api/words.js`） |
| `src/hooks/useFolders.js` | 資料夾清單 + CRUD + per-id pending／error（比照 `useReviewWords` 的 `requestIdRef` 與 `familiarPending` 慣例） |
| `src/components/FolderBar.js` | 橫向可捲動 chip 列：`[全部] [未分類] [TOEIC] … [+]` |
| `src/components/FolderPicker.js` | 指派用清單（在 `WordDetail` 內開啟） |
| `src/components/FolderEditor.js` | 改名／刪除的小 modal |
| `src/utils/folders.js` | `filterByFolder(words, selection)` 純函式，`selection` ∈ `"all"` \| `"uncategorized"` \| folder id |
| `src/utils/folders.test.js` | 上述純函式的測試 |

### 6.2 改動檔案

| 檔案 | 改動 |
|---|---|
| `src/api/mappers.js` | `cardToWord` 加 `folderId: card.folder_id ?? null`；`detailToWord` 加 `folderId: null`（新加入的字一律未分類） |
| `src/api/words.js` | 加 `assignFolder(wordId, folderId)` |
| `src/hooks/useReviewWords.js` | 加 `setFolder(wordId, folderId)`，比照 `setFamiliarity`：**以伺服器回傳值為準、不做樂觀更新**，失敗保留舊值 + per-id 錯誤 |
| `src/WordApp.js` | 加 `folderFilter` state（預設 `"all"`）；`displayedWords` 多一個條件；`quizWordCount` 與傳進測驗的 `words` 一起過濾；空資料夾傳 `EmptyState message="這個資料夾還沒有單字"` |
| `src/components/WordDetail.js` | Hero 區（`pos` 徽章那排）加資料夾 chip，點了開 `FolderPicker` |
| `src/components/StateViews.js` | **不用改** —— `EmptyState` 已收 `message` prop（`StateViews.js:63`） |

### 6.3 三個互動細節

1. **`displayedWords` 是唯一過濾點**（`WordApp.js:75`）。資料夾是**第三個**條件、與 `tab` 為 AND 關係。因為 `goPrevNext` 也用 `displayedWords`，詳情頁的「上一個／下一個」**自動跟著資料夾走**，不需另外改。

2. **測驗範圍只跟資料夾、不跟 `tab`**（D8）。`quizWordCount` 由 `words.filter(w => w.quizEnabled)` 改為 `filterByFolder(words, folderFilter).filter(w => w.quizEnabled)`；傳給 `PairQuiz`／`TextQuiz` 的 `words` 同樣改為過濾後的清單。刻意**不**加 `tab` 條件。

3. **刪除目前選中的資料夾 → 篩選退回「全部」**（D9）。`useFolders` 刪除成功後要通知 `WordApp` 重設 `folderFilter`。

### 6.4 UI 版面

- **選擇器**：`Tabs` 正下方一列橫向可捲動 chips，`Tabs` 元件本身不改。最右為 `[+]` 新增入口（inline 輸入框）。
- **指派**：只在詳情頁。`WordDetail` 的 footer 是 3 格 grid（上一個／標記熟悉／下一個），**不加第 4 顆**。chip 放**第二排**（發音那排，`WordDetail.js:63`）並用 `ml-auto` 靠右 —— 第一排是 `items-baseline` 的標題列，塞 chip 會對不齊也不夠放。
- **管理**：選中的 chip 顯示 `⋯`，點了開 `FolderEditor`（改名／刪除）。刪除需二次確認，且文案要明講「裡面的字會回到未分類，複習進度不會消失」。

## 7. 錯誤處理

沿用既有語彙，不新發明機制：

- 指派／改名／刪除失敗 → 保留原狀、顯示後端訊息；429 走 `familiarityErrorMessage` 那套「操作太頻繁，請等 N 秒再試」
- 名稱重複 → 409 → 「已經有同名資料夾」
- 建立／改名用 inline 表單，**失敗不清空輸入**
- `DELETE` 回傳空內容時 `supabase_request` 回 `None`（`supabase_client.py:52`），DAO 要處理這個形狀

## 8. 測試計畫

**後端**（pytest，沿用 `tests/` 慣例）

- `tests/test_folders_route.py` — CRUD 五個端點、驗證（空名稱／超長名稱／全空白 → 422）、限流
- `tests/test_folders_dao.py` — 每個查詢是否都帶 `user_id` 範圍；scoped PATCH／DELETE 沒中列時是否 raise
- `tests/test_daos_scoping.py` — 補 folders 案例
- **跨使用者越權測試**：把 A 的字指派到 B 的資料夾 → 404
- `tests/test_word_deck.py` — `/deck` 與 `/review` 都回傳 `folder_id`（含未分類為 `null`）

**前端**（colocated `*.test.js`／`*.test.jsx`）

- `src/utils/folders.test.js` — `filterByFolder` 三態
- `src/hooks/useFolders.test.jsx` — CRUD、競態、失敗保留原狀
- `src/hooks/useReviewWords.test.jsx` — 補 `setFolder` 案例（成功／失敗／不做樂觀更新）
- `src/WordApp.test.jsx` — 篩選與測驗範圍（現有測試已在驗 `quizWordCount`，要補資料夾案例）
- `src/components/FolderBar.test.jsx`、`src/components/FolderPicker.test.jsx`

**TDD 順序**：每一項都先寫 failing test。預期先做 `utils/folders`（純函式、無依賴）與後端 schema，再往上做 hook 與元件。

## 9. 風險與已知限制

| 項目 | 說明 |
|---|---|
| `/deck` 上限 200 筆 | `get_all_user_words` 已有 `limit: "200"`。字數超過 200 時，前端算出的各資料夾字數會失真。**本批不處理**，但要知道這是既有天花板 |
| 名稱大小寫 | `TOEIC` 與 `toeic` 是兩個資料夾（D5） |
| 指派無樂觀更新 | 跟 `setFamiliarity` 一致，慢一點但不會顯示錯誤狀態 |
| RLS 政策是破壞性替換 | §4.1 用 `drop policy` + `create policy`，重跑 schema.sql 會替換掉現有政策。**上線前要在 Supabase 專案上實測一次** |
| 前端無拖曳 | 拖曳指派是明示排除項 |

## 10. 後續（不在本批）

- 批次 1：刪除單字（1 端點 + 1 按鈕，可獨立出貨）
- 批次 3：學習紀錄（熱力圖真資料）+ 配對測驗
  - 熱力圖 = 當天作答次數，不去重
  - 配對 = 算入熱力圖 + 配錯記 `mistakes`，但不動熟悉度
  - 配對一輪 = 5 組（10 張卡）
