/**
 * env 沒填時顯示的設定提示(紅色錯誤頁,取代白屏)。
 */
export default function SetupNotice() {
  const codeClass = "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">還差一步:設定 Supabase 連線</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          前端需要 Supabase 的 Project URL 與 anon / publishable key 才能登入。請開啟
          frontend/my-app 底下的 <code className={codeClass}>.env.local</code>
          ,填入這兩個變數:
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-700">
          <li>
            <code className={codeClass}>REACT_APP_SUPABASE_URL</code>
            <span className="ml-2">— Supabase 專案的 Project URL</span>
          </li>
          <li>
            <code className={codeClass}>REACT_APP_SUPABASE_ANON_KEY</code>
            <span className="ml-2">— anon / publishable key(不是 service key)</span>
          </li>
        </ul>
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          填完存檔後,請重啟前端 dev server — 環境變數只在啟動時注入,熱更新不會生效。
        </p>
      </div>
    </div>
  );
}
