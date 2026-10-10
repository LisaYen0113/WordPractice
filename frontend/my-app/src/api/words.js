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

export function assignFolder(wordId, folderId) {
  // folderId 允許 null(移回未分類)—— 一定要帶這個鍵,後端把「缺欄位」視為 422。
  // `?? null` 不是裝飾:JSON.stringify({folder_id: undefined}) 會把整個鍵丟掉,
  // 呼叫端不小心傳 undefined 時就會變成 422 而不是「移回未分類」。
  return apiRequest(`/words/${wordId}/folder`, {
    method: "PUT",
    body: { folder_id: folderId ?? null },
  });
}
