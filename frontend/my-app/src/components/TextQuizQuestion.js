import React from "react";

/**
 * 答題畫面:大字英文 + KK + 詞性 + 中文輸入框。
 * 用 <input>(不是 textarea)— 後端禁止換行,輸入框也別讓使用者打出換行。
 */
export default function TextQuizQuestion({
  item,
  index,
  total,
  value,
  onChange,
  onSubmit,
  pending,
  error,
  gradeError,
  onRetry,
  onSkip,
  canRetry = true,
}) {
  const handleSubmit = (e) => {
    e.preventDefault();
    // IME 選字中的 Enter 不該送判分(輸入值還沒定)
    if (e.nativeEvent?.isComposing) return;
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* 進度 */}
      <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>
          第 {index + 1} / {total} 題
        </span>
        <span className="font-mono">{value.length}/200</span>
      </div>

      {/* 題目 */}
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-100 dark:border-[#29382f] bg-zinc-50 dark:bg-[#1a2c23] px-6 py-8 text-center">
        <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white break-all">
          {item.word}
        </h3>
        <div className="flex items-center gap-3">
          {item.pronunciation && (
            <span className="font-serif text-lg text-zinc-500 dark:text-[#9eb7a8]">
              {item.pronunciation}
            </span>
          )}
          {item.pos && (
            <span className="rounded-md border border-zinc-200 dark:border-[#3d5245] bg-zinc-100 dark:bg-[#29382f] px-2 py-0.5 text-xs font-semibold italic text-zinc-600 dark:text-[#9eb7a8]">
              {item.pos}
            </span>
          )}
        </div>
      </div>

      {/* 作答 */}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending || Boolean(gradeError)}
        maxLength={200}
        autoFocus
        placeholder="輸入中文意思…"
        className="w-full rounded-xl border border-zinc-300 dark:border-[#3d5245] bg-white dark:bg-[#1a2c23] px-4 py-3 text-lg font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-400 disabled:opacity-60"
      />

      {error && (
        <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {gradeError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
            {gradeError}
          </p>
          <div className="flex gap-3">
            {canRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={pending}
                className="flex-1 rounded-xl bg-zinc-900 dark:bg-white py-3 font-bold text-white dark:text-[#122017] shadow-md transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                重試
              </button>
            )}
            <button
              type="button"
              onClick={onSkip}
              disabled={pending}
              className="flex-1 rounded-xl border border-zinc-200 dark:border-[#29382f] py-3 font-bold text-zinc-600 dark:text-zinc-300 transition-all hover:bg-zinc-50 dark:hover:bg-[#29382f] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              跳過本題
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="w-full rounded-xl bg-zinc-900 dark:bg-white py-3.5 text-lg font-bold text-white dark:text-[#122017] shadow-lg transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "判分中…" : "送出"}
        </button>
      )}
    </form>
  );
}
