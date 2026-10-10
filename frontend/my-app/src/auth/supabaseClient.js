import { createClient } from "@supabase/supabase-js";

// 全 App 唯一 import supabase-js 的地方。
// 環境變數是編譯期注入:改 .env.local 之後必須重啟 dev server。
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// env 缺 → 保持 null,import 時「絕不」丟錯(丟錯會讓整個 App 白屏,
// 使用者連要填什麼 env 的提示都看不到)。
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
