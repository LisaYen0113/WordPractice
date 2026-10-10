import React, { useState } from "react";

/**
 * 管理單一資料夾:改名 / 刪除。
 * 刪除走二次確認,而且文案要明講字會退回未分類、進度不會消失 ——
 * 這是使用者最怕按錯的一顆按鈕。
 */
export default function FolderEditor({
  folder,
  onRename,
  onDelete,
  onClose,
  pending = false,
  actionError = null,
}) {
  const [name, setName] = useState(folder.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const trimmed = name.trim();

  const submitRename = async () => {
    if (!trimmed) return;
    if (await onRename(trimmed)) {
      onClose();
    }
  };

  const submitDelete = async () => {
    if (await onDelete()) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#122017] rounded-2xl shadow-2xl border border-zinc-200 dark:border-[#29382f] p-4 flex flex-col gap-3">
        {confirmingDelete ? (
          <>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">
              刪除「{folder.name}」?
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              刪除後,裡面的字會回到「未分類」,複習進度不會消失。
            </p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="flex-1 h-11 rounded-xl border border-zinc-200 dark:border-[#29382f] text-zinc-600 dark:text-zinc-300 font-bold hover:bg-zinc-50 dark:hover:bg-[#29382f] transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitDelete}
                disabled={pending}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                確定刪除
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              編輯資料夾
            </h2>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename();
              }}
              placeholder="資料夾名稱"
              maxLength={50}
              className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-[#29382f] bg-white dark:bg-[#122017] text-sm text-zinc-900 dark:text-zinc-100"
            />
            <button
              onClick={submitRename}
              disabled={!trimmed || pending}
              className="h-11 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-[#0d1410] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              儲存
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              className="h-11 rounded-xl border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
            >
              刪除資料夾
            </button>
            <button
              onClick={onClose}
              className="h-11 rounded-xl border border-zinc-200 dark:border-[#29382f] text-zinc-600 dark:text-zinc-300 font-bold hover:bg-zinc-50 dark:hover:bg-[#29382f] transition-colors"
            >
              取消
            </button>
          </>
        )}

        {actionError && (
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {actionError}
          </p>
        )}
      </div>
    </div>
  );
}
