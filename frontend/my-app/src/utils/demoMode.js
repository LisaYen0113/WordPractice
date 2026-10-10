// 展示模式的開關狀態。存 sessionStorage:F5 還在、關分頁/登出後自動恢復正常。
// storage 可能在隱私模式被擋 → 一律 try/catch,壞掉時退回「關閉」。

export const DEMO_STORAGE_KEY = "ai-words:demo-mode";

export function readDemoMode() {
  try {
    return window.sessionStorage.getItem(DEMO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDemoMode(on) {
  try {
    if (on) {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(DEMO_STORAGE_KEY);
    }
  } catch {
    // 寫不進去就算了:記憶體裡的狀態照常運作
  }
}

// 訪客展示入口(登入頁「訪客展示」按鈕)用的示範帳號,帳密來自 .env.local。
// 帳密會嵌進前端 bundle — 這是刻意的:示範帳號是公開性質的專用帳號,只放想給別人看的字。
// env 刻意在「函式內」讀:jest(react-scripts)不載入 .env.local,測試才能用 process.env 覆寫。
// env 填了純空白等於沒填;兩支函式共用同一套 email 正規化(trim),行為一致。
function demoEmailFromEnv() {
  const raw = process.env.REACT_APP_DEMO_EMAIL;
  return typeof raw === "string" ? raw.trim() : "";
}

export function demoCredentials() {
  const email = demoEmailFromEnv();
  const password = process.env.REACT_APP_DEMO_PASSWORD;
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

// 這個登入者是不是訪客入口的示範帳號(決定「結束展示」要不要直接登出、交還裝置)
export function isGuestAccount(email) {
  const demoEmail = demoEmailFromEnv();
  if (!demoEmail || !email) {
    return false;
  }
  return String(email).trim().toLowerCase() === demoEmail.toLowerCase();
}

// 訪客入口建立 session 時留下的標記。刻意存「localStorage」:
// 展示旗標存 sessionStorage(每個分頁獨立),訪客開新分頁會讀不到旗標 —
// 但 Supabase session 跨分頁還原,新分頁會以 demo 帳號進「正常模式」。
// 標記跨分頁可靠 → demo 帳號 + 標記 = 一律強制展示模式,新分頁也繞不過。
// 沒標記(例如業主為了管理字庫「直接登入」demo 帳號)→ 正常模式,可新增單字。
export const GUEST_SESSION_KEY = "ai-words:guest-session";

export function readGuestSession() {
  try {
    return window.localStorage.getItem(GUEST_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeGuestSession(on) {
  try {
    if (on) {
      window.localStorage.setItem(GUEST_SESSION_KEY, "1");
    } else {
      window.localStorage.removeItem(GUEST_SESSION_KEY);
    }
  } catch {
    // 寫不進去就算了:當次分頁仍由展示旗標撐著(只是新分頁無法強制)
  }
}
