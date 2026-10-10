import React from "react";

// 簡單的 SVG 圖標
const Icons = {
  Puzzle: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19.439 15.424a1 1 0 0 0-1.026 1.712c.158.095.322.185.488.27a6.476 6.476 0 0 1-1.258 1.173A6.52 6.52 0 0 1 12.8 20a6.52 6.52 0 0 1-4.843-1.42 6.476 6.476 0 0 1-1.259-1.174c.167-.084.33-.175.489-.27a1 1 0 0 0-1.026-1.711c-1.353.811-2.22 2.219-2.296 3.73a1 1 0 0 0 1.996.096c.005-.125.021-.249.049-.371a1 1 0 0 0 .195-.494c.002-.023.003-.046.004-.069a.999.999 0 0 0-.585-.907 4.522 4.522 0 0 0 .579-.906 4.475 4.475 0 0 0 3.328.975 4.522 4.522 0 0 0 3.328-.975 4.522 4.522 0 0 0 .58.906.999.999 0 0 0-.586.907c0 .023.002.046.004.069a1 1 0 0 0 .196.494c.027.122.043.246.048.371a1 1 0 0 0 1.996-.096c-.075-1.511-.943-2.919-2.296-3.73Z"/><path d="M12 14c-1.657 0-3-1.343-3-3s1.343-3 3-3 3 1.343 3 3-1.343 3-3 3Z"/><path d="M12 2a10 10 0 0 0-10 10c0 1.34.259 2.622.728 3.805a1 1 0 1 0 1.866-.71A8 8 0 1 1 12 18c1.375 0 2.686-.337 3.855-.926a1 1 0 1 0-.91-1.782A6 6 0 1 0 12 4Z"/></svg>
  ),
  Close: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  )
};

export default function PairQuiz({ words, onClose }) {
  const available = words.filter((w) => w.quizEnabled);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-100 dark:bg-[#0d1410] p-4 animate-in fade-in duration-300">
      <div className="relative w-full max-w-lg bg-white dark:bg-[#122017] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200 dark:border-[#29382f]">
        
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-[#29382f]">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
               <Icons.Puzzle />
             </div>
             <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white leading-none">配對挑戰</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-medium">Link the meanings</p>
             </div>
          </div>
          <button 
             onClick={onClose}
             className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-[#29382f] text-zinc-400 dark:text-zinc-500 transition-colors"
          >
             <Icons.Close />
          </button>
        </header>

        {/* Content Body */}
        <div className="p-6 flex flex-col gap-6">
           <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-[#1a2c23] rounded-xl border border-zinc-100 dark:border-[#29382f]">
              <span className="text-sm text-zinc-500 dark:text-[#9eb7a8]">可用單字</span>
              <span className="text-lg font-bold text-zinc-900 dark:text-white font-mono">{available.length}</span>
           </div>

           {/* Placeholder for Game Area */}
           <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-200 dark:border-[#3d5245] rounded-2xl bg-zinc-50/50 dark:bg-[#122017]/50 text-center p-6 gap-3">
              <span className="text-4xl">🧩</span>
              <h3 className="text-zinc-900 dark:text-white font-bold">即將推出</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-[200px]">
                 配對遊戲功能正在開發中，這裡將會出現單字卡片配對介面。
              </p>
           </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0">
          <button
            onClick={onClose}
            className="w-full py-4 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-[#122017] font-bold text-lg hover:opacity-90 active:scale-98 transition-all shadow-lg"
          >
            結束測驗
          </button>
        </div>

      </div>
    </div>
  );
}