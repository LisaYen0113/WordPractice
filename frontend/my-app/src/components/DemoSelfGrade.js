import React from "react";

/**
 * 展示模式的自評畫面:不判分(資料庫的定義是英文,本機比對判不了中文答案),
 * 直接把定義公開,由操作的人自己按「答對了 / 再想想」,分數照常累計。
 */
export default function DemoSelfGrade({ item, answer, onChoose }) {
  return (
    <div className="flex flex-col gap-5">
      {/* 提示 */}
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="inline-flex items-center rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          展示模式:自評
        </span>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          你答的是「{item.word}」— 對照下面的單字定義,自己判定對不對
        </p>
      </div>

      {/* 你的答案 vs 單字定義 */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-100 dark:border-[#29382f] bg-zinc-50 dark:bg-[#1a2c23] px-5 py-4">
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-[#5c7a6b]">
            你的答案
          </h4>
          <p className="font-medium text-zinc-800 dark:text-zinc-100">
            {answer || "—"}
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

      {/* 自評按鈕 */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onChoose(true)}
          className="flex-1 rounded-xl bg-zinc-900 dark:bg-white py-3.5 text-lg font-bold text-white dark:text-[#122017] shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
        >
          答對了
        </button>
        <button
          type="button"
          onClick={() => onChoose(false)}
          className="flex-1 rounded-xl border border-amber-300 py-3.5 text-lg font-bold text-amber-700 transition-all hover:bg-amber-50 active:scale-[0.98] dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-900/20"
        >
          再想想
        </button>
      </div>
    </div>
  );
}
