import React from "react";

// 列表與全頁的共用狀態畫面:載入 / 錯誤 / 空清單。
// 統一放這裡,App 與 WordApp 不用各寫一份。

const Icons = {
  Empty: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300 dark:text-zinc-600 mb-2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  ),
  Alert: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-300 dark:text-red-900 mb-2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  ),
};

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-[#29382f] dark:border-t-white"
    />
  );
}

export function FullScreenLoading({ label = "載入中…" }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 dark:bg-[#0d1410]">
      <div className="flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400">
        <Spinner />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </div>
  );
}

export function LoadingState({ label = "載入單字中…" }) {
  return (
    <div className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 dark:border-[#29382f] bg-zinc-50/50 dark:bg-[#122017]/50 py-12 text-zinc-400 dark:text-zinc-600">
      <span className="mb-3 flex">
        <Spinner />
      </span>
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 px-6 py-12 text-center">
      <Icons.Alert />
      <p className="text-sm font-medium text-red-600 dark:text-red-400">
        {message || "發生錯誤,請稍後再試"}
      </p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-xl bg-zinc-900 dark:bg-white px-5 py-2 text-sm font-bold text-white dark:text-[#122017] shadow-md transition-all hover:opacity-90 active:scale-95"
      >
        重試
      </button>
    </div>
  );
}

export function EmptyState({ message = "目前沒有單字" }) {
  return (
    <div className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 dark:border-[#29382f] bg-zinc-50/50 dark:bg-[#122017]/50 py-12 text-zinc-400 dark:text-zinc-600">
      <Icons.Empty />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}
