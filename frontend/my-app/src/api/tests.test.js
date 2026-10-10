import { apiRequest, SLOW_TIMEOUT_MS } from "./client";
import { submitDefinition } from "./tests";

jest.mock("./client", () => ({
  apiRequest: jest.fn(),
  SLOW_TIMEOUT_MS: 60000,
}));

beforeEach(() => {
  apiRequest.mockReset();
});

test("submitDefinition posts the Chinese answer with the slow-AI timeout", async () => {
  apiRequest.mockResolvedValue({
    word_id: "w1",
    is_correct: true,
    feedback: "很好",
    score: 0.95,
  });

  await submitDefinition("w1", "韌性的");

  expect(apiRequest).toHaveBeenCalledWith("/tests/submit_definition", {
    method: "POST",
    body: { word_id: "w1", user_input_zh: "韌性的" },
    timeoutMs: SLOW_TIMEOUT_MS,
  });
});
