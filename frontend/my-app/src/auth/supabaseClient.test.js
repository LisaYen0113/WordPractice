// 注意:CRA 在 test 模式「不會」載入 .env.local,所以測試裡的 env 一律自己設。
// CRA 的 jest 設了 resetMocks:true → 每個 test 前實作都會被清掉,
// 所以 mock 的實作一定要放 beforeEach,不能寫在 jest.fn(...) 的宣告裡。
const mockCreateClient = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: (...args) => mockCreateClient(...args),
}));

describe("supabaseClient", () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateClient.mockImplementation(() => ({ auth: {} }));
  });

  afterEach(() => {
    delete process.env.REACT_APP_SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_ANON_KEY;
  });

  test("沒有 env → supabase 是 null、import 不丟錯(避免開場白屏)", () => {
    const mod = require("./supabaseClient");

    expect(mod.isSupabaseConfigured).toBe(false);
    expect(mod.supabase).toBeNull();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  test("只填了 URL、沒填 key → 一樣視為未設定", () => {
    process.env.REACT_APP_SUPABASE_URL = "https://example.supabase.co";

    const mod = require("./supabaseClient");

    expect(mod.isSupabaseConfigured).toBe(false);
    expect(mod.supabase).toBeNull();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  test("env 齊全 → 建立 client,並開啟 session 持久化與自動續期", () => {
    process.env.REACT_APP_SUPABASE_URL = "https://example.supabase.co";
    process.env.REACT_APP_SUPABASE_ANON_KEY = "public-anon-key";

    const mod = require("./supabaseClient");

    expect(mod.isSupabaseConfigured).toBe(true);
    expect(mod.supabase).toEqual({ auth: {} });
    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-anon-key",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    );
  });
});
