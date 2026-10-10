import { act, render, screen } from "@testing-library/react";

import { setAccessToken, setUnauthorizedHandler } from "../api/client";
import { AuthProvider, useAuth } from "./AuthContext";
import { supabase } from "./supabaseClient";

jest.mock("../api/client", () => ({
  setAccessToken: jest.fn(),
  setUnauthorizedHandler: jest.fn(),
}));

jest.mock("./supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const auth = supabase.auth;

let ctx;
function Probe() {
  ctx = useAuth();
  return (
    <span data-testid="state">
      {ctx.loading ? "loading" : ctx.user ? ctx.user.email : "anon"}
    </span>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

test("有 session:載入中顯示 loading,拿到 session 後先設 token 再放行", async () => {
  auth.getSession.mockResolvedValue({
    data: {
      session: { access_token: "tok-1", user: { email: "user@example.com" } },
    },
  });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  expect(screen.getByTestId("state")).toHaveTextContent("loading");

  await screen.findByText("user@example.com");

  // 使用者可見(loading=false)時,token 一定已經放進 api client
  expect(ctx.loading).toBe(false);
  expect(setAccessToken).toHaveBeenCalledWith("tok-1");
});

test("沒 session:loading 結束、token 清成 null、顯示未登入", async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await screen.findByText("anon");

  expect(setAccessToken).toHaveBeenCalledWith(null);
  expect(ctx.user).toBeNull();
});

test("signIn 成功:轉呼叫 supabase 並回傳 session(呼叫端要能確認真的登入)", async () => {
  const session = { access_token: "tok-3", user: { email: "user@example.com" } };
  auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByText("anon");

  let result;
  await act(async () => {
    result = await ctx.signIn("user@example.com", "secret123");
  });

  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: "user@example.com",
    password: "secret123",
  });
  expect(result).toBe(session);
});

test("signIn 沒丟錯但也沒回 session(極端情況)→ 回 null,呼叫端據此當失敗處理", async () => {
  // beforeEach 的預設 mock 只給 { error: null } → data 是 undefined
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByText("anon");

  let result;
  await act(async () => {
    result = await ctx.signIn("user@example.com", "secret123");
  });

  expect(result).toBeNull();
});

test("signIn 失敗:原樣往上拋,讓 LoginScreen 映射中文", async () => {
  const authError = { message: "Invalid login credentials", status: 400 };
  auth.signInWithPassword.mockResolvedValue({ error: authError });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByText("anon");

  await act(async () => {
    await expect(ctx.signIn("user@example.com", "wrong")).rejects.toBe(authError);
  });
});

test("signOut:呼叫 supabase 並把 token 清掉", async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByText("anon");

  await act(async () => {
    await ctx.signOut();
  });

  expect(auth.signOut).toHaveBeenCalledTimes(1);
  expect(setAccessToken).toHaveBeenLastCalledWith(null);
});

test("401 處理器:註冊出去的 handler 一被呼叫就觸發 supabase 登出", async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByText("anon");

  const handler = setUnauthorizedHandler.mock.calls[0][0];
  expect(typeof handler).toBe("function");

  handler();

  expect(auth.signOut).toHaveBeenCalledTimes(1);
});

test("onAuthStateChange(SIGNED_IN):同步更新 token 與使用者", async () => {
  let listener;
  auth.onAuthStateChange.mockImplementation((callback) => {
    listener = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await screen.findByText("anon");

  act(() => {
    listener("SIGNED_IN", {
      access_token: "tok-2",
      user: { email: "new@example.com" },
    });
  });

  expect(screen.getByTestId("state")).toHaveTextContent("new@example.com");
  expect(setAccessToken).toHaveBeenLastCalledWith("tok-2");
});

test("useAuth 在 AuthProvider 外使用 → 明確丟錯", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});

  function Rogue() {
    useAuth();
    return null;
  }
  expect(() => render(<Rogue />)).toThrow("AuthProvider");

  spy.mockRestore();
});
