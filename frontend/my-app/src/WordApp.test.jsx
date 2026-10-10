import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { fillWord } from "./api/words";
import useReviewWords from "./hooks/useReviewWords";
import { DEMO_STORAGE_KEY, readGuestSession, writeGuestSession } from "./utils/demoMode";
import WordApp from "./WordApp";

jest.mock("./hooks/useReviewWords", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./api/words", () => ({
  fetchDeck: jest.fn(),
  fillWord: jest.fn(),
  markFamiliar: jest.fn(),
}));

const mockSignOut = jest.fn();
let mockUser = { email: "u@example.com" };
jest.mock("./auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, signOut: mockSignOut }),
}));

const WORD_NEW = {
  id: "w-1",
  word: "resilient",
  pos: "adj.",
  definition: "able to recover quickly",
  pronunciation: "[rɪˈzɪliənt]",
  familiarCount: 0,
  isFamiliar: false,
  quizEnabled: false,
};

const WORD_LEARNED = {
  id: "w-2",
  word: "benevolent",
  pos: "adj.",
  definition: "kind and generous",
  pronunciation: "[bəˈnevələnt]",
  familiarCount: 5,
  isFamiliar: true,
  quizEnabled: false,
};

const hookState = {
  status: "ready",
  words: [WORD_NEW, WORD_LEARNED],
  error: null,
  reload: jest.fn(),
  upsertWord: jest.fn(),
  toggleQuiz: jest.fn(),
  setFamiliarity: jest.fn(),
  familiarPending: {},
  familiarErrors: {},
};

// jest(react-scripts)不載入 .env.local → 這裡自己控制 process.env,測完還原
const ENV_EMAIL = process.env.REACT_APP_DEMO_EMAIL;

afterAll(() => {
  if (ENV_EMAIL === undefined) delete process.env.REACT_APP_DEMO_EMAIL;
  else process.env.REACT_APP_DEMO_EMAIL = ENV_EMAIL;
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  delete process.env.REACT_APP_DEMO_EMAIL;
  mockUser = { email: "u@example.com" };
  mockSignOut.mockReset();
  useReviewWords.mockReturnValue({ ...hookState });
  fillWord.mockResolvedValue({
    id: "w-9",
    word: "apple",
    pos: "n.",
    definition: "a fruit",
    kk_pronunciation: "[ˈæpl]",
    etymology: null,
    synonyms: [],
    antonyms: [],
    inflections: [],
    phrases: [],
    toeic_examples: [],
  });
});

test("ready:顯示未學習分頁的字、email;已熟悉的字在另一分頁", () => {
  render(<WordApp />);

  expect(screen.getByText("u@example.com")).toBeInTheDocument();
  expect(screen.getByText("resilient")).toBeInTheDocument();
  expect(screen.queryByText("benevolent")).not.toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "已學習" }));
  });

  expect(screen.getByText("benevolent")).toBeInTheDocument();
  expect(screen.queryByText("resilient")).not.toBeInTheDocument();
});

test("loading 且沒有字 → 載入狀態", () => {
  useReviewWords.mockReturnValue({ ...hookState, status: "loading", words: [] });

  render(<WordApp />);

  expect(screen.getByText("載入單字中…")).toBeInTheDocument();
});

test("error → 顯示錯誤,按重試呼叫 reload", () => {
  const reload = jest.fn();
  useReviewWords.mockReturnValue({
    ...hookState,
    status: "error",
    words: [],
    error: "無法連線到伺服器,請檢查網路後再試",
    reload,
  });

  render(<WordApp />);

  expect(
    screen.getByText("無法連線到伺服器,請檢查網路後再試")
  ).toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "重試" }));
  });

  expect(reload).toHaveBeenCalledTimes(1);
});

test("新增單字:fillWord 成功 → upsertWord 放進清單", async () => {
  render(<WordApp />);

  act(() => {
    userEvent.type(screen.getByPlaceholderText("輸入新單字..."), "apple");
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  expect(fillWord).toHaveBeenCalledWith("apple");
  expect(useReviewWords.mock.results[0].value.upsertWord).toHaveBeenCalledWith(
    expect.objectContaining({ id: "w-9", word: "apple" })
  );
});

test("新增單字:後端降級(id:null)→ 顯示錯誤、不進清單", async () => {
  fillWord.mockResolvedValue({
    id: null,
    word: "apple",
    pos: "n.",
    definition: "a fruit",
    kk_pronunciation: "[ˈæpl]",
  });

  render(<WordApp />);

  act(() => {
    userEvent.type(screen.getByPlaceholderText("輸入新單字..."), "apple");
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  await waitFor(() =>
    expect(screen.getByText(/沒有存進清單/)).toBeInTheDocument()
  );
  expect(useReviewWords.mock.results[0].value.upsertWord).not.toHaveBeenCalled();
});

test("點單字列開詳情;標記熟悉呼叫 setFamiliarity", async () => {
  render(<WordApp />);

  act(() => {
    userEvent.click(screen.getByText("resilient"));
  });

  // definition 在列表列也會出現 → 用 WordDetail 獨有的標記確認 Modal 開了
  expect(screen.getByText("Detail View")).toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: /標記熟悉/ }));
  });

  expect(useReviewWords.mock.results[0].value.setFamiliarity).toHaveBeenCalledWith(
    "w-1",
    true
  );
});

test("有開啟測驗的字 → 出現開始測驗按鈕,點擊開啟測驗選擇", () => {
  useReviewWords.mockReturnValue({
    ...hookState,
    words: [{ ...WORD_NEW, quizEnabled: true }, WORD_LEARNED],
  });

  render(<WordApp />);

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /開始測驗/ }));
  });

  expect(screen.getByText("準備測驗")).toBeInTheDocument();
  expect(screen.getByText("配對測驗")).toBeInTheDocument();
});

// ---------- 訪客入口(示範帳號):結束展示 = 交還裝置 → 登出 ----------
test("訪客 session 按「結束展示」→ 直接登出、旗標與標記清除,不停在正常模式", async () => {
  process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
  mockUser = { email: "demo@example.com" };
  window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1");
  writeGuestSession(true);

  render(<WordApp />);
  expect(screen.getByRole("status")).toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "結束展示" }));
  });

  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  expect(readGuestSession()).toBe(false);
});

test("訪客 session 在新分頁(展示旗標讀不到)→ 靠跨分頁的訪客標記強制展示模式", () => {
  process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
  // 大小寫/空白不同也算訪客(正規化)。展示旗標在 sessionStorage(不跨分頁)、
  // Supabase session 在 localStorage(跨分頁)→ 新分頁只剩標記讀得到
  mockUser = { email: "DEMO@example.com " };
  writeGuestSession(true);

  render(<WordApp />);

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("展示模式:新增單字已停用")).toBeInTheDocument();
});

test("示範帳號直接登入(沒走訪客按鈕、沒有標記)→ 正常模式,可管理字庫(種字靠這條路)", () => {
  process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
  mockUser = { email: "demo@example.com" };

  render(<WordApp />);

  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("輸入新單字...")).toBeInTheDocument();
});

test("訪客 session 按 Header 的展示模式鈕 → 走同一條路徑:登出、標記清除", async () => {
  process.env.REACT_APP_DEMO_EMAIL = "demo@example.com";
  mockUser = { email: "demo@example.com" };
  writeGuestSession(true);

  render(<WordApp />);
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "結束展示並登出" }));
  });

  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(readGuestSession()).toBe(false);
});

test("一般帳號按「結束展示」→ 只關展示模式、不登出", async () => {
  window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1");

  render(<WordApp />);
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "結束展示" }));
  });

  expect(mockSignOut).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
