import { StrictMode } from "react";

import { act, renderHook, waitFor } from "@testing-library/react";

import { fetchDeck, markFamiliar } from "../api/words";
import useReviewWords from "./useReviewWords";

jest.mock("../api/words", () => ({
  fetchDeck: jest.fn(),
  markFamiliar: jest.fn(),
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
