import React, { useEffect } from "react";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { isSupabaseConfigured } from "./auth/supabaseClient";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginScreen from "./components/LoginScreen";
import SetupNotice from "./components/SetupNotice";
import { FullScreenLoading } from "./components/StateViews";
import { writeDemoMode, writeGuestSession } from "./utils/demoMode";
import WordApp from "./WordApp";

/**
 * 依狀態決定顯示什麼:
 * env 沒填 → 設定提示 / 認證載入中 → 全頁載入 / 未登入 → 登入畫面 / 登入 → 主畫面。
 */
function Gate() {
  const { user, loading } = useAuth();

  // 任何登出(手動按登出,或 401 被動登出)都算交還裝置:展示旗標與訪客標記一起清掉,
  // 下次登入回到正常模式
  useEffect(() => {
    if (!loading && !user) {
      writeDemoMode(false);
      writeGuestSession(false);
    }
  }, [loading, user]);

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading) return <FullScreenLoading />;
  if (!user) return <LoginScreen />;
  return <WordApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Gate />
      </ErrorBoundary>
    </AuthProvider>
  );
}
