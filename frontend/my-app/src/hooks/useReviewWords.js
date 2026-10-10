import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cardToWord } from "../api/mappers";
import { fetchDeck, markFamiliar } from "../api/words";

/**
 * 單字清單資料層:
 * - 初次 mount 抓 GET /words/deck(呼叫者全部的字)
 * - 舊請求晚回來時丟棄(React 19 StrictMode 會雙跑 effect,也用同一機制防護)
 * - 「標記熟悉」以伺服器回傳值為準,不做樂觀猜測;失敗保留舊值 + per-id 錯誤
 */
export function familiarityErrorMessage(error) {
  if (error?.code === "RATE_LIMIT" && error.retryAfterSeconds) {
    return `操作太頻繁,請等 ${error.retryAfterSeconds} 秒再試`;
  }
  return error?.message || "更新失敗,請稍後再試";
}

export default function useReviewWords() {
  const [status, setStatus] = useState("loading");
  const [words, setWords] = useState([]);
  const [error, setError] = useState(null);
  const [familiarPending, setFamiliarPending] = useState({});
  const [familiarErrors, setFamiliarErrors] = useState({});

  // 遞增序號:只有「最後一次」發出的請求的回應會被採用
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setStatus("loading");
    setError(null);
    try {
      const cards = await fetchDeck();
      if (requestIdRef.current !== requestId) {
        return;
      }
      setWords(cards.map(cardToWord));
      setStatus("ready");
    } catch (err) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setError(err?.message || "載入單字失敗,請稍後再試");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      // 作廢所有進行中的請求(unmount 或 StrictMode 的第一次 effect)
      requestIdRef.current += 1;
    };
  }, [load]);

  const upsertWord = useCallback((word) => {
    setWords((prev) => [word, ...prev.filter((existing) => existing.id !== word.id)]);
  }, []);

  const toggleQuiz = useCallback((wordId) => {
    setWords((prev) =>
      prev.map((word) =>
        word.id === wordId ? { ...word, quizEnabled: !word.quizEnabled } : word
      )
    );
  }, []);

  const setFamiliarity = useCallback(async (wordId, familiar) => {
    setFamiliarPending((prev) => ({ ...prev, [wordId]: true }));
    setFamiliarErrors((prev) => {
      if (!(wordId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[wordId];
      return next;
    });
    try {
      const result = await markFamiliar(wordId, familiar);
      setWords((prev) =>
        prev.map((word) =>
          word.id === wordId
            ? {
                ...word,
                familiarCount: result.familiarity_score,
                isFamiliar: result.familiarity_score > 0,
              }
            : word
        )
      );
    } catch (err) {
      setFamiliarErrors((prev) => ({
        ...prev,
        [wordId]: familiarityErrorMessage(err),
      }));
    } finally {
      setFamiliarPending((prev) => {
        const next = { ...prev };
        delete next[wordId];
        return next;
      });
    }
  }, []);

  return useMemo(
    () => ({
      status,
      words,
      error,
      reload: load,
      upsertWord,
      toggleQuiz,
      setFamiliarity,
      familiarPending,
      familiarErrors,
    }),
    [
      status,
      words,
      error,
      load,
      upsertWord,
      toggleQuiz,
      setFamiliarity,
      familiarPending,
      familiarErrors,
    ]
  );
}
