import {
  API_BASE_URL,
  ApiError,
  ErrorCodes,
  apiRequest,
  setAccessToken,
  setUnauthorizedHandler,
} from "./client";

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => body,
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  setAccessToken(null);
  setUnauthorizedHandler(null);
});

afterEach(() => {
  jest.useRealTimers();
});

test("GET attaches the bearer token and hits the configured base URL", async () => {
  setAccessToken("token-123");
  global.fetch.mockResolvedValue(jsonResponse(200, []));

  await apiRequest("/words/deck");

  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe(`${API_BASE_URL}/words/deck`);
  expect(options.method).toBe("GET");
  expect(options.headers.Authorization).toBe("Bearer token-123");
});

test("no token → no Authorization header (backend answers 401)", async () => {
  global.fetch.mockResolvedValue(jsonResponse(200, []));

  await apiRequest("/words/deck");

  const [, options] = global.fetch.mock.calls[0];
  expect(options.headers.Authorization).toBeUndefined();
});

test("POST sends a JSON body", async () => {
  global.fetch.mockResolvedValue(jsonResponse(200, {}));

  await apiRequest("/words/mark_familiar", {
    method: "POST",
    body: { word_id: "w1", familiar: true },
  });

  const [, options] = global.fetch.mock.calls[0];
  expect(options.method).toBe("POST");
  expect(options.headers["Content-Type"]).toBe("application/json");
  expect(JSON.parse(options.body)).toEqual({ word_id: "w1", familiar: true });
});

test("401 fires the unauthorized handler and throws UNAUTHORIZED", async () => {
  const onUnauthorized = jest.fn();
  setUnauthorizedHandler(onUnauthorized);
  global.fetch.mockResolvedValue(jsonResponse(401, { detail: "Unauthorized" }));

  await expect(apiRequest("/words/deck")).rejects.toMatchObject({
    code: ErrorCodes.UNAUTHORIZED,
    status: 401,
  });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test("404 keeps the backend's Chinese detail", async () => {
  global.fetch.mockResolvedValue(
    jsonResponse(404, { detail: "這個字不在你的單字庫中" })
  );

  await expect(
    apiRequest("/words/mark_familiar", { method: "POST", body: {} })
  ).rejects.toMatchObject({
    code: ErrorCodes.NOT_FOUND,
    message: "這個字不在你的單字庫中",
  });
});

test("404 without a useful detail falls back to a Chinese message", async () => {
  global.fetch.mockResolvedValue(jsonResponse(404, {}));

  const error = await apiRequest("/words/deck").catch((e) => e);
  expect(error.code).toBe(ErrorCodes.NOT_FOUND);
  expect(error.message).not.toContain("undefined");
});

test("429 parses Retry-After into retryAfterSeconds", async () => {
  global.fetch.mockResolvedValue(
    jsonResponse(429, {}, { "Retry-After": "42" })
  );

  await expect(apiRequest("/words/deck")).rejects.toMatchObject({
    code: ErrorCodes.RATE_LIMIT,
    retryAfterSeconds: 42,
  });
});

test("429 without a valid Retry-After → retryAfterSeconds null, no English leak", async () => {
  global.fetch.mockResolvedValue(jsonResponse(429, { detail: "Too many requests" }));

  const error = await apiRequest("/words/deck").catch((e) => e);
  expect(error.code).toBe(ErrorCodes.RATE_LIMIT);
  expect(error.retryAfterSeconds).toBeNull();
  expect(error.message).not.toContain("Too many");
});

test("422 → VALIDATION, backend validation text never surfaces", async () => {
  global.fetch.mockResolvedValue(
    jsonResponse(422, {
      detail: [{ loc: ["body", "word"], msg: "String should match pattern", type: "string_pattern_mismatch" }],
    })
  );

  const error = await apiRequest("/words/fill", { method: "POST", body: {} }).catch((e) => e);
  expect(error.code).toBe(ErrorCodes.VALIDATION);
  expect(error.message).not.toContain("String should match");
});

test("500 never surfaces the backend's English detail", async () => {
  global.fetch.mockResolvedValue(
    jsonResponse(500, { detail: "Failed to update familiarity" })
  );

  const error = await apiRequest("/words/mark_familiar", { method: "POST", body: {} }).catch(
    (e) => e
  );
  expect(error.code).toBe(ErrorCodes.SERVER);
  expect(error.message).not.toContain("Failed");
});

test("502 keeps the backend's Chinese AI message", async () => {
  global.fetch.mockResolvedValue(
    jsonResponse(502, { detail: "AI 判分暫時無法使用,請稍後再試" })
  );

  await expect(
    apiRequest("/tests/submit_definition", { method: "POST", body: {} })
  ).rejects.toMatchObject({
    code: ErrorCodes.UPSTREAM,
    message: "AI 判分暫時無法使用,請稍後再試",
  });
});

test("network failure → NETWORK with a Chinese message", async () => {
  global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));

  const error = await apiRequest("/words/deck").catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.code).toBe(ErrorCodes.NETWORK);
  expect(error.message).toMatch(/連線|網路/);
});

test("hanging request aborts at the default timeout → TIMEOUT", async () => {
  jest.useFakeTimers();
  let aborted = false;
  global.fetch.mockImplementation((url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  });

  const promise = apiRequest("/words/deck");
  const assertion = expect(promise).rejects.toMatchObject({ code: ErrorCodes.TIMEOUT });
  jest.advanceTimersByTime(15000);

  await assertion;
  expect(aborted).toBe(true);
});

test("per-request timeout override keeps slow AI calls alive longer", async () => {
  jest.useFakeTimers();
  global.fetch.mockImplementation((url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  });

  const promise = apiRequest("/words/fill", {
    method: "POST",
    body: { word: "apple" },
    timeoutMs: 60000,
  });
  const assertion = expect(promise).rejects.toMatchObject({ code: ErrorCodes.TIMEOUT });

  let settled = false;
  promise.catch(() => {
    settled = true;
  });

  jest.advanceTimersByTime(15000); // 預設 15s 已過,但這支請求給 60s
  await Promise.resolve();
  expect(settled).toBe(false);

  jest.advanceTimersByTime(45000);
  await assertion;
  expect(settled).toBe(true);
});

// 釘住:409 落進「其餘 4xx」分支 → 被當成 SERVER 且訊息被換成通用中文,
// 使用者就看不到後端給的中文「已經有同名資料夾」。
test("409 保留後端的中文 detail（資料夾名稱重複）", async () => {
  global.fetch.mockResolvedValue(
    jsonResponse(409, { detail: "已經有同名資料夾" })
  );

  await expect(apiRequest("/folders", { method: "POST" })).rejects.toMatchObject({
    code: ErrorCodes.CONFLICT,
    status: 409,
    message: "已經有同名資料夾",
  });
});

// 釘住:沒帶 detail 時訊息會是 undefined,或錯誤碼不是 CONFLICT(呼叫端無法據此做「換個名字」提示)。
test("409 沒有 detail 時給通用中文，不外洩英文", async () => {
  global.fetch.mockResolvedValue(jsonResponse(409, {}));

  const error = await apiRequest("/folders", { method: "POST" }).catch((e) => e);
  expect(error.code).toBe(ErrorCodes.CONFLICT);
  expect(error.message).toBe("已經有同名的資料夾,請換一個名稱");
});
