const FALLBACK_MESSAGE = "登入失敗,請稍後再試";

/**
 * Supabase Auth 的英文錯誤 → 中文訊息。
 * 只認幾個常見狀況,其餘一律通用訊息(不把英文原文漏給使用者)。
 */
export function loginErrorMessage(error) {
  const message = error?.message ?? "";
  const name = error?.name ?? "";

  if (message.includes("Invalid login credentials")) {
    return "Email 或密碼錯誤";
  }
  if (message.includes("Email not confirmed")) {
    return "這個 Email 還沒驗證,請先到信箱點驗證信";
  }
  if (name === "AuthRetryableFetchError" || message.includes("Failed to fetch")) {
    return "無法連線到登入服務,請檢查網路";
  }
  if (message.toLowerCase().includes("rate limit")) {
    return "嘗試次數太多,請稍後再試";
  }
  return FALLBACK_MESSAGE;
}
