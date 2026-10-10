import React from "react";

/**
 * 全域錯誤邊界:任何 render 期間的例外都不該讓整個 App 變白屏。
 * 顯示中文錯誤畫面 + 重新載入(資料都存在伺服器,重載不丟失)。
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("畫面發生未預期錯誤:", error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-[#0d1410] px-6 text-center">
        <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
          畫面發生錯誤
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          重新載入後再試一次;你的單字都安全地存在伺服器上。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-zinc-900 dark:bg-white px-6 py-3 font-bold text-white dark:text-[#122017] shadow-md transition-all hover:opacity-90 active:scale-95"
        >
          重新載入
        </button>
      </div>
    );
  }
}
