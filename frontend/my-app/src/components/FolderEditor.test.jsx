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

test("pending 期間儲存鈕停用", () => {
  // 釘住:改名寫入中按鈕要鎖住,連點會送出兩筆 PATCH(名稱預填非空,
  // 所以 disabled 只可能來自 pending 那半邊)
  renderEditor({ pending: true });

  expect(screen.getByRole("button", { name: "儲存" })).toBeDisabled();
});

test("pending 期間刪除資料夾鈕停用", () => {
  // 釘住:刪除是不可逆動作,唯一進到二次確認的入口,寫入中必須鎖住
  renderEditor({ pending: true });

  expect(screen.getByRole("button", { name: "刪除資料夾" })).toBeDisabled();
});

test("pending 期間確定刪除鈕停用", () => {
  // 釘住:真正送出 DELETE 的是這顆。刪除鈕本身已被 pending 擋住,
  // 所以用 rerender 模擬「停在確認畫面時,另一筆寫入已經在飛」
  const props = {
    folder: { id: "f-a", name: "TOEIC" },
    onRename: jest.fn().mockResolvedValue(true),
    onDelete: jest.fn().mockResolvedValue(true),
    onClose: jest.fn(),
  };
  const { rerender } = render(<FolderEditor {...props} pending={false} />);

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "刪除資料夾" }));
  });
  rerender(<FolderEditor {...props} pending />);

  expect(screen.getByRole("button", { name: "確定刪除" })).toBeDisabled();
});

test("pending 期間按 Enter 不會送出改名(不能繞過儲存鈕的停用守衛)", () => {
  // 釘住:Enter 直接呼叫 submitRename,繞過 button 的 disabled —— 改名還在飛,
  // Enter 就送出第二筆(FolderBar 的建立框有同一條規則,兩邊必須一致)
  const props = renderEditor({ pending: true });

  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "{enter}");
  });

  expect(props.onRename).not.toHaveBeenCalled();
});
