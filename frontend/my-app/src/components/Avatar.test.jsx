import { render, screen } from "@testing-library/react";

import Avatar from "./Avatar";

test("顯示 email 首字(大寫)", () => {
  render(<Avatar email="yenli@example.com" />);

  expect(screen.getByText("Y")).toBeInTheDocument();
});

test("沒有 email → 顯示問號,不當掉", () => {
  render(<Avatar email="" />);

  expect(screen.getByText("?")).toBeInTheDocument();
});
