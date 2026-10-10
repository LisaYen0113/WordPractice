import { apiRequest, SLOW_TIMEOUT_MS } from "./client";
import { assignFolder, fetchDeck, fillWord, markFamiliar } from "./words";

jest.mock("./client", () => ({
  apiRequest: jest.fn(),
  SLOW_TIMEOUT_MS: 60000,
}));

beforeEach(() => {
  apiRequest.mockReset();
});

test("fetchDeck hits GET /words/deck", async () => {
  apiRequest.mockResolvedValue([]);

  await expect(fetchDeck()).resolves.toEqual([]);
  expect(apiRequest).toHaveBeenCalledWith("/words/deck");
});

test("fillWord posts the word with the slow-AI timeout (Gemini 很慢)", async () => {
  apiRequest.mockResolvedValue({ id: "w1", word: "resilient" });

  await fillWord("resilient");

  expect(apiRequest).toHaveBeenCalledWith("/words/fill", {
    method: "POST",
    body: { word: "resilient" },
    timeoutMs: SLOW_TIMEOUT_MS,
  });
});

test("markFamiliar posts word_id + familiar", async () => {
  apiRequest.mockResolvedValue({});

  await markFamiliar("w1", true);

  expect(apiRequest).toHaveBeenCalledWith("/words/mark_familiar", {
    method: "POST",
    body: { word_id: "w1", familiar: true },
  });
});

// 釘住:移回未分類時打成別的端點或別的方法,字其實留在原資料夾,UI 卻顯示已移出。
test("assignFolder 送 PUT 與 folder_id(null = 移回未分類)", async () => {
  apiRequest.mockResolvedValue({ word_id: "w1", folder_id: null });

  await assignFolder("w1", null);

  expect(apiRequest).toHaveBeenCalledWith("/words/w1/folder", {
    method: "PUT",
    body: { folder_id: null },
  });
});

// 釘住:鍵名寫成 folderId 或 id 沒進路徑 → 後端收不到要指派的資料夾,指派靜默失效。
test("assignFolder 原樣轉送資料夾 id", async () => {
  apiRequest.mockResolvedValue({ word_id: "w1", folder_id: "f-1" });

  await assignFolder("w1", "f-1");

  expect(apiRequest).toHaveBeenCalledWith("/words/w1/folder", {
    method: "PUT",
    body: { folder_id: "f-1" },
  });
});

test("assignFolder 收到 undefined 也送 null,不是把鍵丟掉", async () => {
  // JSON.stringify({folder_id: undefined}) 會整個鍵消失 → 後端 422。
  // 這個測試釘住 `?? null`,沒有它這個保護就沒人守。
  apiRequest.mockResolvedValue({ word_id: "w1", folder_id: null });

  await assignFolder("w1", undefined);

  expect(apiRequest).toHaveBeenCalledWith("/words/w1/folder", {
    method: "PUT",
    body: { folder_id: null },
  });
});
