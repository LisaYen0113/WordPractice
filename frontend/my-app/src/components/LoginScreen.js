import { useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { loginErrorMessage } from "../auth/loginErrors";
import { demoCredentials, writeDemoMode, writeGuestSession } from "../utils/demoMode";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-50";

export default function LoginScreen() {
  const { signIn } = useAuth();
  // env 有設示範帳號才顯示訪客入口;沒設 → null → 按鈕不渲染
  const guestCredentials = demoCredentials();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [guestPending, setGuestPending] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = email.trim() !== "" && password !== "" && !pending && !guestPending;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      // 成功後 AuthProvider 換掉整個畫面,本元件直接卸載,不用收尾
    } catch (err) {
      setError(loginErrorMessage(err));
      setPending(false);
    }
  }

  // 訪客展示(免登入):自動登入示範帳號。先寫展示旗標/訪客標記再登入 —
  // 登入成功瞬間畫面就切到 WordApp,它掛載時要已經讀得到(旗標讓本分頁進展示、
  // 標記讓 demo 帳號之後開的新分頁也強制展示)
  async function handleGuest() {
    if (!guestCredentials || pending || guestPending) {
      return;
    }
    setGuestPending(true);
    setError(null);
    writeDemoMode(true);
    writeGuestSession(true);
    try {
      const session = await signIn(guestCredentials.email, guestCredentials.password);
      if (!session) {
        // 沒拋錯但也沒拿到 session(極端情況)→ 當失敗,不然會卡在「進入展示中…」
        throw new Error("示範帳號登入沒有回傳 session");
      }
    } catch (err) {
      // 失敗要回滾,不然下一次正常登入會莫名進展示模式
      writeDemoMode(false);
      writeGuestSession(false);
      console.error("訪客展示登入失敗:", err);
      setError("訪客展示暫時無法使用(示範帳號登入失敗)");
      setGuestPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">單字卡</h1>
        <p className="mt-1 text-sm text-slate-500">登入後開始你的英文單字複習</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending || guestPending}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
              密碼
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending || guestPending}
              className={inputClass}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {pending ? "登入中…" : "登入"}
          </button>
        </form>

        {/* 訪客入口:自動登入示範帳號 + 展示模式(AI 全關),給沒有帳號的人看 */}
        {guestCredentials && (
          <button
            type="button"
            onClick={handleGuest}
            disabled={pending || guestPending}
            className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            {guestPending ? "進入展示中…" : "訪客展示(免登入)"}
          </button>
        )}
      </div>
    </div>
  );
}
