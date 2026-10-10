import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AddWord from "./AddWord";

const mockOnAdd = jest.fn();

beforeEach(() => {
  mockOnAdd.mockReset();
});

function typeWord(text) {
  act(() => {
    userEvent.type(screen.getByPlaceholderText("輸入新單字..."), text);
  });
}

test("空輸入 → 加入按鈕停用", () => {
  render(<AddWord onAdd={mockOnAdd} />);

  expect(screen.getByRole("button", { name: "加入" })).toBeDisabled();
});

test("中文輸入:前端直接擋,不呼叫 onAdd", () => {
  render(<AddWord onAdd={mockOnAdd} />);
  typeWord("蘋果");

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  expect(mockOnAdd).not.toHaveBeenCalled();
  expect(screen.getByText(/只能輸入英文/)).toBeInTheDocument();
});

test("成功:onAdd 收到去空白的單字,輸入框清空", async () => {
  mockOnAdd.mockResolvedValue(undefined);
  render(<AddWord onAdd={mockOnAdd} />);
  typeWord("  apple  ");

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  expect(mockOnAdd).toHaveBeenCalledWith("apple");
  expect(screen.getByPlaceholderText("輸入新單字...")).toHaveValue("");
});

test("生成中:按鈕變「生成中…」並停用", async () => {
  let resolveAdd;
  mockOnAdd.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAdd = resolve;
      })
  );
  render(<AddWord onAdd={mockOnAdd} />);
  typeWord("apple");

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();

  await act(async () => {
    resolveAdd();
  });
});

test("失敗:顯示錯誤、保留輸入", async () => {
  mockOnAdd.mockRejectedValue({ message: "生成成功但沒有存進清單,請稍後再試一次" });
  render(<AddWord onAdd={mockOnAdd} />);
  typeWord("apple");

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  expect(
    screen.getByText("生成成功但沒有存進清單,請稍後再試一次")
  ).toBeInTheDocument();
  expect(screen.getByPlaceholderText("輸入新單字...")).toHaveValue("apple");
  expect(screen.getByRole("button", { name: "加入" })).toBeEnabled();
});

test("429:錯誤訊息帶等待秒數", async () => {
  mockOnAdd.mockRejectedValue({ code: "RATE_LIMIT", retryAfterSeconds: 30 });
  render(<AddWord onAdd={mockOnAdd} />);
  typeWord("apple");

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "加入" }));
  });

  expect(screen.getByText("查詢太頻繁,請等 30 秒再試")).toBeInTheDocument();
});

test("按 Enter 送出", async () => {
  mockOnAdd.mockResolvedValue(undefined);
  render(<AddWord onAdd={mockOnAdd} />);

  await act(async () => {
    userEvent.type(screen.getByPlaceholderText("輸入新單字..."), "apple{enter}");
  });

  expect(mockOnAdd).toHaveBeenCalledWith("apple");
});

test("IME 選字中的 Enter 不送出,選完後的 Enter 才送出", async () => {
  mockOnAdd.mockResolvedValue(undefined);
  render(<AddWord onAdd={mockOnAdd} />);
  const input = screen.getByPlaceholderText("輸入新單字...");

  act(() => {
    fireEvent.change(input, { target: { value: "apple" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  });
  expect(mockOnAdd).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(mockOnAdd).toHaveBeenCalledWith("apple");
});
