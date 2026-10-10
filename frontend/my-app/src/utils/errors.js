// API 錯誤 → 顯示用中文。429 帶著 Retry-After 秒數時講清楚要等多久。
// 原本只有 useReviewWords 內部在用,資料夾也要同一套說法 → 抽出來共用。
export function apiErrorMessage(error, fallback = "操作失敗,請稍後再試") {
  if (error?.code === "RATE_LIMIT" && error.retryAfterSeconds) {
    return `操作太頻繁,請等 ${error.retryAfterSeconds} 秒再試`;
  }
  // 只有 client.js 造出來的 ApiError 帶著字串 code;其他(引擎的 TypeError 等)
  // 的 message 是英文,直接透傳等於把英文外洩到畫面。
  // 既有 4 條測試的錯誤全都帶 code,所以這個收緊不會動到它們。
  return typeof error?.code === "string" && error.message ? error.message : fallback;
}
