import {
  DEMO_STORAGE_KEY,
  GUEST_SESSION_KEY,
  demoCredentials,
  isGuestAccount,
  readDemoMode,
  readGuestSession,
  writeDemoMode,
  writeGuestSession,
} from "./demoMode";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

test("預設:沒存過 → false", () => {
  expect(readDemoMode()).toBe(false);
});

test("開啟 → 寫入並讀回 true;關閉 → 清除", () => {
  writeDemoMode(true);
  expect(window.sessionStorage.getItem(DEMO_STORAGE_KEY)).toBe("1");
  expect(readDemoMode()).toBe(true);

  writeDemoMode(false);
  expect(readDemoMode()).toBe(false);
});

test("storage 壞掉(隱私模式等):讀取回 false、寫入不丟錯", () => {
  const getSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    expect(readDemoMode()).toBe(false);
  } finally {
    getSpy.mockRestore();
  }

  const setSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    expect(() => writeDemoMode(true)).not.toThrow();
  } finally {
    setSpy.mockRestore();
  }
});

// jest(react-scripts)不載入 .env.local → 這裡自己控制 process.env,測完還原
const ENV_EMAIL = process.env.REACT_APP_DEMO_EMAIL;
const ENV_PASSWORD = process.env.REACT_APP_DEMO_PASSWORD;

afterAll(() => {
  if (ENV_EMAIL === undefined) delete process.env.REACT_APP_DEMO_EMAIL;
  else process.env.REACT_APP_DEMO_EMAIL = ENV_EMAIL;
  if (ENV_PASSWORD === undefined) delete process.env.REACT_APP_DEMO_PASSWORD;
  else process.env.REACT_APP_DEMO_PASSWORD = ENV_PASSWORD;
});

describe("demoCredentials(訪客展示入口)", () => {
  afterEach(() => {
    delete process.env.REACT_APP_DEMO_EMAIL;
    delete process.env.REACT_APP_DEMO_PASSWORD;
  });

  test("email 與密碼都有 → 回 { email, password }", () => {
    process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
    process.env.REACT_APP_DEMO_PASSWORD = "guest-pass";
    expect(demoCredentials()).toEqual({ email: "demo@example.com", password: "guest-pass" });
  });

  test("缺任一個(含空字串)→ null(入口按鈕不顯示)", () => {
    expect(demoCredentials()).toBeNull();

    process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
    expect(demoCredentials()).toBeNull();

    process.env.REACT_APP_DEMO_PASSWORD = "";
    expect(demoCredentials()).toBeNull();
  });

  test("env email 前後有空白 → trim 後才回傳/比對(兩支函式同一套正規化)", () => {
    process.env.REACT_APP_DEMO_EMAIL = "  demo@example.com  ";
    process.env.REACT_APP_DEMO_PASSWORD = "guest-pass";

    expect(demoCredentials()).toEqual({ email: "demo@example.com", password: "guest-pass" });
    expect(isGuestAccount("demo@example.com")).toBe(true);
  });

  test("env email 只有空白(填了等於沒填)→ 當成沒設定", () => {
    process.env.REACT_APP_DEMO_EMAIL = "   ";
    process.env.REACT_APP_DEMO_PASSWORD = "guest-pass";

    expect(demoCredentials()).toBeNull();
    expect(isGuestAccount("demo@example.com")).toBe(false);
  });
});

describe("isGuestAccount", () => {
  afterEach(() => {
    delete process.env.REACT_APP_DEMO_EMAIL;
  });

  test("與示範帳號相同(忽略大小寫/前後空白)→ true", () => {
    process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
    expect(isGuestAccount("demo@example.com")).toBe(true);
    expect(isGuestAccount("  DEMO@Example.com ")).toBe(true);
  });

  test("不同帳號、沒傳 email、沒設 env → false", () => {
    process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
    expect(isGuestAccount("me@example.com")).toBe(false);
    expect(isGuestAccount(null)).toBe(false);
    expect(isGuestAccount("")).toBe(false);

    delete process.env.REACT_APP_DEMO_EMAIL;
    expect(isGuestAccount("demo@example.com")).toBe(false);
  });
});

describe("訪客 session 標記(訪客入口建立,存 localStorage → 跨分頁)", () => {
  test("預設 false;開啟後讀得到並留在 localStorage;關閉清除", () => {
    expect(readGuestSession()).toBe(false);

    writeGuestSession(true);
    expect(window.localStorage.getItem(GUEST_SESSION_KEY)).toBe("1");
    expect(readGuestSession()).toBe(true);

    writeGuestSession(false);
    expect(readGuestSession()).toBe(false);
  });

  test("storage 壞掉:讀取回 false、寫入不丟錯", () => {
    const getSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(readGuestSession()).toBe(false);
    } finally {
      getSpy.mockRestore();
    }

    const setSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(() => writeGuestSession(true)).not.toThrow();
    } finally {
      setSpy.mockRestore();
    }
  });
});
