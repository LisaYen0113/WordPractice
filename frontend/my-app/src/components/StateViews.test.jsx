import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  EmptyState,
  ErrorState,
  FullScreenLoading,
  LoadingState,
} from "./StateViews";

test("LoadingState:顯示載入字樣", () => {
  render(<LoadingState />);

  expect(screen.getByText("載入單字中…")).toBeInTheDocument();
});

test("FullScreenLoading:顯示全頁載入字樣", () => {
  render(<FullScreenLoading />);

  expect(screen.getByText("載入中…")).toBeInTheDocument();
});

test("ErrorState:顯示訊息,按重試呼叫 onRetry", () => {
  const onRetry = jest.fn();
  render(<ErrorState message="無法連線到伺服器" onRetry={onRetry} />);

  expect(screen.getByText("無法連線到伺服器")).toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "重試" }));
  });

  expect(onRetry).toHaveBeenCalledTimes(1);
});

test("EmptyState:顯示自訂訊息", () => {
  render(<EmptyState message="這裡還沒有單字" />);

  expect(screen.getByText("這裡還沒有單字")).toBeInTheDocument();
});
