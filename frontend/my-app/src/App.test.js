import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { fetchDeck, fillWord } from "./api/words";
import App from "./App";
import { DEMO_STORAGE_KEY, GUEST_SESSION_KEY } from "./utils/demoMode";

jest.mock("./api/words", () => ({
  fetchDeck: jest.fn(),
  fillWord: jest.fn(),
  markFamiliar: jest.fn(),
}));

let mockConfigured = true;
jest.mock("./auth/supabaseClient", () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  supabase: null,
}));

let mockAuthState = {};
jest.mock("./auth/AuthContext", () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuthState,
}));

beforeEach(() => {
  window.sessionStorage.clear();
  mockConfigured = true;
  mockAuthState = {
    user: null,
    loading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  };
  fetchDeck.mockResolvedValue([]);
  fillWord.mockReset();
});

test("env 沒填 → 顯示設定提示", () => {
  mockConfigured = false;

  render(<App />);

  expect(screen.getByText("REACT_APP_SUPABASE_URL")).toBeInTheDocument();
  expect(screen.getByText(/\.env\.local/)).toBeInTheDocument();
});

test("auth 載入中 → 顯示全頁載入", () => {
  mockAuthState = { ...mockAuthState, loading: true };

  render(<App />);

  expect(screen.getByText("載入中…")).toBeInTheDocument();
});

test("未登入 → 顯示登入畫面", () => {
  render(<App />);

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登入" })).toBeInTheDocument();
});

test("登入後 → 抓 deck 並列出來,Header 顯示 email", async () => {
  mockAuthState = { ...mockAuthState, user: { email: "u@example.com" } };
  fetchDeck.mockResolvedValue([
    {
      word_id: "w-1",
      word: "resilient",
      pos: "adj.",
      definition: "able to recover quickly",
      kk_pronunciation: "[rɪˈzɪliənt]",
      etymology: null,
      synonyms: [],
      toeic_examples: [],
      familiarity_score: 0,
    },
  ]);

  render(<App />);

  await waitFor(() =>
    expect(screen.getByText("resilient")).toBeInTheDocument()
  );
  expect(screen.getByText("u@example.com")).toBeInTheDocument();
});

test("deck 抓失敗 → 錯誤畫面,重試再抓一次", async () => {
  mockAuthState = { ...mockAuthState, user: { email: "u@example.com" } };
  fetchDeck
    .mockRejectedValueOnce({
      code: "NETWORK",
      message: "無法連線到伺服器,請檢查網路後再試",
    })
    .mockResolvedValueOnce([]);

  render(<App />);

  await waitFor(() =>
    expect(screen.getByText("無法連線到伺服器,請檢查網路後再試")).toBeInTheDocument()
  );

  const { act } = require("@testing-library/react");
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "重試" }));
  });

  await waitFor(() => expect(fetchDeck).toHaveBeenCalledTimes(2));
});

test("展示模式:開啟後顯示提示條、新增停用;結束後恢復", async () => {
  mockAuthState = { ...mockAuthState, user: { email: "u@example.com" } };
  fetchDeck.mockResolvedValue([
    {
      word_id: "w-1",
      word: "resilient",
      pos: "adj.",
      definition: "能快速恢復的",
      kk_pronunciation: "[rɪˈzɪliənt]",
      etymology: null,
      synonyms: [],
      toeic_examples: [],
      familiarity_score: 0,
    },
  ]);

  render(<App />);
  await waitFor(() => expect(screen.getByText("resilient")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "展示模式" }));

  expect(screen.getByRole("status")).toHaveTextContent("展示模式");
  expect(screen.getByPlaceholderText("展示模式:新增單字已停用")).toBeDisabled();
  expect(screen.getByText(/展示模式不開放新增單字/)).toBeInTheDocument();

  // 展示模式:新增單字全面擋住(輸入框停用 + handleAdd 防護)→ 不會呼叫 fillWord
  fireEvent.change(screen.getByPlaceholderText("展示模式:新增單字已停用"), {
    target: { value: "newword" },
  });
  fireEvent.click(screen.getByRole("button", { name: "加入" }));
  expect(fillWord).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "結束展示" }));

  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("輸入新單字...")).toBeEnabled();
});

test("展示模式:重新整理(重新掛載)後仍開啟", async () => {
  mockAuthState = { ...mockAuthState, user: { email: "u@example.com" } };
  window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1");

  render(<App />);

  expect(await screen.findByRole("status")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("展示模式:新增單字已停用")).toBeDisabled();
});

test("未登入狀態(含 401 強制登出)會清掉展示模式旗標與訪客標記", () => {
  window.sessionStorage.setItem(DEMO_STORAGE_KEY, "1");
  window.localStorage.setItem(GUEST_SESSION_KEY, "1");

  render(<App />); // mockAuthState:user = null、loading = false → 未登入

  expect(window.sessionStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  expect(window.localStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
});
