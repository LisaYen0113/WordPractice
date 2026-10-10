import { loginErrorMessage } from "./loginErrors";

test.each([
  [{ message: "Invalid login credentials" }, "Email 或密碼錯誤"],
  [{ message: "Email not confirmed" }, "這個 Email 還沒驗證,請先到信箱點驗證信"],
  [
    { message: "Failed to fetch", name: "AuthRetryableFetchError" },
    "無法連線到登入服務,請檢查網路",
  ],
  [{ message: "Email rate limit exceeded" }, "嘗試次數太多,請稍後再試"],
  [{ message: "Something nobody has seen before" }, "登入失敗,請稍後再試"],
])("對應 %#: %j → 中文訊息", (error, expected) => {
  expect(loginErrorMessage(error)).toBe(expected);
});

test("null / undefined → 通用訊息,不丟錯", () => {
  expect(loginErrorMessage(null)).toBe("登入失敗,請稍後再試");
  expect(loginErrorMessage(undefined)).toBe("登入失敗,請稍後再試");
});
