import { apiErrorMessage } from "./errors";

test("429 帶著 Retry-After 時把等待秒數講出來", () => {
  // 釘住:429 帶了秒數就要講明等多久,退回原始訊息使用者只會一直重按
  expect(
    apiErrorMessage({ code: "RATE_LIMIT", message: "操作太頻繁,請稍後再試", retryAfterSeconds: 30 })
  ).toBe("操作太頻繁,請等 30 秒再試");
});

test("429 沒帶秒數時用原始訊息", () => {
  // 釘住:沒帶秒數時不能拼出「請等 undefined 秒再試」,要退回後端原本的訊息
  expect(apiErrorMessage({ code: "RATE_LIMIT", message: "操作太頻繁,請稍後再試" })).toBe(
    "操作太頻繁,請稍後再試"
  );
});

test("一般錯誤用 error.message", () => {
  // 釘住:非 429 的錯誤要透傳後端訊息(如同名衝突),被 fallback 蓋掉就看不出真正原因
  expect(apiErrorMessage({ code: "CONFLICT", message: "已經有同名資料夾" })).toBe(
    "已經有同名資料夾"
  );
});

test("沒有訊息時用 fallback", () => {
  // 釘住:error 是 null 時不能爆,而且呼叫端自訂的 fallback 要蓋得過預設值
  expect(apiErrorMessage(null)).toBe("操作失敗,請稍後再試");
  expect(apiErrorMessage(null, "建立失敗,請稍後再試")).toBe("建立失敗,請稍後再試");
});

test("非 ApiError(引擎丟的 TypeError 等)不得把英文外洩給使用者", () => {
  // 釘住:200 但 body 不是 JSON 時 client.js 回 null → 呼叫端 .map 丟 TypeError。
  // 只有帶 code 的 ApiError 才准透傳 message,其餘一律中文 fallback。
  expect(
    apiErrorMessage(new TypeError("Cannot read properties of null (reading 'map')"))
  ).toBe("操作失敗,請稍後再試");
  expect(apiErrorMessage(new TypeError("boom"), "載入資料夾失敗,請稍後再試")).toBe(
    "載入資料夾失敗,請稍後再試"
  );
});
