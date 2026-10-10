import React from "react";

// 簡單的 SVG 圖標組件
const Icons = {
  Back: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  ),
  Volume: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
  ),
  ChevronDown: ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
  ),
  Check: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  ),
  Prev: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  ),
  Next: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  )
};

// 後端理論上只回陣列,但非陣列值直接 .join 會在 render 期間炸掉整棵樹 → 先防禦
const asList = (value) =>
  Array.isArray(value) ? value : value == null ? [] : [String(value)];

export default function WordDetail({ word, onClose, onPrev, onNext, toggleFamiliar, isFamiliar, isFamiliarPending = false, familiarError = null }) {
  if (!word) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 transition-all">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#122017] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-zinc-200 dark:border-[#29382f]">

        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-[#29382f] bg-white/90 dark:bg-[#122017]/90 z-10 shrink-0">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#29382f] transition-all duration-200 font-medium text-base"
          >
            <Icons.Back />
            <span>返回列表</span>
          </button>
          
          <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Detail View</span>
        </header>

        {/* Main Content: Scrollable */}
        <main className="flex-grow overflow-y-auto px-6 py-6 scroll-smooth">
          
          {/* Hero Section */}
          <div className="flex flex-col gap-4 mb-8">
            <div className="flex flex-wrap items-baseline gap-4">
              <h1 className="text-4xl sm:text-5xl font-extrabold text-zinc-900 dark:text-white tracking-tight leading-tight">
                {word.word}
              </h1>
              <span className="px-2 py-1 rounded-md bg-zinc-100 dark:bg-[#29382f] text-zinc-600 dark:text-[#9eb7a8] text-sm font-semibold italic border border-zinc-200 dark:border-[#3d5245]">
                {word.pos}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-xl text-zinc-500 dark:text-[#9eb7a8] font-serif">
                {word.pronunciation || "/.../"}
              </span>
              {word.pronunciation && (
                <button className="p-2 rounded-full text-zinc-400 hover:text-emerald-600 dark:text-zinc-500 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#29382f] transition-colors">
                  <Icons.Volume />
                </button>
              )}
            </div>
          </div>

          {/* Definition Block */}
          <div className="p-5 rounded-xl bg-zinc-50 dark:bg-[#1a2c23] border border-zinc-100 dark:border-[#29382f] mb-6">
            <h3 className="text-xs font-bold text-zinc-400 dark:text-[#5c7a6b] uppercase tracking-wider mb-2">Definition</h3>
            <p className={`text-lg sm:text-xl leading-relaxed font-medium ${word.definition ? "text-zinc-800 dark:text-zinc-100" : "text-zinc-400 dark:text-zinc-600 italic"}`}>
              {word.definition || "No definition available."}
            </p>
          </div>

          {/* Accordion Sections - 修正邏輯：永遠顯示欄位，無資料時顯示 "—" */}
          <div className="space-y-3">
            {[
              { title: "字源 (Etymology)", content: word.etymology },
              { title: "同義詞 (Synonyms)", content: asList(word.synonyms).join(", ") },
              { title: "反義詞 (Antonyms)", content: asList(word.antonyms).join(", ") },
              { title: "變化 (Word Forms)", content: word.variants },
              { title: "片語 (Phrases)", content: asList(word.phrases).join("; ") },
              { 
                title: "例句 (Sentences)", 
                content: word.toeic, // 直接傳入原始數組
                isList: true 
              },
            ].map((section, idx) => {
              // 檢查是否有內容
              const hasContent = section.isList 
                ? (Array.isArray(section.content) && section.content.length > 0)
                : (section.content && section.content.trim().length > 0);

              return (
                <details 
                  key={idx} 
                  className="group bg-white dark:bg-[#122017] border border-zinc-200 dark:border-[#29382f] rounded-xl overflow-hidden transition-all duration-300 open:shadow-sm"
                  // 如果想預設展開第一個，可以取消下面這行的註解
                  // open={idx === 1} 
                >
                  <summary className="flex cursor-pointer items-center justify-between px-5 py-4 select-none hover:bg-zinc-50 dark:hover:bg-[#1a2c23] transition-colors">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200 text-base">{section.title}</span>
                    <Icons.ChevronDown className="text-zinc-400 dark:text-zinc-500 transition-transform duration-300 ease-in-out group-open:rotate-180" />
                  </summary>
                  
                  <div className="px-5 pb-5 pt-1 text-zinc-600 dark:text-[#9eb7a8] leading-relaxed border-t border-transparent group-open:border-zinc-100 dark:group-open:border-[#29382f]">
                    {hasContent ? (
                      section.isList ? (
                        <ul className="list-disc pl-5 space-y-1">
                          {section.content.map((s, i) => <li key={i} className="mb-2 last:mb-0">{s}</li>)}
                        </ul>
                      ) : (
                        <p>{section.content}</p>
                      )
                    ) : (
                      // 無資料時的顯示狀態
                      <p className="text-zinc-400 dark:text-zinc-600 italic">—</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
          
          <div className="h-4"></div>
        </main>

        {/* 標記熟悉失敗的訊息(per-id,來自 hook) */}
        {familiarError && (
          <p role="alert" className="shrink-0 border-t border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-6 py-2 text-sm font-medium text-red-600 dark:text-red-400">
            {familiarError}
          </p>
        )}

        {/* Footer */}
        <footer className="grid grid-cols-3 gap-4 p-4 border-t border-zinc-100 dark:border-[#29382f] bg-white dark:bg-[#122017] shrink-0">
          <button
            onClick={onPrev}
            className="flex items-center justify-center gap-2 h-14 rounded-xl border border-zinc-200 dark:border-[#29382f] text-zinc-600 dark:text-zinc-300 font-bold hover:bg-zinc-50 dark:hover:bg-[#29382f] active:scale-95 transition-all"
          >
            <Icons.Prev />
            <span className="hidden sm:inline">上一個</span>
          </button>

          <button
            onClick={toggleFamiliar}
            disabled={isFamiliarPending}
            className={`flex flex-col items-center justify-center h-14 rounded-xl shadow-sm active:scale-95 transition-all duration-200 disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100 ${
              isFamiliar
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
                : "bg-zinc-100 dark:bg-[#29382f] text-zinc-400 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-[#3d5245]"
            }`}
          >
             <Icons.Check />
             <span className="text-xs font-bold uppercase mt-1">{isFamiliarPending ? "更新中…" : isFamiliar ? "已熟悉" : "標記熟悉"}</span>
          </button>

          <button
            onClick={onNext}
            className="flex items-center justify-center gap-2 h-14 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-[#122017] font-bold shadow-md hover:opacity-90 active:scale-95 transition-all"
          >
            <span className="hidden sm:inline">下一個</span>
            <Icons.Next />
          </button>
        </footer>
      </div>
    </div>
  );
}