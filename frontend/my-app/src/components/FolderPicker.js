import React from "react";

// 選中/未選中的清單列樣式。選中態沿用 FolderBar 的 ACTIVE/INACTIVE 手法與 Tabs 的
// 「抬高底色 + 白字」色票,再加上左側粗邊,讓看得見的使用者一眼找到字在哪個資料夾。
// 兩組樣式互斥、不共用衝突的屬性,避免靠 Tailwind 產生順序決定誰贏。
const OPTION_BASE =
  "w-full text-left px-4 py-3 rounded-xl border transition-colors disabled:opacity-50 disabled:cursor-wait";
const OPTION_IDLE =
  "border-zinc-200 dark:border-[#29382f] bg-white dark:bg-[#122017] text-zinc-700 dark:text-zinc-200 font-medium hover:bg-zinc-100 dark:hover:bg-[#29382f]";
const OPTION_ACTIVE =
  "border-zinc-900 dark:border-white border-l-4 bg-zinc-100 dark:bg-[#29382f] text-zinc-900 dark:text-white font-bold";

/**
 * 選項列。active 同時決定 aria-current 與 className —— 兩者必須同源,
 * 分開判斷就會做出「輔助技術知道、看得見的使用者看不出來」的選中態(aria-current
 * 在 button 上沒有任何瀏覽器預設樣式)。
 */
function Option({ active, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "true" : "false"}
      className={`${OPTION_BASE} ${active ? OPTION_ACTIVE : OPTION_IDLE}`}
    >
      {children}
    </button>
  );
}

/**
 * 指派單字到資料夾。清單很小(使用者自己的資料夾),不必搜尋框。
 * onPick(null) = 移回未分類。
 */
export default function FolderPicker({
  folders = [],
  currentFolderId = null,
  onPick,
  onClose,
  pending = false,
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#122017] rounded-2xl shadow-2xl border border-zinc-200 dark:border-[#29382f] p-4 flex flex-col gap-3 max-h-[80vh]">
        <h2 className="text-sm font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
          移到哪個資料夾
        </h2>

        <div className="flex flex-col gap-2 overflow-y-auto">
          <Option
            active={currentFolderId === null}
            disabled={pending}
            onClick={() => onPick(null)}
          >
            未分類
          </Option>

          {folders.map((folder) => (
            <Option
              key={folder.id}
              active={currentFolderId === folder.id}
              disabled={pending}
              onClick={() => onPick(folder.id)}
            >
              {folder.name}
            </Option>
          ))}

          {folders.length === 0 && (
            <p className="text-sm text-zinc-400 dark:text-zinc-600 px-1">
              還沒有資料夾,回列表用＋新增
            </p>
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-1 h-11 rounded-xl border border-zinc-200 dark:border-[#29382f] text-zinc-600 dark:text-zinc-300 font-bold hover:bg-zinc-50 dark:hover:bg-[#29382f] transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}
