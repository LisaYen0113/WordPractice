import { StrictMode } from "react";

import { act, renderHook, waitFor } from "@testing-library/react";

import { assignFolder, fetchDeck, markFamiliar } from "../api/words";
import { UNCATEGORIZED, countByFolder, filterByFolder } from "../utils/folders";
import useReviewWords from "./useReviewWords";

jest.mock("../api/words", () => ({
  fetchDeck: jest.fn(),
  markFamiliar: jest.fn(),
  assignFolder: jest.fn(),
}));

const CARD_A = { word_id: "w-a", word: "apple", familiarity_score: 0 };
const CARD_B = { word_id: "w-b", word: "banana", familiarity_score: 2 };

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  // CRA resetMocks:true → 每個 test 前都要重設實作
  fetchDeck.mockResolvedValue([CARD_A, CARD_B]);
  markFamiliar.mockResolvedValue({
    word_id: "w-a",
    familiarity_score: 5,
    next_review_date: "2026-11-11",
    familiar: true,
  });
  assignFolder.mockResolvedValue({ word_id: "w-a", folder_id: "f-1" });
});

test("初次載入:loading → ready,卡片轉成 word", async () => {
  const { result } = renderHook(() => useReviewWords());

  expect(result.current.status).toBe("loading");

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.words).toHaveLength(2);
  expect(result.current.words[0]).toMatchObject({ id: "w-a", word: "apple" });
  expect(result.current.error).toBeNull();
  // isFamiliar 由真 mapper 從 familiarity_score 推導(「已學習」分頁靠這個欄位)
  expect(result.current.words[0].isFamiliar).toBe(false);
  expect(result.current.words[1].isFamiliar).toBe(true);
});

test("載入失敗:status=error + 中文訊息;reload 後恢復", async () => {
  fetchDeck.mockRejectedValueOnce({
    code: "NETWORK",
    message: "無法連線到伺服器,請檢查網路後再試",
  });

  const { result } = renderHook(() => useReviewWords());

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("無法連線到伺服器,請檢查網路後再試");

  await act(async () => {
    result.current.reload();
  });

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.words).toHaveLength(2);
  expect(result.current.error).toBeNull();
});

test("reload 後舊請求晚回來 → 不覆蓋新資料(競態)", async () => {
  const first = deferred();
  const second = deferred();
  fetchDeck
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);

  const { result } = renderHook(() => useReviewWords());

  await act(async () => {
    result.current.reload();
  });

  await act(async () => {
    second.resolve([CARD_B]);
  });
  await waitFor(() => expect(result.current.words).toHaveLength(1));

  await act(async () => {
    first.resolve([CARD_A]);
  });

  // 舊請求(apple)晚回來,必須被丟棄
  expect(result.current.words.map((word) => word.id)).toEqual(["w-b"]);
});

test("StrictMode 雙跑 effect:只採計最後一次回應,畫面正常", async () => {
  const { result } = renderHook(() => useReviewWords(), {
    wrapper: StrictMode,
  });

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.words).toHaveLength(2);
  expect(fetchDeck).toHaveBeenCalledTimes(2);
});

test("upsertWord:新字插到最前;同 id 覆蓋、不重複", async () => {
  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  act(() => {
    result.current.upsertWord({ id: "w-c", word: "cherry", quizEnabled: false });
  });
  expect(result.current.words.map((word) => word.id)).toEqual([
    "w-c",
    "w-a",
    "w-b",
  ]);

  act(() => {
    result.current.upsertWord({ id: "w-a", word: "apple 重查", quizEnabled: true });
  });
  expect(result.current.words.map((word) => word.id)).toEqual([
    "w-a",
    "w-c",
    "w-b",
  ]);
  expect(result.current.words[0].word).toBe("apple 重查");
});

test("toggleQuiz:只反轉該字、其他字不動", async () => {
  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  act(() => {
    result.current.toggleQuiz("w-b");
  });

  expect(result.current.words.find((word) => word.id === "w-b").quizEnabled).toBe(
    true
  );
  expect(result.current.words.find((word) => word.id === "w-a").quizEnabled).toBe(
    false
  );
});

test("setFamiliarity 成功:以伺服器回傳值為準,更新熟悉度並清 pending", async () => {
  const grading = deferred();
  markFamiliar.mockReturnValueOnce(grading.promise);

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let promise;
  act(() => {
    promise = result.current.setFamiliarity("w-a", true);
  });

  expect(markFamiliar).toHaveBeenCalledWith("w-a", true);
  expect(result.current.familiarPending["w-a"]).toBe(true);

  await act(async () => {
    grading.resolve({
      word_id: "w-a",
      familiarity_score: 5,
      next_review_date: "2026-11-11",
      familiar: true,
    });
    await promise;
  });

  expect(result.current.familiarPending["w-a"]).toBeUndefined();
  const word = result.current.words.find((item) => item.id === "w-a");
  expect(word.familiarCount).toBe(5);
  expect(word.isFamiliar).toBe(true);
});

test("setFamiliarity 失敗:保留舊值、記下 per-id 錯誤、清 pending", async () => {
  markFamiliar.mockRejectedValueOnce({
    code: "NETWORK",
    message: "無法連線到伺服器,請檢查網路後再試",
  });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.setFamiliarity("w-a", true);
  });

  const word = result.current.words.find((item) => item.id === "w-a");
  expect(word.familiarCount).toBe(0);
  expect(word.isFamiliar).toBe(false);
  expect(result.current.familiarErrors["w-a"]).toBe(
    "無法連線到伺服器,請檢查網路後再試"
  );
  expect(result.current.familiarPending["w-a"]).toBeUndefined();
});

test("setFamiliarity 429:錯誤訊息帶等待秒數", async () => {
  markFamiliar.mockRejectedValueOnce({
    code: "RATE_LIMIT",
    message: "操作太頻繁,請稍後再試",
    retryAfterSeconds: 30,
  });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.setFamiliarity("w-a", true);
  });

  expect(result.current.familiarErrors["w-a"]).toBe(
    "操作太頻繁,請等 30 秒再試"
  );
});

test("setFamiliarity 失敗後重試成功 → 錯誤被清掉", async () => {
  markFamiliar.mockRejectedValueOnce({ code: "SERVER", message: "伺服器發生錯誤,請稍後再試" });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.setFamiliarity("w-a", true);
  });
  expect(result.current.familiarErrors["w-a"]).toBeTruthy();

  await act(async () => {
    await result.current.setFamiliarity("w-a", true);
  });

  expect(result.current.familiarErrors["w-a"]).toBeUndefined();
  expect(
    result.current.words.find((item) => item.id === "w-a").familiarCount
  ).toBe(5);
});

// 釘住:成功要以伺服器回傳的 folder_id 為唯一真相 —— 這裡刻意讓「傳入 f-1、
// 伺服器回 f-9」不一致,實作若沿用傳入值就會存成 f-1。且 pending 必須在 await
// 前就設起來、完成後清掉,否則按鈕不會鎖、使用者會連點送兩次
test("setFolder 成功:以伺服器回傳值為準更新 folderId,清 pending", async () => {
  assignFolder.mockResolvedValueOnce({ word_id: "w-a", folder_id: "f-9" });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  let promise;
  act(() => {
    promise = result.current.setFolder("w-a", "f-1");
  });

  expect(assignFolder).toHaveBeenCalledWith("w-a", "f-1");
  expect(result.current.folderPending["w-a"]).toBe(true);

  await act(async () => {
    await promise;
  });

  expect(result.current.folderPending["w-a"]).toBeUndefined();
  expect(result.current.words.find((w) => w.id === "w-a").folderId).toBe("f-9");
});

// 釘住:伺服器回 null 代表「移回未分類」,畫面必須真的變成 null;
// 若寫成 undefined 或沿用舊值,該字會卡在已刪除的資料夾裡。
// 這顆字刻意先放進 f-9,否則 null → null 的斷言即使整段 setWords 被刪掉也會過
test("setFolder 傳 null:移回未分類", async () => {
  fetchDeck.mockResolvedValueOnce([CARD_A, { ...CARD_B, folder_id: "f-9" }]);
  assignFolder.mockResolvedValueOnce({ word_id: "w-b", folder_id: null });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  // 前提:更新前它真的在 f-9 裡,後面的 null 才有在驗東西
  expect(result.current.words.find((w) => w.id === "w-b").folderId).toBe("f-9");

  await act(async () => {
    await result.current.setFolder("w-b", null);
  });

  expect(assignFolder).toHaveBeenCalledWith("w-b", null);
  expect(result.current.words.find((w) => w.id === "w-b").folderId).toBeNull();
});

// 釘住:失敗時絕不能先動畫面 —— 舊 folderId 要留著,錯誤記在該字上,
// pending 也要清掉(否則該字的按鈕永久卡在禁用狀態)
test("setFolder 失敗:保留舊值、記下 per-id 錯誤,不做樂觀更新", async () => {
  assignFolder.mockRejectedValueOnce({ code: "CONFLICT", message: "已經有同名資料夾" });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.setFolder("w-a", "f-1");
  });

  // 失敗時絕不能先動畫面
  expect(result.current.words.find((w) => w.id === "w-a").folderId).toBeNull();
  expect(result.current.folderErrors["w-a"]).toBe("已經有同名資料夾");
  expect(result.current.folderPending["w-a"]).toBeUndefined();
});

// 釘住:429 帶 Retry-After 時要講出等待秒數,只顯示通用的
// 「操作太頻繁,請稍後再試」使用者只會一直重按
test("setFolder 429:錯誤訊息帶等待秒數", async () => {
  assignFolder.mockRejectedValueOnce({
    code: "RATE_LIMIT",
    message: "操作太頻繁,請稍後再試",
    retryAfterSeconds: 30,
  });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.setFolder("w-a", "f-1");
  });

  expect(result.current.folderErrors["w-a"]).toBe("操作太頻繁,請等 30 秒再試");
});

// 釘住:重試成功後舊的 per-id 錯誤必須被清掉 —— 留著的話使用者明明改成功了,
// 畫面上還掛著上一次的紅字(這段清除邏輯在 setFolder 開頭,沒有測試就會默默腐化)
test("setFolder 失敗後重試成功 → 錯誤被清掉", async () => {
  assignFolder.mockRejectedValueOnce({ code: "CONFLICT", message: "已經有同名資料夾" });

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  await act(async () => {
    await result.current.setFolder("w-a", "f-1");
  });
  expect(result.current.folderErrors["w-a"]).toBeTruthy();

  await act(async () => {
    await result.current.setFolder("w-a", "f-1");
  });

  expect(result.current.folderErrors["w-a"]).toBeUndefined();
  expect(result.current.words.find((item) => item.id === "w-a").folderId).toBe(
    "f-1"
  );
});

// 釘住:刪除資料夾後前端沒同步這批字 —— DB 的 ON DELETE SET NULL 只發生在 DB,
// 前端 words 會永遠帶著已刪資料夾的 uuid(truthy):「未分類」篩選不含它們、
// chip 少算,但同一個字在詳情頁與 picker 都自稱「未分類」。斷言刻意走使用者看到的
// 那兩個症狀(filterByFolder / countByFolder),不是只檢查欄位值。
test("clearFolder:該資料夾的字退回未分類,篩選與計數跟著對", async () => {
  fetchDeck.mockResolvedValueOnce([
    { ...CARD_A, folder_id: "f-a" },
    { ...CARD_B, folder_id: "f-b" },
  ]);

  const { result } = renderHook(() => useReviewWords());
  await waitFor(() => expect(result.current.status).toBe("ready"));

  // 前提:更新前沒有任何字是未分類的,後面的斷言才有在驗東西
  const before = result.current.words;
  expect(filterByFolder(before, UNCATEGORIZED)).toHaveLength(0);

  act(() => {
    result.current.clearFolder("f-a");
  });

  expect(
    filterByFolder(result.current.words, UNCATEGORIZED).map((word) => word.id)
  ).toEqual(["w-a"]);
  expect(countByFolder(result.current.words)[UNCATEGORIZED]).toBe(1);
  // 別的資料夾的字一個都不能動
  expect(result.current.words.find((word) => word.id === "w-b").folderId).toBe("f-b");
  // 不可變:回傳的是新陣列,原本那份不被改寫
  expect(result.current.words).not.toBe(before);
  expect(before.find((word) => word.id === "w-a").folderId).toBe("f-a");
});

// 釘住:200 但 body 不是 JSON 時 fetchDeck() 回 null → cards.map 丟 TypeError。
// 這條沒走 apiErrorMessage 的話,主畫面上會出現整串英文。
test("載入失敗且錯誤不是 ApiError(引擎丟的 TypeError) → 中文 fallback,不外洩英文", async () => {
  fetchDeck.mockRejectedValueOnce(
    new TypeError("Cannot read properties of null (reading 'map')")
  );

  const { result } = renderHook(() => useReviewWords());

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("載入單字失敗,請稍後再試");
});
