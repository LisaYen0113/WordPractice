-- WordPractice:Supabase 專案 schema
-- 用法:Supabase Dashboard → SQL Editor → 貼上全文執行(可重複執行)
-- 欄位與 backend/app/daos/* 的實際用法逐一對齊,請勿隨意改欄名。

create extension if not exists pgcrypto;

-- ============ folders:使用者自訂的單字分類 ============
-- 一個字最多屬於一個資料夾(user_words.folder_id);NULL = 未分類。
create table if not exists public.folders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    -- 同一使用者不能有兩個同名資料夾(名稱區分大小寫:TOEIC ≠ toeic)
    unique (user_id, name)
);

-- ============ words:單字共用資料庫(寫入只允許後端 service/secret key)============
create table if not exists public.words (
    id uuid primary key default gen_random_uuid(),
    word text not null,
    -- 不分大小寫的唯一鍵:Apple / apple 視為同一個字(DAO 以 word_lower 查詢)
    word_lower text generated always as (lower(word)) stored,
    pos text not null,
    definition text not null,
    kk_pronunciation text not null,
    etymology text,
    synonyms jsonb not null default '[]'::jsonb,
    antonyms jsonb not null default '[]'::jsonb,
    inflections jsonb not null default '[]'::jsonb,
    phrases jsonb not null default '[]'::jsonb,
    toeic_examples jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    unique (word_lower)
);

-- ============ user_words:每位使用者對每個字的複習進度 ============
create table if not exists public.user_words (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    word_id uuid not null references public.words (id) on delete cascade,
    familiarity_score int not null default 0 check (familiarity_score between 0 and 5),
    error_count int not null default 0,
    last_review_date timestamptz,                        -- 後端傳完整 ISO timestamp
    next_review_date date not null default current_date, -- 只比日期(lte)
    created_at timestamptz not null default now(),
    -- 刪資料夾時把裡面的字退回「未分類」,複習進度(熟悉度/排程/錯誤次數)完全不動
    folder_id uuid references public.folders (id) on delete set null,
    unique (user_id, word_id)
);

-- 既有的資料庫補欄位(上面 create table if not exists 對已存在的表不會生效)
alter table public.user_words
    add column if not exists folder_id uuid
    references public.folders (id) on delete set null;

create index if not exists user_words_user_due_idx
    on public.user_words (user_id, next_review_date);

-- 「列出某個資料夾裡的字」用的複合索引
create index if not exists user_words_folder_idx
    on public.user_words (user_id, folder_id);

-- ============ mistakes:作答錯誤紀錄 ============
create table if not exists public.mistakes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    word_id uuid not null references public.words (id) on delete cascade,
    test_type text not null,
    user_input text not null,
    is_correct boolean not null,
    ai_feedback text,
    ai_mistake_type text,
    created_at timestamptz not null default now()
);

create index if not exists mistakes_user_idx on public.mistakes (user_id);

-- ============ RLS:第二道鎖 ============
-- 後端用 service/secret key(繞過 RLS);以下政策是防止公開的 anon/publishable key
-- 被直接拿去打 PostgREST。

alter table public.words enable row level security;
alter table public.user_words enable row level security;
alter table public.mistakes enable row level security;
alter table public.folders enable row level security;

-- words:登入者可讀;沒有任何寫入政策(只有後端能寫)
drop policy if exists "words_select_authenticated" on public.words;
create policy "words_select_authenticated"
    on public.words for select
    to authenticated
    using (true);

-- user_words:只能存取自己的資料列
drop policy if exists "user_words_select_own" on public.user_words;
create policy "user_words_select_own"
    on public.user_words for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "user_words_insert_own" on public.user_words;
create policy "user_words_insert_own"
    on public.user_words for insert
    to authenticated
    with check (
        auth.uid() = user_id
        -- FK 只保證資料夾存在,不保證是我的 → 這裡自己驗
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

drop policy if exists "user_words_delete_own" on public.user_words;
create policy "user_words_delete_own"
    on public.user_words for delete
    to authenticated
    using (auth.uid() = user_id);

-- mistakes:只能存取自己的資料列(更新不開放)
drop policy if exists "mistakes_select_own" on public.mistakes;
create policy "mistakes_select_own"
    on public.mistakes for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "mistakes_insert_own" on public.mistakes;
create policy "mistakes_insert_own"
    on public.mistakes for insert
    to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "mistakes_delete_own" on public.mistakes;
create policy "mistakes_delete_own"
    on public.mistakes for delete
    to authenticated
    using (auth.uid() = user_id);

-- folders:只能存取自己的資料夾
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

-- ============ Grants:只給登入者;anon 一律不給 ============
grant usage on schema public to authenticated;
grant select on public.words to authenticated;
grant select, insert, update, delete on public.user_words to authenticated;
grant select, insert, delete on public.mistakes to authenticated;
grant select, insert, update, delete on public.folders to authenticated;

revoke all on public.words from anon;
revoke all on public.user_words from anon;
revoke all on public.mistakes from anon;
revoke all on public.folders from anon;
