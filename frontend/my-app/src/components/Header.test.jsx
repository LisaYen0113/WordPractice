import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Header from "./Header";

const mockSignOut = jest.fn();

beforeEach(() => {
  mockSignOut.mockReset();
});

test("顯示 email 與頭像首字", () => {
  render(<Header email="yenli@example.com" onSignOut={mockSignOut} />);

  expect(screen.getByText("yenli@example.com")).toBeInTheDocument();
  expect(screen.getByText("Y")).toBeInTheDocument();
});

test("點齒輪開帳號選單,按登出呼叫 onSignOut", () => {
  render(<Header email="yenli@example.com" onSignOut={mockSignOut} />);

  expect(screen.queryByRole("button", { name: "登出" })).not.toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "帳號選單" }));
  });
  expect(screen.getAllByText(/yenli@example\.com/).length).toBeGreaterThan(1);

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "登出" }));
  });

  expect(mockSignOut).toHaveBeenCalledTimes(1);
});

test("再點一次齒輪會收起選單", () => {
  render(<Header email="yenli@example.com" onSignOut={mockSignOut} />);

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "帳號選單" }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "帳號選單" }));
  });

  expect(screen.queryByRole("button", { name: "登出" })).not.toBeInTheDocument();
});

test("訪客身分:展示模式鈕名稱改為「結束展示並登出」(按了就是登出,語意與一般帳號不同)", () => {
  render(<Header email="demo@example.com" onSignOut={mockSignOut} demoMode isGuest />);

  const button = screen.getByRole("button", { name: "結束展示並登出" });
  expect(button).toHaveAttribute("aria-pressed", "true");
});
