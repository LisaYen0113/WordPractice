import { render, screen } from "@testing-library/react";

import SetupNotice from "./SetupNotice";

test("告訴使用者要填哪兩個 env、檔案在哪、填完要重啟", () => {
  render(<SetupNotice />);

  expect(screen.getByText("REACT_APP_SUPABASE_URL")).toBeInTheDocument();
  expect(screen.getByText("REACT_APP_SUPABASE_ANON_KEY")).toBeInTheDocument();
  expect(screen.getByText(/\.env\.local/)).toBeInTheDocument();
  expect(screen.getByText(/重啟/)).toBeInTheDocument();
});
