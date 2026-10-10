import React from "react";

export default function Tabs({ tab, setTab }) {
  // 為了配合 App.js 的邏輯 (預設 tab 為 "new")
  // 第一個按鈕對應 "new" (未學習)，第二個按鈕對應 "learned" (已學習)
  
  return (
    <div className="grid grid-cols-2 p-1.5 bg-zinc-100 dark:bg-[#122017] rounded-2xl border border-zinc-200 dark:border-[#29382f]">
      <button
        onClick={() => setTab("new")}
        className={`flex items-center justify-center py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${
          tab === "new"
            ? "bg-white dark:bg-[#29382f] text-zinc-900 dark:text-white shadow-sm border border-zinc-100 dark:border-transparent"
            : "text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-[#29382f]/50"
        }`}
      >
        未學習
      </button>

      <button
        onClick={() => setTab("learned")}
        className={`flex items-center justify-center py-2.5 text-sm font-bold rounded-xl transition-all duration-200 ${
          tab === "learned"
            ? "bg-white dark:bg-[#29382f] text-zinc-900 dark:text-white shadow-sm border border-zinc-100 dark:border-transparent"
            : "text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200/50 dark:hover:bg-[#29382f]/50"
        }`}
      >
        已學習
      </button>
    </div>
  );
}