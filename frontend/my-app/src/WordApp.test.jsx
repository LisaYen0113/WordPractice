import { useState } from "react";

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { deleteFolder, fetchFolders } from "./api/folders";
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

jest.mock("./api/folders", () => ({
  fetchFolders: jest.fn(),
  createFolder: jest.fn(),
  renameFolder: jest.fn(),
  deleteFolder: jest.fn(),
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
  setFolder: jest.fn(),
  folderPending: {},
  folderErrors: {},
  // 真 hook 一定提供它;刪資料夾的路徑會呼叫,少了這個鍵 mock 就與真介面不符
  clearFolder: jest.fn(),
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
  // resetMocks:true → 不在這裡重設的話 fetchFolders 回 undefined,
  // useFolders 會直接進 error 狀態,每個測試都會多一顆「重試」鈕
  fetchFolders.mockResolvedValue([
    { id: "f-a", name: "TOEIC" },
    { id: "f-b", name: "常錯" },
  ]);
  deleteFolder.mockResolvedValue(null);
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

// ---------- 資料夾篩選(整條線:FolderBar → filterByFolder → 清單/測驗) ----------
// 釘住:選了資料夾要真的照 folderId 過濾,只把選擇存進 state 而沒篩,清單會原封不動全顯示
test("選了資料夾後,清單只剩那個資料夾的字", async () => {
  useReviewWords.mockReturnValue({
    ...hookState,
    words: [
      { ...WORD_NEW, id: "w-a", word: "apple", folderId: "f-a" },
      { ...WORD_NEW, id: "w-b", word: "banana", folderId: null },
    ],
  });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ }); // 等資料夾載入
  expect(screen.getByText("banana")).toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });

  expect(screen.getByText("apple")).toBeInTheDocument();
  expect(screen.queryByText("banana")).not.toBeInTheDocument();
});

// 釘住:空資料夾要說「這個資料夾還沒有單字」,寫死預設文案會讓使用者以為整個字庫都空了
test("空資料夾顯示專屬訊息,不是「目前沒有單字」", async () => {
  useReviewWords.mockReturnValue({
    ...hookState,
    words: [{ ...WORD_NEW, id: "w-b", word: "banana", folderId: null }],
  });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });

  expect(screen.getByText("這個資料夾還沒有單字")).toBeInTheDocument();
});

// 釘住:測驗計數要算篩選後的字,漏改會畫著 2 顆字卻顯示「開始測驗 (3)」,考出畫面上沒有的字
test("測驗範圍跟著資料夾:計數只算該資料夾已開啟測驗的字", async () => {
  useReviewWords.mockReturnValue({
    ...hookState,
    words: [
      { ...WORD_NEW, id: "w-a", word: "apple", folderId: "f-a", quizEnabled: true },
      { ...WORD_NEW, id: "w-b", word: "banana", folderId: "f-a", quizEnabled: true },
      { ...WORD_NEW, id: "w-c", word: "cherry", folderId: null, quizEnabled: true },
    ],
  });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ });

  expect(screen.getByRole("button", { name: /開始測驗 \(3\)/ })).toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });
  expect(screen.getByRole("button", { name: /開始測驗 \(2\)/ })).toBeInTheDocument();

  // 未分類也要跟著:剩 1 顆
  act(() => {
    userEvent.click(screen.getByRole("button", { name: /未分類/ }));
  });
  expect(screen.getByRole("button", { name: /開始測驗 \(1\)/ })).toBeInTheDocument();
});

// 釘住:刪掉的正是目前選中的資料夾時要退回「全部」,否則畫面卡在已刪除的 id 上、字全部消失
test("刪掉正在瀏覽的資料夾 → 篩選退回「全部」", async () => {
  useReviewWords.mockReturnValue({
    ...hookState,
    words: [
      { ...WORD_NEW, id: "w-a", word: "apple", folderId: "f-a" },
      { ...WORD_NEW, id: "w-b", word: "banana", folderId: null },
    ],
  });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });
  expect(screen.queryByText("banana")).not.toBeInTheDocument();

  // 從選中 chip 旁邊的 ⋯ 開編輯 → 刪除 → 確定
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "編輯 TOEIC" }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "確定刪除" }));
  });

  // 退回全部 → 兩顆字都回來了,畫面不會停在一個已刪除的資料夾
  expect(screen.getByText("banana")).toBeInTheDocument();
  expect(screen.getByText("apple")).toBeInTheDocument();
});

// 釘住:刪除資料夾成功後沒有把那些字的 folderId 清成 null(DB 的 ON DELETE SET NULL
// 只發生在 DB)—— 它們會帶著已刪資料夾的 uuid 繼續活在前端,於是「未分類」篩選把它們
// 整批排除、chip 也少算,而確認框才剛承諾「裡面的字會回到未分類」。
// 既有的刪除測試只在「全部」視圖下斷言,永遠看不到這個 bug。
test("刪掉資料夾後,裡面的字回到「未分類」篩選,計數也含它們", async () => {
  // 這顆假 hook 會在 clearFolder 時真的更新 words —— 唯一能穿過
  // 「WordApp → useReviewWords」這條線的寫法;不呼叫 clearFolder 就留著死 uuid,
  // 下面的斷言必定失敗(這正是要釘住的 bug)
  useReviewWords.mockImplementation(() => {
    const [words, setWords] = useState([
      { ...WORD_NEW, id: "w-a", word: "apple", folderId: "f-a" },
      { ...WORD_NEW, id: "w-b", word: "banana", folderId: null },
    ]);
    const clearFolder = (folderId) =>
      setWords((prev) =>
        prev.map((word) =>
          word.folderId === folderId ? { ...word, folderId: null } : word
        )
      );
    return { ...hookState, words, clearFolder };
  });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "編輯 TOEIC" }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "確定刪除" }));
  });

  // 刪除後退回「全部」;使用者下一步最自然的動作就是點「未分類」驗證那句承諾
  act(() => {
    userEvent.click(screen.getByRole("button", { name: /未分類/ }));
  });

  expect(screen.getByText("apple")).toBeInTheDocument();
  expect(screen.getByText("banana")).toBeInTheDocument();
  // 未分類的計數要含 apple:顯示 1 就是少算了
  expect(screen.getByRole("button", { name: /未分類/ })).toHaveTextContent("2");
});

// 釘住:刪除失敗卻照樣清掉 folderId —— 前端說「未分類」,DB 裡的字其實還在那個資料夾,
// 重新載入又跳回去(兩個互相矛盾的真相)
test("刪除資料夾失敗 → 不清掉字的 folderId", async () => {
  const clearFolder = jest.fn();
  deleteFolder.mockRejectedValueOnce({
    code: "SERVER",
    message: "伺服器發生錯誤,請稍後再試",
  });
  useReviewWords.mockReturnValue({ ...hookState, clearFolder });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "編輯 TOEIC" }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "確定刪除" }));
  });

  expect(clearFolder).not.toHaveBeenCalled();
});

// 釘住:詳情頁的 chip 若把參數順序寫反(或接到別顆字的 id),會把字指派到錯的資料夾
test("詳情頁指派資料夾 → 呼叫 setFolder(wordId, folderId)", async () => {
  useReviewWords.mockReturnValue({
    ...hookState,
    words: [{ ...WORD_NEW, id: "w-a", word: "apple", folderId: null }],
  });

  render(<WordApp />);
  await screen.findByRole("button", { name: /TOEIC/ });

  act(() => {
    userEvent.click(screen.getByText("apple"));
  });
  act(() => {
    // 詳情頁的 chip。清單那排 FolderBar 也有一顆「未分類」,
    // getByRole 會抓到兩顆而拋錯 → 取最後一顆(WordDetail 排在 FolderBar 之後)
    const chips = screen.getAllByRole("button", { name: /未分類/ });
    userEvent.click(chips[chips.length - 1]);
  });
  act(() => {
    // picker 裡的 TOEIC 選項(清單上還有一顆同名 chip,取 role=button 的最後一顆)
    const options = screen.getAllByRole("button", { name: /TOEIC/ });
    userEvent.click(options[options.length - 1]);
  });

  expect(useReviewWords.mock.results[0].value.setFolder).toHaveBeenCalledWith("w-a", "f-a");
});
