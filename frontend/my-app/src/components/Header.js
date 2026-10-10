import React, { useState } from "react";

import Avatar from "./Avatar";

// 簡單的 SVG 圖標
const Icons = {
  Settings: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  Present: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
  )
};

export default function Header({ email = "", onSignOut, demoMode = false, onToggleDemo, isGuest = false }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // 取得當前日期格式 (e.g. "Mon, Oct 25")
  const today = new Date().toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <header className="flex items-center justify-between py-2">
      <div className="flex items-center gap-4 min-w-0">
        {/* 頭像(顯示 email 首字)+ 狀態點 */}
        <div className="relative shrink-0">
          <Avatar email={email} className="h-12 w-12 text-lg sm:h-14 sm:w-14 sm:text-xl" />
          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white dark:border-[#0d1410] rounded-full"></div>
        </div>

        <div className="flex flex-col min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white tracking-tight leading-none mb-1 truncate">
            Hi, <span className="align-baseline">{email}</span>
          </h1>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <span>{today}</span>
            <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600"></span>
            <span className="text-zinc-400 dark:text-[#5c7a6b]">Ready to learn</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* 展示模式切換:給別人看的時候,一鍵停用所有 AI 呼叫。
            訪客身分按了等於登出(交還裝置)→ 無障礙名稱直接說清楚,避免展示現場誤觸 */}
        <button
          type="button"
          aria-label={isGuest ? "結束展示並登出" : "展示模式"}
          aria-pressed={demoMode}
          onClick={onToggleDemo}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${
            demoMode
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-[#122017] hover:text-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          <Icons.Present />
          <span className="hidden sm:inline">展示模式</span>
        </button>

        {/* 帳號選單 */}
        <div className="relative shrink-0">
          <button
            aria-label="帳號選單"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="p-2.5 rounded-xl text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-[#122017] hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            <Icons.Settings />
          </button>

          {menuOpen && (
            <>
              {/* 點空白處關閉 */}
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />

              <div className="absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl border border-zinc-200 dark:border-[#29382f] bg-white dark:bg-[#122017] p-2 shadow-xl">
                <p className="truncate px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">{email}</p>
                <button
                  onClick={onSignOut}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  登出
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
