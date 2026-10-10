// 測驗相關端點。
import { apiRequest, SLOW_TIMEOUT_MS } from "./client";

export function submitDefinition(wordId, userInputZh) {
  // AI 判分很慢 → 用加長逾時
  return apiRequest("/tests/submit_definition", {
    method: "POST",
    body: { word_id: wordId, user_input_zh: userInputZh },
    timeoutMs: SLOW_TIMEOUT_MS,
  });
}
