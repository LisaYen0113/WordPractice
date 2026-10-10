import { apiRequest, SLOW_TIMEOUT_MS } from "./client";
import { fetchDeck, fillWord, markFamiliar } from "./words";

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
