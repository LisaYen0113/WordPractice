import React from "react";

/**
 * 測驗總結:答對題數 + 逐題結果 + 結束。
 */
export default function TextQuizSummary({ summary, results, onClose }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <h3 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
          答對 {summary.correct} / {summary.total}
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {summary.correct === summary.total && summary.total > 0
            ? "全部正確,太強了!"
            : "再看一眼沒答對的字,很快就能記住。"}
        </p>
      </div>

      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {results.map((r, i) => (
          <li
            key={`${r.wordId}-${i}`}
            className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-[#29382f] bg-zinc-50 dark:bg-[#1a2c23] px-4 py-2.5"
          >
            <span
              aria-hidden="true"
              className={`text-sm font-bold ${r.correct ? "text-green-500" : "text-red-500"}`}
            >
              {r.correct ? "✓" : "✗"}
            </span>
            <span className="flex-1 truncate font-semibold text-zinc-800 dark:text-zinc-100">
              {r.word}
            </span>
            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
              {r.score == null ? "—" : `${Math.round(r.score * 100)}%`}
            </span>
          </li>
        ))}
      </ul>

      <button
        onClick={onClose}
        className="w-full rounded-xl bg-zinc-900 dark:bg-white py-3.5 text-lg font-bold text-white dark:text-[#122017] shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
      >
        結束測驗
      </button>
    </div>
  );
}
