import React from "react";

/**
 * 判分結果畫面:百分比 + 答對/再想想 + 回饋(展示模式為操作者自評)+ 單字定義,然後下一題。
 */
export default function TextQuizFeedback({ item, result, isLast, onNext, demoMode = false }) {
  const percent = Math.round((result?.score ?? 0) * 100);
  const correct = Boolean(result?.correct);

  return (
    <div className="flex flex-col gap-5">
      {/* 分數與判定 */}
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span
          className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-bold ${
            correct
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          }`}
        >
          {correct ? "答對" : "再想想"}
        </span>
        <p className={`text-5xl font-extrabold tracking-tight ${correct ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
          {percent}%
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          你答的是「{item.word}」
        </p>
      </div>

      {/* AI 回饋 */}
      {result?.feedback && (
        <div className="rounded-2xl border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 px-5 py-4">
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400">
            {demoMode ? "展示模式:自評" : "AI 回饋"}
          </h4>
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">
            {result.feedback}
          </p>
        </div>
      )}

      {/* 你的答案 vs 單字定義(英翻中沒有標準中文答案,標「正解」會誤導) */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-100 dark:border-[#29382f] bg-zinc-50 dark:bg-[#1a2c23] px-5 py-4">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-[#5c7a6b]">
            你的答案
          </h4>
          <p className="font-medium text-zinc-800 dark:text-zinc-100">
            {result?.userInput || "—"}
          </p>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-[#5c7a6b]">
            單字定義
          </h4>
          <p className="font-medium text-zinc-800 dark:text-zinc-100">
            {item.definition || "—"}
          </p>
        </div>
      </div>

      <button
        onClick={onNext}
        className="w-full rounded-xl bg-zinc-900 dark:bg-white py-3.5 text-lg font-bold text-white dark:text-[#122017] shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
      >
        {isLast ? "看總結" : "下一題"}
      </button>
    </div>
  );
}
