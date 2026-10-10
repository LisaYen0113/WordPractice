// 單字相關端點。純薄包裝,錯誤處理全交給 client。
import { apiRequest, SLOW_TIMEOUT_MS } from "./client";

export function fetchDeck() {
  return apiRequest("/words/deck");
}

export function fillWord(word) {
  // Gemini 生成單字卡很慢 → 用加長逾時
  return apiRequest("/words/fill", {
    method: "POST",
    body: { word },
    timeoutMs: SLOW_TIMEOUT_MS,
  });
}

export function markFamiliar(wordId, familiar) {
  return apiRequest("/words/mark_familiar", {
    method: "POST",
    body: { word_id: wordId, familiar },
  });
}
