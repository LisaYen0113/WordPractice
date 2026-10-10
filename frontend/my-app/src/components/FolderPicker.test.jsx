import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FolderPicker from "./FolderPicker";

const FOLDERS = [
  { id: "f-a", name: "TOEIC" },
  { id: "f-b", name: "常錯" },
];

// 釘住:清單只 map folders 而漏掉「未分類」那一顆時,使用者沒辦法把字移出資料夾
test("列出未分類與所有資料夾", () => {
  render(
    <FolderPicker folders={FOLDERS} currentFolderId={null} onPick={jest.fn()} onClose={jest.fn()} />
  );

  expect(screen.getByRole("button", { name: /未分類/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /TOEIC/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /常錯/ })).toBeInTheDocument();
});

// 釘住:只斷言 aria-current 不夠 —— 它在 button 上沒有任何瀏覽器預設樣式,
// 選中那顆的 className 必須跟別顆不同,看得見的使用者才看得出字在哪個資料夾
test("目前所在的資料夾要標示出來", () => {
  render(
    <FolderPicker folders={FOLDERS} currentFolderId="f-a" onPick={jest.fn()} onClose={jest.fn()} />
  );

  const active = screen.getByRole("button", { name: /TOEIC/ });
  const idle = screen.getByRole("button", { name: /常錯/ });

  expect(active).toHaveAttribute("aria-current", "true");
  expect(idle).toHaveAttribute("aria-current", "false");
  // 使用者看得見的那條通道:選中項與未選中項的 class 一定要不一樣
  expect(active.className).not.toBe(idle.className);
});

// 釘住:未分類的選中判斷(currentFolderId === null)若反寫成 !== null 或整條分支漏掉,
// 未分類就不會被標示出來,使用者看不出字已經回到未分類
test("未分類是目前的資料夾時也要標示出來", () => {
  render(
    <FolderPicker folders={FOLDERS} currentFolderId={null} onPick={jest.fn()} onClose={jest.fn()} />
  );

  const active = screen.getByRole("button", { name: /未分類/ });
  const idle = screen.getByRole("button", { name: /TOEIC/ });

  expect(active).toHaveAttribute("aria-current", "true");
  expect(idle).toHaveAttribute("aria-current", "false");
  // 未分類選中時同樣要有視覺區分,不能只有 aria-current
  expect(active.className).not.toBe(idle.className);
});

// 釘住:onPick 丟出名稱或陣列索引(而非 folder.id)會把字指派到別的資料夾
test("點資料夾回報它的 id", () => {
  const onPick = jest.fn();
  render(
    <FolderPicker folders={FOLDERS} currentFolderId={null} onPick={onPick} onClose={jest.fn()} />
  );

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });

  expect(onPick).toHaveBeenCalledWith("f-a");
});

// 釘住:未分類若回報空字串或 "uncategorized" 這種字串,後端會拿去當資料夾 id 而指派失敗,字移不出去
test("點未分類回報 null", () => {
  const onPick = jest.fn();
  render(
    <FolderPicker folders={FOLDERS} currentFolderId="f-a" onPick={onPick} onClose={jest.fn()} />
  );

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /未分類/ }));
  });

  expect(onPick).toHaveBeenCalledWith(null);
});

// 釘住:folders 為空時只剩「未分類」一顆,使用者不知道該去哪裡新增資料夾
test("沒有資料夾時給提示,不是空白清單", () => {
  render(
    <FolderPicker folders={[]} currentFolderId={null} onPick={jest.fn()} onClose={jest.fn()} />
  );

  expect(screen.getByText("還沒有資料夾,回列表用＋新增")).toBeInTheDocument();
});

// 釘住:指派進行中沒把選項 disabled,pending 期間連點會重複送出指派請求
test("pending 時選項停用,避免連點送出兩次", () => {
  render(
    <FolderPicker folders={FOLDERS} currentFolderId={null} onPick={jest.fn()} onClose={jest.fn()} pending />
  );

  expect(screen.getByRole("button", { name: /TOEIC/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /未分類/ })).toBeDisabled();
});

// 釘住:取消鈕若接到 onPick(null) 會把字移回未分類,使用者只想關掉卻改動了資料
test("關閉鈕呼叫 onClose", () => {
  const onClose = jest.fn();
  render(
    <FolderPicker folders={FOLDERS} currentFolderId={null} onPick={jest.fn()} onClose={onClose} />
  );

  act(() => {
    userEvent.click(screen.getByRole("button", { name: "取消" }));
  });

  expect(onClose).toHaveBeenCalled();
});
