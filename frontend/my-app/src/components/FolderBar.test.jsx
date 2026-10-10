import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FolderBar from "./FolderBar";

const FOLDERS = [
  { id: "f-a", name: "TOEIC" },
  { id: "f-b", name: "常錯" },
];
const COUNTS = { "f-a": 3, "f-b": 1, uncategorized: 2 };

function renderBar(overrides = {}) {
  const props = {
    folders: FOLDERS,
    selection: "all",
    onSelect: jest.fn(),
    onEdit: jest.fn(),
    counts: COUNTS,
    onCreate: jest.fn().mockResolvedValue(true),
    pending: false,
    actionError: null,
    ...overrides,
  };
  render(<FolderBar {...props} />);
  return props;
}

test("顯示全部/未分類/每個資料夾,以及各自的字數", () => {
  // 釘住:「全部」要是所有 count 的加總,漏加未分類那一格會少算
  renderBar();

  expect(screen.getByRole("button", { name: /全部/ })).toHaveTextContent("6");
  expect(screen.getByRole("button", { name: /未分類/ })).toHaveTextContent("2");
  expect(screen.getByRole("button", { name: /TOEIC/ })).toHaveTextContent("3");
  expect(screen.getByRole("button", { name: /常錯/ })).toHaveTextContent("1");
});

test("點 chip 回報對應的 selection", () => {
  // 釘住:要回報資料夾的 id,回報名稱或陣列索引會篩到別的資料夾
  const props = renderBar();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });

  expect(props.onSelect).toHaveBeenCalledWith("f-a");
});

test("沒有資料夾時:未分類 chip 顯示 0,而不是消失", () => {
  // 釘住:counts 少了 uncategorized 這個鍵時要顯示 0,不能是 undefined 或整顆 chip 不見
  renderBar({ folders: [], counts: {} });

  expect(screen.getByRole("button", { name: /未分類/ })).toHaveTextContent("0");
});

test("選中的資料夾旁邊才有 ⋯ 編輯鈕,點了回報它的 id", () => {
  // 釘住:編輯鈕要回報它掛的那個資料夾 id,回報目前 selection 會編輯到前一個資料夾
  const props = renderBar({ selection: "f-a" });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "編輯 TOEIC" }));
  });

  expect(props.onEdit).toHaveBeenCalledWith("f-a");
});

test("沒選任何資料夾時沒有 ⋯ 編輯鈕", () => {
  // 釘住:選 all / uncategorized 時不能冒出編輯鈕,否則會編輯到不存在的資料夾
  renderBar({ selection: "all" });

  expect(screen.queryByRole("button", { name: /^編輯 / })).not.toBeInTheDocument();
});

test("新增成功:呼叫 onCreate、清空輸入並收起表單", async () => {
  // 釘住:成功後要清空 draft,沒清的話下次打開輸入框還留著上一次建立的名稱
  const props = renderBar();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  });
  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "新資料夾");
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "建立" }));
  });

  expect(props.onCreate).toHaveBeenCalledWith("新資料夾");
  // 成功後表單整個收起來,輸入框跟著消失(不是留在畫面上)
  expect(screen.queryByPlaceholderText("資料夾名稱")).not.toBeInTheDocument();

  // 再打開一次:必須是空的 —— 這行釘住成功路徑的 setDraft("");
  // 少了它,上一次建立的名稱會留在輸入框裡
  act(() => {
    userEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  });
  expect(screen.getByPlaceholderText("資料夾名稱")).toHaveValue("");
});

test("新增失敗:輸入內容保留,錯誤訊息顯示出來", async () => {
  // 釘住:onCreate 回 false 時不能清空輸入,清了等於叫使用者重打一次
  renderBar({
    onCreate: jest.fn().mockResolvedValue(false),
    actionError: "已經有同名資料夾",
  });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  });
  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "TOEIC");
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "建立" }));
  });

  // 失敗時清空輸入等於叫使用者重打一次
  expect(screen.getByPlaceholderText("資料夾名稱")).toHaveValue("TOEIC");
  expect(screen.getByRole("alert")).toHaveTextContent("已經有同名資料夾");
});

test("名稱空白時建立鈕停用", () => {
  // 釘住:空白名稱要擋在前端,送出去只會換回一個 400
  renderBar();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  });

  expect(screen.getByRole("button", { name: "建立" })).toBeDisabled();
});

test("pending 期間建立鈕停用", () => {
  // 釘住:pending 守衛是防止連點的唯一執行點。名稱刻意填非空,
  // 否則 disabled 會來自 !trimmed,這個測試就測不到 pending 那半邊
  renderBar({ pending: true });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  });
  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "TOEIC");
  });

  expect(screen.getByRole("button", { name: "建立" })).toBeDisabled();
});

test("pending 期間按 Enter 不會送出(不能繞過建立鈕的停用守衛)", () => {
  // 釘住:Enter 直接呼叫 submit,繞過 button 的 disabled —— 第一筆還在飛,
  // Enter 就送出第二筆同名 POST,使用者會為自己剛建立的資料夾看到
  // 「已經有同名資料夾」(FolderEditor 的輸入框有同一條規則,兩邊必須一致)
  const props = renderBar({ pending: true });

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "新增資料夾" }));
  });
  act(() => {
    userEvent.type(screen.getByPlaceholderText("資料夾名稱"), "TOEIC{enter}");
  });

  expect(props.onCreate).not.toHaveBeenCalled();
});
