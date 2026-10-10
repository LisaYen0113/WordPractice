import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { setAccessToken, setUnauthorizedHandler } from "../api/client";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  // 尚未設定 Supabase 時沒東西可等,直接放行
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }
    // API 回 401 → 讓 supabase 清掉 session,畫面會由 onAuthStateChange 接手
    setUnauthorizedHandler(() => {
      if (supabase) {
        supabase.auth.signOut();
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) {
          return;
        }
        // 先放 token、再放行(loading=false),保證登入後第一次 fetch 一定帶 token
        setAccessToken(data?.session?.access_token ?? null);
        setSession(data?.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        // 讀 session 意外失敗也要放行,不然永遠卡在載入畫面
        if (!cancelled) {
          setLoading(false);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) {
        return;
      }
      setAccessToken(nextSession?.access_token ?? null);
      setSession(nextSession ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!supabase) {
      throw new Error("Supabase 尚未設定");
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error; // 原樣往上拋,由 LoginScreen 映射中文
    }
    // 回傳 session:呼叫端(訪客入口)要能確認真的拿到 session,不能只信「沒丟錯」
    return data?.session ?? null;
  }, []);

  const signOut = useCallback(async () => {
    // 先清本地狀態,UI 立刻回登入頁
    setAccessToken(null);
    setSession(null);
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // 伺服器端登出失敗不影響本地已登出
      }
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn,
      signOut,
    }),
    [session, loading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必須在 AuthProvider 內使用");
  }
  return context;
}
