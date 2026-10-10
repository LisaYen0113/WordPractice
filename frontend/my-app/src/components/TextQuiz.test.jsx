import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { submitDefinition } from "../api/tests";
import TextQuiz from "./TextQuiz";

jest.mock("../api/tests", () => ({
  submitDefinition: jest.fn(),
}));

const WORDS = [
  {
    id: "w-1",
    word: "resilient",
    pronunciation: "[rɪˈzɪliənt]",
    pos: "adj.",
    definition: "able to recover quickly",
    quizEnabled: true,
  },
  {
    id: "w-2",
    word: "candid",
    pronunciation: "[ˈkændɪd]",
    pos: "adj.",
    definition: "honest and direct",
    quizEnabled: true,
  },
];

const mockOnClose = jest.fn();

beforeEach(() => {
  mockOnClose.mockReset();
  submitDefinition.mockResolvedValue({
    word_id: "w-1",
    is_correct: true,
    feedback: "完全正確!",
    score: 0.95,
  });
});

function typeAnswer(text) {
  act(() => {
    userEvent.type(screen.getByPlaceholderText("輸入中文意思…"), text);
  });
}

async function submit() {
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "送出" }));
  });
}

test("顯示第一題英文與發音;空輸入時不能送出", () => {
  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);

  expect(screen.getByText("resilient")).toBeInTheDocument();
  expect(screen.getByText("[rɪˈzɪliənt]")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "送出" })).toBeDisabled();
});

test("答對:呼叫判分、顯示分數與回饋、下一題", async () => {
  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);
  typeAnswer("有韌性的");
  await submit();

  expect(submitDefinition).toHaveBeenCalledWith("w-1", "有韌性的");
  expect(screen.getByText("95%")).toBeInTheDocument();
  expect(screen.getByText("答對")).toBeInTheDocument();
  expect(screen.getByText("完全正確!")).toBeInTheDocument();
  expect(screen.getByText("able to recover quickly")).toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "下一題" }));
  });

  expect(screen.getByText("candid")).toBeInTheDocument();
});

test("答錯顯示「再想想」;全部答完顯示總結,結束測驗呼叫 onClose", async () => {
  submitDefinition
    .mockResolvedValueOnce({
      word_id: "w-1",
      is_correct: true,
      feedback: "很好!",
      score: 0.95,
    })
    .mockResolvedValueOnce({
      word_id: "w-2",
      is_correct: false,
      feedback: "意思不太對,再試試。",
      score: 0.3,
    });

  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);
  typeAnswer("有韌性的");
  await submit();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "下一題" }));
  });

  typeAnswer("誠實的");
  await submit();

  expect(screen.getByText("再想想")).toBeInTheDocument();
  expect(screen.getByText("30%")).toBeInTheDocument();
  expect(screen.getByText("意思不太對,再試試。")).toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "看總結" }));
  });

  expect(screen.getByText(/答對 1 \/ 2/)).toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "結束測驗" }));
  });
  expect(mockOnClose).toHaveBeenCalledTimes(1);
});

test("判分失敗:顯示中文錯誤,重試成功", async () => {
  submitDefinition
    .mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "AI 判分暫時無法使用,請稍後再試",
    })
    .mockResolvedValueOnce({
      word_id: "w-1",
      is_correct: true,
      feedback: "正確!",
      score: 1,
    });

  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);
  typeAnswer("有韌性的");
  await submit();

  expect(screen.getByText("AI 判分暫時無法使用,請稍後再試")).toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "重試" }));
  });

  expect(screen.getByText("100%")).toBeInTheDocument();
});

test("判分失敗可以跳過本題,記錄為答錯直接進下一題", async () => {
  submitDefinition.mockRejectedValueOnce({
    code: "UPSTREAM",
    message: "AI 判分暫時無法使用,請稍後再試",
  });

  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);
  typeAnswer("有韌性的");
  await submit();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "跳過本題" }));
  });

  expect(screen.getByText("candid")).toBeInTheDocument();
});

test("只挑 quizEnabled 的字當題目", () => {
  render(
    <TextQuiz
      words={[...WORDS, { ...WORDS[0], id: "w-3", word: "ignore-me", quizEnabled: false }]}
      onClose={mockOnClose}
    />
  );

  expect(screen.getByText("resilient")).toBeInTheDocument();
  expect(screen.queryByText("ignore-me")).not.toBeInTheDocument();
});

test("重試進行中不會出現「跳過本題」(避免競態讓進度倒退、題目重複計分)", async () => {
  let resolveRetry;
  submitDefinition
    .mockRejectedValueOnce({
      code: "UPSTREAM",
      message: "AI 判分暫時無法使用,請稍後再試",
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        })
    );

  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);
  typeAnswer("有韌性的");
  await submit();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "重試" }));
  });

  // 判分中:錯誤 UI(含跳過鈕)整組被「判分中…」取代 → 請求進行中不可能前進到下一題
  expect(screen.queryByRole("button", { name: "跳過本題" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "判分中…" })).toBeDisabled();

  await act(async () => {
    resolveRetry({
      word_id: "w-1",
      is_correct: true,
      feedback: "正確!",
      score: 1,
    });
  });

  expect(screen.getByText("100%")).toBeInTheDocument();
});

test("判分逾時:不提供盲重試(結果可能已記錄),可按「跳過本題」繼續", async () => {
  submitDefinition.mockRejectedValueOnce({
    code: "TIMEOUT",
    message: "請求逾時,請稍後再試",
  });

  render(<TextQuiz words={WORDS} onClose={mockOnClose} />);
  typeAnswer("有韌性的");
  await submit();

  expect(screen.getByText(/結果可能已經記錄/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重試" })).not.toBeInTheDocument();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "跳過本題" }));
  });

  expect(screen.getByText("candid")).toBeInTheDocument();
});

// ---- 展示模式:自評(不呼叫 AI、不做字串比對)----

test("展示模式:送出後進自評畫面,顯示自己的答案與定義,完全不呼叫 API", async () => {
  render(<TextQuiz words={WORDS} onClose={mockOnClose} demoMode />);
  typeAnswer("有韌性的");
  await submit();

  expect(screen.getByText("展示模式:自評")).toBeInTheDocument();
  expect(screen.getByText(/對照下面的單字定義/)).toBeInTheDocument();
  expect(screen.getByText("有韌性的")).toBeInTheDocument();
  expect(screen.getByText("able to recover quickly")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "答對了" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "再想想" })).toBeInTheDocument();
  expect(submitDefinition).not.toHaveBeenCalled();
});

test("展示模式:按「答對了」→ 答對 100% 與自評回饋,仍不呼叫 API", async () => {
  render(<TextQuiz words={WORDS} onClose={mockOnClose} demoMode />);
  typeAnswer("有韌性的");
  await submit();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "答對了" }));
  });

  expect(screen.getByText("答對")).toBeInTheDocument();
  expect(screen.getByText("100%")).toBeInTheDocument();
  expect(screen.getByText("(展示模式)你自己判定答對了。")).toBeInTheDocument();
  expect(submitDefinition).not.toHaveBeenCalled();
});

test("展示模式:按「再想想」→ 再想想 0% 與提示看定義", async () => {
  render(<TextQuiz words={WORDS} onClose={mockOnClose} demoMode />);
  typeAnswer("亂答的");
  await submit();

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "再想想" }));
  });

  expect(screen.getByText("再想想")).toBeInTheDocument();
  expect(screen.getByText("0%")).toBeInTheDocument();
  expect(screen.getByText("(展示模式)再看看下面的單字定義。")).toBeInTheDocument();
});

test("展示模式:自評可完成整場(0/2 → 下一題 → 1/2 → 總結)", async () => {
  render(<TextQuiz words={WORDS} onClose={mockOnClose} demoMode />);

  typeAnswer("亂答的");
  await submit();
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "再想想" }));
  });
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "下一題" }));
  });

  typeAnswer("有韌性的");
  await submit();
  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "答對了" }));
  });

  await act(async () => {
    userEvent.click(screen.getByRole("button", { name: "看總結" }));
  });

  expect(screen.getByText(/答對 1 \/ 2/)).toBeInTheDocument();
  expect(submitDefinition).not.toHaveBeenCalled();
});
