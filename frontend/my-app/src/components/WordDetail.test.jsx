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

// 釘住:沒有資料夾的字 chip 若不顯示「未分類」而顯示 undefined/null,使用者會以為字壞了
test("沒指定資料夾時顯示「未分類」", () => {
  render(<WordDetail {...baseProps} onAssignFolder={jest.fn()} />);

  expect(screen.getByRole("button", { name: /未分類/ })).toBeInTheDocument();
});

// 釘住:chip 若寫死顯示「未分類」而不讀 folderName,歸類後的使用者永遠看不到字在哪
test("顯示資料夾名稱", () => {
  render(<WordDetail {...baseProps} onAssignFolder={jest.fn()} folderName="TOEIC" />);

  expect(screen.getByRole("button", { name: /TOEIC/ })).toBeInTheDocument();
});

// 釘住:沒接線的呼叫端也畫出 chip,會多一顆按鈕與既有測試/畫面撞名(未接線就不該出現新 UI)
test("沒接 onAssignFolder 時完全不渲染 chip", () => {
  render(<WordDetail {...baseProps} />);

  expect(screen.queryByRole("button", { name: /未分類/ })).not.toBeInTheDocument();
});

// 釘住:參數順序寫反(folderId, wordId)會把資料夾 id 當單字 id 送出去,伺服器改錯字
test("點了 chip 開 picker,選一個資料夾後回報 (wordId, folderId)", () => {
  const onAssignFolder = jest.fn();
  render(
    <WordDetail
      {...baseProps}
      folders={[{ id: "f-a", name: "TOEIC" }]}
      onAssignFolder={onAssignFolder}
    />
  );

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /未分類/ }));
  });
  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });

  expect(onAssignFolder).toHaveBeenCalledWith(WORD.id, "f-a");
});

// 釘住:選完不關 picker,它就永遠蓋在詳情頁上,使用者被鎖在兩層 modal 裡
test("picker 選完後自己關掉", () => {
  render(
    <WordDetail
      {...baseProps}
      folders={[{ id: "f-a", name: "TOEIC" }]}
      onAssignFolder={jest.fn()}
    />
  );

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /未分類/ }));
  });
  expect(screen.getByText("移到哪個資料夾")).toBeInTheDocument();

  act(() => {
    userEvent.click(screen.getByRole("button", { name: /TOEIC/ }));
  });
  expect(screen.queryByText("移到哪個資料夾")).not.toBeInTheDocument();
});

// 釘住:指派失敗只寫進 hook 卻不顯示,使用者以為字已經移過去了
test("指派失敗:顯示錯誤訊息", () => {
  render(
    <WordDetail
      {...baseProps}
      folders={[{ id: "f-a", name: "TOEIC" }]}
      onAssignFolder={jest.fn()}
      folderError="找不到這個資料夾"
    />
  );

  expect(screen.getByRole("alert")).toHaveTextContent("找不到這個資料夾");
});
