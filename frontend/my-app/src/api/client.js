// 唯一碰 fetch 的檔案:統一 base URL、token、逾時與錯誤碼。
// 其他 api 模組只透過 apiRequest 呼叫後端,不直接碰 fetch,也不 import supabase。

export const API_BASE_URL = (
  process.env.REACT_APP_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

// 一般請求 15s;fill 與判分要等 Gemini,給 60s
export const DEFAULT_TIMEOUT_MS = 15000;
export const SLOW_TIMEOUT_MS = 60000;

export const ErrorCodes = {
  NETWORK: "NETWORK",
  TIMEOUT: "TIMEOUT",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION: "VALIDATION",
  RATE_LIMIT: "RATE_LIMIT",
  UPSTREAM: "UPSTREAM",
  SERVER: "SERVER",
};

export class ApiError extends Error {
  constructor(code, message, { status = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let accessToken = null;
let unauthorizedHandler = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler || null;
}

export async function apiRequest(
  path,
  { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const options = { method, headers, signal: controller.signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch (error) {
    // 自己 abort 的 → 逾時;其他一律當連線問題(訊息絕不外洩原始 error)
    if (controller.signal.aborted) {
      throw new ApiError(ErrorCodes.TIMEOUT, "請求逾時,請稍後再試");
    }
    throw new ApiError(ErrorCodes.NETWORK, "無法連線到伺服器,請檢查網路後再試");
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  const payload = await response.json().catch(() => null);
  const detail = payload && typeof payload.detail === "string" ? payload.detail : null;
  const status = response.status;

  if (status === 401) {
    if (unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(ErrorCodes.UNAUTHORIZED, "登入已過期,請重新登入", { status });
  }
  if (status === 404) {
    throw new ApiError(ErrorCodes.NOT_FOUND, detail || "找不到資料", { status });
  }
  if (status === 409) {
    // 409 目前只有「資料夾名稱重複」→ 後端 detail 已是中文,直接用;
    // 沒帶 detail 時給通用句,絕不外洩英文
    throw new ApiError(
      ErrorCodes.CONFLICT,
      detail || "已經有同名的資料夾,請換一個名稱",
      { status }
    );
  }
  if (status === 422) {
    // 後端 422 的 msg 是英文,一律換中文
    throw new ApiError(ErrorCodes.VALIDATION, "輸入格式不正確,請確認後再試", { status });
  }
  if (status === 429) {
    throw new ApiError(ErrorCodes.RATE_LIMIT, "操作太頻繁,請稍後再試", {
      status,
      retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
    });
  }
  if (status === 502) {
    // 後端 502 的 detail 已是中文(例如「AI 判分暫時無法使用」)→ 直接用
    throw new ApiError(ErrorCodes.UPSTREAM, detail || "AI 服務暫時無法使用,請稍後再試", {
      status,
    });
  }
  if (status >= 500) {
    // 後端 500 的 detail 是英文(例如 /fill 的 "Failed to ...")→ 絕不外洩
    throw new ApiError(ErrorCodes.SERVER, "伺服器發生錯誤,請稍後再試", { status });
  }
  // 其餘 4xx(400 / 403 / 405 / 411 / 413…)細節也是英文 → 一律中文
  throw new ApiError(ErrorCodes.SERVER, "請求失敗,請稍後再試", { status });
}

function parseRetryAfter(raw) {
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isNaN(seconds) || seconds < 1 ? null : seconds;
}
