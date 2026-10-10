import React from "react";

// 簡單的 SVG 圖標
const Icons = {
  Rocket: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.1 4-1 4-1"/><path d="M12 15v5s3.03-.55 4-2c1.1-1.62 1-4 1-4"/></svg>
  ),
  Puzzle: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19.439 15.424a1 1 0 0 0-1.026 1.712c.158.095.322.185.488.27a6.476 6.476 0 0 1-1.258 1.173A6.52 6.52 0 0 1 12.8 20a6.52 6.52 0 0 1-4.843-1.42 6.476 6.476 0 0 1-1.259-1.174c.167-.084.33-.175.489-.27a1 1 0 0 0-1.026-1.711c-1.353.811-2.22 2.219-2.296 3.73a1 1 0 0 0 1.996.096c.005-.125.021-.249.049-.371a1 1 0 0 0 .195-.494c.002-.023.003-.046.004-.069a.999.999 0 0 0-.585-.907 4.522 4.522 0 0 0 .579-.906 4.475 4.475 0 0 0 3.328.975 4.522 4.522 0 0 0 3.328-.975 4.522 4.522 0 0 0 .58.906.999.999 0 0 0-.586.907c0 .023.002.046.004.069a1 1 0 0 0 .196.494c.027.122.043.246.048.371a1 1 0 0 0 1.996-.096c-.075-1.511-.943-2.919-2.296-3.73Z"/><path d="M12 14c-1.657 0-3-1.343-3-3s1.343-3 3-3 3 1.343 3 3-1.343 3-3 3Z"/><path d="M12 2a10 10 0 0 0-10 10c0 1.34.259 2.622.728 3.805a1 1 0 1 0 1.866-.71A8 8 0 1 1 12 18c1.375 0 2.686-.337 3.855-.926a1 1 0 1 0-.91-1.782A6 6 0 1 0 12 4Z"/></svg>
  ),
  Type: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/><path d="M3 7h18"/><path d="M8 11h.01"/><path d="M12 11h.01"/><path d="M16 11h.01"/><path d="M8 15h.01"/><path d="M12 15h.01"/><path d="M16 15h.01"/></svg>
  ),
  ChevronRight: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  )
};

export default function QuizLauncher({ wordCount, setStep, startQuiz }) {
  // 不渲染 Modal 本身 (由 App.js 控制)，只渲染內容卡片
  // 為了配合你提供的 App.js 結構，這裡假設 App.js 已經處理了 fixed inset-0 的遮罩
  // 如果 App.js 沒有處理，請將最外層 div 加上 fixed inset-0 等樣式
  
  return (
    <div className="flex flex-col w-full">
      
      {/* Header Section */}
      <div className="flex flex-col items-center justify-center p-8 pb-6 text-center border-b border-zinc-100 dark:border-[#29382f]">
        <div className="p-3 mb-4 rounded-2xl bg-zinc-100 dark:bg-[#29382f] text-zinc-900 dark:text-white">
          <Icons.Rocket />
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">準備測驗</h2>
        <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full bg-zinc-100 dark:bg-[#29382f] border border-zinc-200 dark:border-[#3d5245]">
          <span className="text-xs font-medium text-zinc-500 dark:text-[#9eb7a8]">
            包含 <span className="text-zinc-900 dark:text-white font-bold mx-0.5">{wordCount}</span> 個單字
          </span>
        </div>
      </div>

      {/* Options List */}
      <div className="p-4 flex flex-col gap-3">
        
        {/* Option 1: Pair Quiz */}
        <button
          onClick={() => startQuiz("pair")}
          className="group relative flex items-center p-4 rounded-2xl border border-zinc-200 dark:border-[#29382f] hover:border-purple-300 dark:hover:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all duration-200 text-left"
        >
          <div className="p-3 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 mr-4 group-hover:scale-110 transition-transform">
            <Icons.Puzzle />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-zinc-900 dark:text-white group-hover:text-purple-700 dark:group-hover:text-purple-300">配對測驗</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">連結單字與定義的直覺練習</p>
          </div>
          <div className="text-zinc-300 dark:text-zinc-600 group-hover:text-purple-400 dark:group-hover:text-purple-500 group-hover:translate-x-1 transition-all">
            <Icons.ChevronRight />
          </div>
        </button>

        {/* Option 2: Text Quiz */}
        <button
          onClick={() => startQuiz("text")}
          className="group relative flex items-center p-4 rounded-2xl border border-zinc-200 dark:border-[#29382f] hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all duration-200 text-left"
        >
          <div className="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 mr-4 group-hover:scale-110 transition-transform">
            <Icons.Type />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-zinc-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300">英翻中拼寫</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">看英文,輸入中文意思</p>
          </div>
          <div className="text-zinc-300 dark:text-zinc-600 group-hover:text-blue-400 dark:group-hover:text-blue-500 group-hover:translate-x-1 transition-all">
            <Icons.ChevronRight />
          </div>
        </button>
      </div>

      {/* Footer / Cancel */}
      <div className="p-4 pt-0">
        <button
          onClick={() => setStep("home")}
          className="w-full py-3 rounded-xl text-zinc-500 dark:text-zinc-400 font-medium hover:bg-zinc-100 dark:hover:bg-[#29382f] transition-colors text-sm"
        >
          暫時不要
        </button>
      </div>
    </div>
  );
}