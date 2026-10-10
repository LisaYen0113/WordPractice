import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { readDemoMode, readGuestSession } from "../utils/demoMode";
import LoginScreen from "./LoginScreen";

const mockSignIn = jest.fn();

jest.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

// jest(react-scripts)不載入 .env.local → 這裡自己控制 process.env,測完還原
const ENV_EMAIL = process.env.REACT_APP_DEMO_EMAIL;
const ENV_PASSWORD = process.env.REACT_APP_DEMO_PASSWORD;

beforeEach(() => {
  mockSignIn.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  // 預設:訪客入口已設定(env 兩欄都有值)
  process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
  process.env.REACT_APP_DEMO_PASSWORD = "guest-pass";
});

afterEach(() => {
  // 測試內用來靜音 console.error 的 spy 一律還原
  jest.restoreAllMocks();
});

afterAll(() => {
  if (ENV_EMAIL === undefined) delete process.env.REACT_APP_DEMO_EMAIL;
  else process.env.REACT_APP_DEMO_EMAIL = ENV_EMAIL;
  if (ENV_PASSWORD === undefined) delete process.env.REACT_APP_DEMO_PASSWORD;
  else process.env.REACT_APP_DEMO_PASSWORD = ENV_PASSWORD;
});

function typeCredentials({ email = "user@example.com", password = "secret123" } = {}) {
  act(() => {
    userEvent.type(screen.getByLabelText("Email"), email);
    userEvent.type(screen.getByLabelText("密碼"), password);
  });
}

test("兩個欄位都填了才能按下登入", () => {
  render(<LoginScreen />);
  const button = screen.getByRole("button", { name: "登入" });
  expect(button).toBeDisabled();

  act(() => {
    userEvent.type(screen.getByLabelText("Email"), "user@example.com");
  });
  expect(button).toBeDisabled();

  act(() => {
    userEvent.type(screen.getByLabelText("密碼"), "secret123");
  });
  expect(button).toBeEnabled();
});

test("送出:signIn 收到去空白的 email;送出期間按鈕變「登入中…」並停用", async () => {
  let resolveSignIn;
  mockSignIn.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSignIn = resolve;
      })
  );
  render(<LoginScreen />);
  typeCredentials({ email: "  user@example.com  " });

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "登入" }));
  });

  expect(mockSignIn).toHaveBeenCalledWith("user@example.com", "secret123");
  expect(screen.getByRole("button", { name: "登入中…" })).toBeDisabled();

  await act(async () => {
    resolveSignIn();
  });
});

test("帳密錯誤 → 中文錯誤訊息、按鈕恢復可用、密碼不被清掉", async () => {
  mockSignIn.mockRejectedValue({ message: "Invalid login credentials" });
  render(<LoginScreen />);
  typeCredentials();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "登入" }));
  });

  expect(screen.getByText("Email 或密碼錯誤")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登入" })).toBeEnabled();
  expect(screen.getByLabelText("密碼")).toHaveValue("secret123");
});

test("在密碼欄按 Enter 直接送出", async () => {
  mockSignIn.mockResolvedValue(undefined);
  render(<LoginScreen />);

  act(() => {
    userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    userEvent.type(screen.getByLabelText("密碼"), "secret123{enter}");
  });

  expect(mockSignIn).toHaveBeenCalledWith("user@example.com", "secret123");
});

// ---------- 訪客展示入口(免登入)----------
const GUEST_BUTTON = "訪客展示(免登入)";

test("env 沒設示範帳號 → 不顯示訪客按鈕", () => {
  delete process.env.REACT_APP_DEMO_EMAIL;
  delete process.env.REACT_APP_DEMO_PASSWORD;

  render(<LoginScreen />);

  expect(screen.queryByRole("button", { name: GUEST_BUTTON })).not.toBeInTheDocument();
});

test("訪客按鈕:登入「之前」展示旗標與訪客標記已寫好;期間變「進入展示中…」、輸入框停用", async () => {
  let resolveSignIn;
  let flagAtSignIn = null;
  let markerAtSignIn = null;
  mockSignIn.mockImplementation(() => {
    // 模擬 WordApp 掛載瞬間:signIn 還在等,但旗標/標記必須已經在 storage 裡
    flagAtSignIn = readDemoMode();
    markerAtSignIn = readGuestSession();
    return new Promise((resolve) => {
      resolveSignIn = resolve;
    });
  });
  render(<LoginScreen />);

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: GUEST_BUTTON }));
  });

  expect(mockSignIn).toHaveBeenCalledWith("demo@example.com", "guest-pass");
  expect(flagAtSignIn).toBe(true);
  expect(markerAtSignIn).toBe(true);
  expect(readDemoMode()).toBe(true);
  expect(readGuestSession()).toBe(true);
  expect(screen.getByRole("button", { name: "進入展示中…" })).toBeDisabled();
  expect(screen.getByLabelText("Email")).toBeDisabled();

  await act(async () => {
    resolveSignIn({ access_token: "tok" }); // 真的拿到 session
  });
  // 成功後旗標與標記都留著,交給 WordApp 進展示模式
  expect(readDemoMode()).toBe(true);
  expect(readGuestSession()).toBe(true);
});

test("示範帳號登入失敗 → 回滾旗標與標記 + 訪客錯誤訊息 + 按鈕與輸入框恢復可用", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockSignIn.mockRejectedValue({ message: "Invalid login credentials" });
  render(<LoginScreen />);

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: GUEST_BUTTON }));
  });

  expect(readDemoMode()).toBe(false);
  expect(readGuestSession()).toBe(false);
  expect(screen.getByText(/訪客展示暫時無法使用/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: GUEST_BUTTON })).toBeEnabled();
  expect(screen.getByLabelText("Email")).toBeEnabled();
});

test("示範帳號沒拋錯但也沒回 session → 當失敗處理,不卡在「進入展示中…」", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockSignIn.mockResolvedValue(null);
  render(<LoginScreen />);

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: GUEST_BUTTON }));
  });

  expect(readDemoMode()).toBe(false);
  expect(readGuestSession()).toBe(false);
  expect(screen.getByText(/訪客展示暫時無法使用/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: GUEST_BUTTON })).toBeEnabled();
});
