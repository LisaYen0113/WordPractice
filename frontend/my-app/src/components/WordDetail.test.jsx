import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WordDetail from "./WordDetail";

const WORD = {
  id: "w-1",
  word: "resilient",
  pos: "adj.",
  definition: "able to recover quickly",
  pronunciation: "[rɪˈzɪliənt]",
  etymology: "from Latin resilire",
  synonyms: ["tough"],
  antonyms: [],
  variants: "",
  phrases: [],
  toeic: ["She is resilient."],
};

const baseProps = {
  word: WORD,
  isFamiliar: false,
  onClose: jest.fn(),
  onPrev: jest.fn(),
  onNext: jest.fn(),
  toggleFamiliar: jest.fn(),
};

beforeEach(() => {
  baseProps.onClose.mockReset();
  baseProps.onPrev.mockReset();
  baseProps.onNext.mockReset();
  baseProps.toggleFamiliar.mockReset();
});

test("顯示單字、詞性、定義、發音", () => {
  render(<WordDetail {...baseProps} />);

  expect(screen.getByText("resilient")).toBeInTheDocument();
  expect(screen.getByText("adj.")).toBeInTheDocument();
  expect(screen.getByText("able to recover quickly")).toBeInTheDocument();
  expect(screen.getByText("[rɪˈzɪliənt]")).toBeInTheDocument();
});

test("按標記熟悉 → 呼叫 toggleFamiliar", () => {
  render(<WordDetail {...baseProps} />);

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /標記熟悉/ }));
  });

  expect(baseProps.toggleFamiliar).toHaveBeenCalledTimes(1);
});

test("已熟悉狀態顯示「已熟悉」", () => {
  render(<WordDetail {...baseProps} isFamiliar={true} />);

  expect(screen.getByRole("button", { name: /已熟悉/ })).toBeInTheDocument();
});

test("更新中:按鈕停用並顯示「更新中…」", () => {
  render(<WordDetail {...baseProps} isFamiliarPending={true} />);

  const button = screen.getByRole("button", { name: /更新中/ });
  expect(button).toBeDisabled();
});

test("有 familiarError → 顯示錯誤訊息", () => {
  render(<WordDetail {...baseProps} familiarError="無法連線到伺服器" />);

  expect(screen.getByText("無法連線到伺服器")).toBeInTheDocument();
});

test("返回/上一個/下一個各自呼叫 callback", () => {
  render(<WordDetail {...baseProps} />);

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /返回列表/ }));
    userEvent.click(screen.getByRole("button", { name: /上一個/ }));
    userEvent.click(screen.getByRole("button", { name: /下一個/ }));
  });

  expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  expect(baseProps.onPrev).toHaveBeenCalledTimes(1);
  expect(baseProps.onNext).toHaveBeenCalledTimes(1);
});
