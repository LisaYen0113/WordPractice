import React from "react";

/**
 * 展示模式提示條:告知 AI 功能已停用(給別人看的時候不會有任何 AI 呼叫),
 * 並提供快速退出。
 */
export default function DemoBanner({ onExit }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-300">
      <p role="status" className="text-sm font-semibold">
        展示模式 — AI 功能已停用,顯示你帳號的資料
      </p>
      <button
        type="button"
        onClick={onExit}
        className="shrink-0 rounded-lg border border-amber-300 bg-white/60 px-3 py-1.5 text-sm font-bold text-amber-800 transition-colors hover:bg-white dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/40"
      >
        結束展示
      </button>
    </div>
  );
}
