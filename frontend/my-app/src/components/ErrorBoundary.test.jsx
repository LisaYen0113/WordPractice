import { render, screen } from "@testing-library/react";

import ErrorBoundary from "./ErrorBoundary";

function Bomb() {
  throw new Error("boom");
}

test("子樹 render 時爆掉 → 顯示中文錯誤畫面(不是白屏)", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});

  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  );

  expect(screen.getByText("畫面發生錯誤")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新載入" })).toBeInTheDocument();

  spy.mockRestore();
});

test("正常時照常渲染子樹", () => {
  render(
    <ErrorBoundary>
      <p>一切正常</p>
    </ErrorBoundary>
  );

  expect(screen.getByText("一切正常")).toBeInTheDocument();
});
