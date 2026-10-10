import { act, renderHook, waitFor } from "@testing-library/react";

import { createFolder, deleteFolder, fetchFolders, renameFolder } from "../api/folders";
import useFolders from "./useFolders";

jest.mock("../api/folders", () => ({
  fetchFolders: jest.fn(),
  createFolder: jest.fn(),
  renameFolder: jest.fn(),
  deleteFolder: jest.fn(),
}));

const FOLDER_A = { id: "f-a", name: "TOEIC" };
const FOLDER_B = { id: "f-b", name: "常錯" };

beforeEach(() => {
  // CRA resetMocks:true → 每個 test 前都要重設實作
  fetchFolders.mockResolvedValue([FOLDER_A, FOLDER_B]);
  createFolder.mockResolvedValue({ id: "f-c", name: "新資料夾" });
  renameFolder.mockResolvedValue({ ...FOLDER_A, name: "改名後" });
  deleteFolder.mockResolvedValue(null);
});

// 釘住：初次 render 必須回報 loading —— 若一開始就給 ready + 空陣列,畫面會閃一下「沒有資料夾」的空狀態
test("初次載入:loading → ready", async () => {
  const { result } = renderHook(() => useFolders());

  expect(result.current.status).toBe("loading");

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.folders).toEqual([FOLDER_A, FOLDER_B]);
  expect(result.current.error).toBeNull();
});

// 釘住：載入失敗要落到 status=error 並沿用後端的中文訊息,不可吞掉錯誤讓畫面永遠卡在 loading
test("載入失敗:status=error + 中文訊息", async () => {
  fetchFolders.mockRejectedValueOnce({ code: "NETWORK", message: "無法連線到伺服器,請檢查網路後再試" });

  const { result } = renderHook(() => useFolders());

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("無法連線到伺服器,請檢查網路後再試");
});

// 釘住：新增成功要把伺服器回傳的那筆接到清單尾端並回 true,不能只回 true 卻不更新畫面
test("新增成功:清單多一筆並回 true", async () => {
  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let ok;
  await act(async () => {
    ok = await result.current.addFolder("新資料夾");
  });

  expect(ok).toBe(true);
  expect(createFolder).toHaveBeenCalledWith("新資料夾");
  expect(result.current.folders.map((f) => f.name)).toEqual(["TOEIC", "常錯", "新資料夾"]);
  expect(result.current.actionError).toBeNull();
});

// 釘住：409 失敗不可樂觀新增(清單必須原封不動),且要回報後端的中文衝突訊息而非泛用字串
test("新增名稱重複(409):回 false 並顯示後端中文訊息,清單不變", async () => {
  createFolder.mockRejectedValueOnce({
    code: "CONFLICT",
    message: "已經有同名資料夾",
    status: 409,
  });

  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let ok;
  await act(async () => {
    ok = await result.current.addFolder("TOEIC");
  });

  expect(ok).toBe(false);
  expect(result.current.actionError).toBe("已經有同名資料夾");
  expect(result.current.folders).toHaveLength(2);
});

// 釘住：前端預檢擋掉的名稱不能白打一趟 API(createFolder 不該被呼叫),也不必等後端 422 才知道
test("新增送出不合法名稱:不打 API、直接顯示訊息", async () => {
  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let ok;
  await act(async () => {
    ok = await result.current.addFolder("   ");
  });

  expect(ok).toBe(false);
  expect(createFolder).not.toHaveBeenCalled();
  expect(result.current.actionError).toBe("請先輸入資料夾名稱");
});

// 釘住：改名只能換掉目標那一筆的名字,其他筆與其他欄位原封不動(不可改成別筆或整份清單重建)
test("改名成功:就地換掉那一筆的名字", async () => {
  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.renameFolderById("f-a", "改名後");
  });

  expect(result.current.folders).toEqual([{ id: "f-a", name: "改名後" }, FOLDER_B]);
});

// 釘住：刪除成功要把該筆從清單移除並回 true —— 回 false 會讓呼叫端誤判失敗而不把篩選退回全部
test("刪除成功:清單移除該筆並回 true", async () => {
  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let ok;
  await act(async () => {
    ok = await result.current.removeFolder("f-a");
  });

  expect(ok).toBe(true);
  expect(deleteFolder).toHaveBeenCalledWith("f-a");
  expect(result.current.folders).toEqual([FOLDER_B]);
});

// 釘住：刪除失敗不可先把該筆拿掉(後端還留著),清單必須原封不動並回 false,否則前後端不一致
test("刪除失敗:清單不變並回 false", async () => {
  deleteFolder.mockRejectedValueOnce({ code: "SERVER", message: "伺服器發生錯誤,請稍後再試" });

  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let ok;
  await act(async () => {
    ok = await result.current.removeFolder("f-a");
  });

  expect(ok).toBe(false);
  expect(result.current.folders).toHaveLength(2);
  expect(result.current.actionError).toBe("伺服器發生錯誤,請稍後再試");
});

// 釘住：429 要經 apiErrorMessage 換成含等待秒數的訊息,不能顯示後端原文讓使用者不知道要等多久
test("429:訊息帶等待秒數", async () => {
  createFolder.mockRejectedValueOnce({
    code: "RATE_LIMIT",
    message: "操作太頻繁,請稍後再試",
    retryAfterSeconds: 30,
  });

  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.addFolder("新資料夾");
  });

  expect(result.current.actionError).toBe("操作太頻繁,請等 30 秒再試");
});

// 釘住：pending 要涵蓋整個寫入期間(未完成前為 true、完成後清掉),否則按鈕不會禁用、使用者能連點重複送出
test("寫入進行中 pending 為 true,結束後清掉", async () => {
  let resolveCreate;
  createFolder.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCreate = resolve;
    })
  );

  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let promise;
  act(() => {
    promise = result.current.addFolder("新資料夾");
  });
  expect(result.current.pending).toBe(true);

  await act(async () => {
    resolveCreate({ id: "f-c", name: "新資料夾" });
    await promise;
  });
  expect(result.current.pending).toBe(false);
});

test("清單只留 { id, name }:DB 的其餘欄位不外流", async () => {
  fetchFolders.mockResolvedValueOnce([
    { id: "f-a", name: "TOEIC", created_at: "2026-01-01T00:00:00+00:00" },
  ]);

  const { result } = renderHook(() => useFolders());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  // 釘住 load() 裡的 map:少了它,DB 每一欄(created_at、user_id…)都會漏到 UI 層。
  // 這條契約在 brief 的 Interfaces 區塊寫的是 folders: [{ id, name }]。
  expect(result.current.folders).toEqual([{ id: "f-a", name: "TOEIC" }]);
});
