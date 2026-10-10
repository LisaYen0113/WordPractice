import React from "react";

// 簡單的 SVG 圖標
const Icons = {
  CheckCircle: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-500 dark:text-green-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  ),
  ChevronRight: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  )
};

export default function WordRow({ w, onClick, toggleQuiz }) {
  // 處理點擊開關，阻止冒泡以免打開詳情
  const handleToggle = (e) => {
    e.stopPropagation();
    toggleQuiz(w.id);
  };

  const isFamiliar = w.familiarCount > 0;

  return (
    <div
      onClick={() => onClick(w)}
      className="group relative flex items-center justify-between p-4 bg-white dark:bg-[#122017] border border-zinc-200 dark:border-[#29382f] rounded-xl shadow-sm hover:shadow-md hover:border-zinc-300 dark:hover:border-[#3d5245] transition-all duration-200 cursor-pointer hover:-translate-y-0.5"
    >
      {/* 左側：單字資訊 */}
      <div className="flex flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white truncate">
            {w.word}
          </h3>
          
          {/* 詞性標籤 */}
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 italic bg-zinc-100 dark:bg-[#29382f] px-1.5 py-0.5 rounded">
            {w.pos || "?"}
          </span>

          {/* 熟悉度標示 (已熟悉顯示綠勾) */}
          {isFamiliar && (
            <div title="已熟悉" className="ml-1 animate-in fade-in zoom-in duration-300">
               <Icons.CheckCircle />
            </div>
          )}
        </div>

        {/* 定義 (單行省略) */}
        <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate max-w-[200px] sm:max-w-[300px]">
          {w.definition || "No definition..."}
        </p>
      </div>

      {/* 右側：測驗開關 & 箭頭 */}
      <div className="flex items-center gap-3 sm:gap-4 pl-4 shrink-0">
        
        {/* Toggle Switch for Quiz */}
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 dark:focus:ring-offset-[#122017] ${
            w.quizEnabled ? 'bg-zinc-900 dark:bg-green-600' : 'bg-zinc-200 dark:bg-[#29382f]'
          }`}
          title={w.quizEnabled ? "測驗已開啟" : "測驗已關閉"}
        >
          <span className="sr-only">Enable quiz</span>
          <span
            className={`${
              w.quizEnabled ? 'translate-x-6' : 'translate-x-1'
            } inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200`}
          />
        </button>

        {/* 箭頭 (僅裝飾，暗示可點擊進入) */}
        <div className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 dark:group-hover:text-zinc-400 transition-colors">
          <Icons.ChevronRight />
        </div>
      </div>
    </div>
  );
}