import React, { useEffect, useState } from "react";

import { validateEnglishWord } from "../utils/validation";

// 簡單的 SVG 圖標
const Icons = {
  Plus: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  )
};

// 錯誤 → 顯示文字(429 帶秒數;其餘用 ApiError 的中文訊息)
export function addWordErrorMessage(error) {
  if (error?.code === "RATE_LIMIT" && error.retryAfterSeconds) {
    return `查詢太頻繁,請等 ${error.retryAfterSeconds} 秒再試`;
  }
  return error?.message || "加入失敗,請稍後再試";
}

export default function AddWord({ onAdd, demoMode = false }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // 進到展示模式就把殘留的錯誤清掉;離開時才不會冒出上一輪的過期錯誤
  useEffect(() => {
    if (demoMode) setError(null);
  }, [demoMode]);

  // 展示模式:整個輸入區停用(新增單字要呼叫 AI 生成)
  const blocked = pending || demoMode;

  const handleSubmit = async () => {
    if (blocked) return;

    // 前端先擋:中文/符號/超長在這裡就攔下,不打 422,也不觸發 AI 呼叫
    const check = validateEnglishWord(text);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onAdd(check.value);
      setText(""); // 只有成功才清空
    } catch (err) {
      setError(addWordErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const handleKeyDown = (e) => {
    // 中文 IME 選字按 Enter 也會觸發 keydown → 別把未完成的輸入送出去
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      handleSubmit();
    }
  };

  return (
    <div className="relative group w-full">
      {/* 裝飾用的背景光暈 */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-200 to-zinc-100 dark:from-[#29382f] dark:to-[#1a2c23] rounded-2xl opacity-50 blur transition duration-200 group-hover:opacity-100"></div>

      <div className="relative flex gap-2 p-2 bg-white dark:bg-[#122017] rounded-2xl border border-zinc-200 dark:border-[#29382f] shadow-sm">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          disabled={blocked}
          placeholder={demoMode ? "展示模式:新增單字已停用" : "輸入新單字..."}
          className="flex-1 bg-transparent border-none outline-none px-4 py-2 text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 font-medium disabled:opacity-60"
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || blocked}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-[#122017] font-bold shadow-md hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all duration-200"
        >
          <Icons.Plus />
          {pending ? (
            <span>生成中…</span>
          ) : (
            <span className="hidden sm:inline">加入</span>
          )}
        </button>
      </div>

      {!demoMode && error && (
        <p role="alert" className="relative mt-2 px-2 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {demoMode && (
        <p className="relative mt-2 px-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          展示模式不開放新增單字(AI 生成已停用)
        </p>
      )}
    </div>
  );
}
