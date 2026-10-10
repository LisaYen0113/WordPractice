import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FolderEditor from "./FolderEditor";

function renderEditor(overrides = {}) {
  const props = {
    folder: { id: "f-a", name: "TOEIC" },
    onRename: jest.fn().mockResolvedValue(true),
    onDelete: jest.fn().mockResolvedValue(true),
    onClose: jest.fn(),
    pending: false,
    actionError: null,
    ...overrides,
  };
  render(<FolderEditor {...props} />);
  return props;
}

// 釘住:初始值若寫成空字串,改個字就變成從空白整串重打 —— 預填必須是資料夾目前的名稱
test("輸入框預填目前名稱", () => {
  renderEditor();

  expect(screen.getByPlaceholderText("資料夾名稱")).toHaveValue("TOEIC");
});

// 釘住:改名成功卻忘記呼叫 onClose,存完了 modal 還蓋在畫面上等使用者自己關
test("改名送出後呼叫 onRename,成功就關閉", async () => {
  const props = renderEditor();

  act(() => {
    userEvent.clear(screen.getByPlaceholderText("資料夾名稱"));
  });
  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "多益");
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "儲存" }));
  });

  expect(props.onRename).toHaveBeenCalledWith("多益");
  expect(props.onClose).toHaveBeenCalled();
});

// 釘住:onRename 回 false 卻照樣關閉並清空輸入 —— 失敗時必須留在原地、保留打好的名字、顯示錯誤
test("改名失敗:留在原地、不清空輸入、顯示訊息", async () => {
  const props = renderEditor({
    onRename: jest.fn().mockResolvedValue(false),
    actionError: "已經有同名資料夾",
  });

  act(() => {
    userEvent.clear(screen.getByPlaceholderText("資料夾名稱"));
  });
  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "常錯");
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "儲存" }));
  });

  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText("資料夾名稱")).toHaveValue("常錯");
  expect(screen.getByRole("alert")).toHaveTextContent("已經有同名資料夾");
});

// 釘住:刪除鈕直接接到 onDelete 而沒有二次確認,一點就把整個資料夾的整理成果砍掉
test("刪除要二次確認,且文案說明字會退回未分類", async () => {
  const props = renderEditor();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });

  // 沒確認前絕不能真的刪
  expect(props.onDelete).not.toHaveBeenCalled();
  expect(
    screen.getByText("刪除後,裡面的字會回到「未分類」,複習進度不會消失。")
  ).toBeInTheDocument();
});

// 釘住:二次確認只換了畫面卻沒真的呼叫 onDelete(或刪成了卻忘記 onClose),使用者以為刪掉了其實還在
test("確認刪除後才呼叫 onDelete,成功就關閉", async () => {
  const props = renderEditor();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "確定刪除" }));
  });

  expect(props.onDelete).toHaveBeenCalled();
  expect(props.onClose).toHaveBeenCalled();
});

// 釘住:onDelete 回 false 卻還是把 modal 關掉 —— 使用者以為刪成功了,資料其實原封不動還在
test("刪除失敗:留在原地不關閉", async () => {
  const props = renderEditor({ onDelete: jest.fn().mockResolvedValue(false) });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "確定刪除" }));
  });

  expect(props.onClose).not.toHaveBeenCalled();
});

// 釘住:按了取消確認卻還是把資料夾刪掉(或卡在確認畫面回不去)—— 確認狀態必須能退回編輯狀態
test("取消確認會回到編輯狀態", async () => {
  renderEditor();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "取消" }));
  });

  expect(screen.getByPlaceholderText("資料夾名稱")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "確定刪除" })).not.toBeInTheDocument();
});
