import React, { useState } from "react";

import { ALL_FOLDERS, UNCATEGORIZED } from "../utils/folders";

// 選中的 chip 樣式;與 Tabs 的選中態一致
const ACTIVE =
  "bg-zinc-900 dark:bg-white text-white dark:text-[#0d1410] border-transparent";
const INACTIVE =
  "bg-white dark:bg-[#122017] text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-[#29382f] hover:bg-zinc-100 dark:hover:bg-[#29382f]";

function Chip({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-bold transition-all duration-200 ${active ? ACTIVE : INACTIVE}`}
    >
      <span className="max-w-[8rem] truncate">{label}</span>
      <span className="text-xs font-mono opacity-70">{count}</span>
    </button>
  );
}

/**
 * 資料夾選擇器:橫向可捲動的 chip 列 + 最右邊的新增入口。
 * 篩選完全在前端做,這裡只回報選了哪一個。
 */
export default function FolderBar({
  folders = [],
  selection,
  onSelect,
  onEdit,
  counts = {},
  onCreate,
  pending = false,
  actionError = null,
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const uncategorizedCount = counts[UNCATEGORIZED] ?? 0;
  const trimmed = draft.trim();

  const submit = async () => {
    if (!trimmed) return;
    const ok = await onCreate(trimmed);
    // 失敗時保留輸入,讓使用者改一個字就能重試
    if (ok) {
      setDraft("");
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
        <Chip
          label="全部"
          count={total}
          active={selection === ALL_FOLDERS}
          onClick={() => onSelect(ALL_FOLDERS)}
        />
        <Chip
          label="未分類"
          count={uncategorizedCount}
          active={selection === UNCATEGORIZED}
          onClick={() => onSelect(UNCATEGORIZED)}
        />
        {folders.map((folder) => (
          <React.Fragment key={folder.id}>
            <Chip
              label={folder.name}
              count={counts[folder.id] ?? 0}
              active={selection === folder.id}
              onClick={() => onSelect(folder.id)}
            />
            {/* 編輯入口只跟著選中的 chip 出現 —— chip 本身是 button,
                不能把 button 疊進 button,所以放成兄弟節點 */}
            {selection === folder.id && (
              <button
                onClick={() => onEdit(folder.id)}
                aria-label={`編輯 ${folder.name}`}
                className={`shrink-0 px-2.5 py-1.5 rounded-full border text-sm font-bold transition-all duration-200 ${INACTIVE}`}
              >
                ⋯
              </button>
            )}
          </React.Fragment>
        ))}
        <button
          onClick={() => setAdding((prev) => !prev)}
          aria-label="新增資料夾"
          className={`shrink-0 px-3 py-1.5 rounded-full border border-dashed text-sm font-bold transition-all duration-200 ${INACTIVE}`}
        >
          ＋
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="資料夾名稱"
            maxLength={50}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200 dark:border-[#29382f] bg-white dark:bg-[#122017] text-sm text-zinc-900 dark:text-zinc-100"
          />
          <button
            onClick={submit}
            disabled={!trimmed || pending}
            className="shrink-0 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-[#0d1410] text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            建立
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}
    </div>
  );
}
