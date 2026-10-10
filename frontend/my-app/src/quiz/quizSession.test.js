import {
  createSession,
  currentItem,
  isFinished,
  nextQuestion,
  recordResult,
  summarize,
} from "./quizSession";

const WORDS = [
  { id: "w1", word: "attire", pronunciation: "[əˈtaɪər]", pos: "n.", definition: "clothes" },
  { id: "w2", word: "benevolent", pronunciation: "[bəˈnevələnt]", pos: "adj.", definition: "kind" },
];

test("createSession snapshots quiz words in order", () => {
  const session = createSession(WORDS);

  expect(session.items).toEqual([
    { wordId: "w1", word: "attire", pronunciation: "[əˈtaɪər]", pos: "n.", definition: "clothes" },
    {
      wordId: "w2",
      word: "benevolent",
      pronunciation: "[bəˈnevələnt]",
      pos: "adj.",
      definition: "kind",
    },
  ]);
  expect(session.index).toBe(0);
  expect(session.results).toEqual([]);
});

test("currentItem follows the index and is null once finished", () => {
  let session = createSession(WORDS);
  expect(currentItem(session).word).toBe("attire");

  session = nextQuestion(session);
  expect(currentItem(session).word).toBe("benevolent");

  session = nextQuestion(session);
  expect(isFinished(session)).toBe(true);
  expect(currentItem(session)).toBeNull();
});

test("recordResult appends without mutating the original session", () => {
  const session = createSession(WORDS);

  const next = recordResult(session, {
    score: 0.95,
    correct: true,
    feedback: "很好",
    userInput: "服裝",
  });

  expect(session.results).toEqual([]); // 原 session 原封不動
  expect(next.results).toEqual([
    { wordId: "w1", word: "attire", userInput: "服裝", score: 0.95, correct: true, feedback: "很好" },
  ]);
});

test("recordResult on a finished session is a no-op", () => {
  let session = createSession(WORDS);
  session = nextQuestion(nextQuestion(session));

  const next = recordResult(session, { score: 0, correct: false, feedback: "" });

  expect(next.results).toEqual([]);
});

test("summarize counts total / answered / correct", () => {
  let session = createSession(WORDS);
  session = recordResult(session, { score: 0.95, correct: true, feedback: "好" });
  session = nextQuestion(session);
  session = recordResult(session, { score: 0.2, correct: false, feedback: "再想想" });
  session = nextQuestion(session);

  expect(summarize(session)).toEqual({ total: 2, answered: 2, correct: 1 });
});

test("empty quiz words → immediately finished, summary all zero", () => {
  const session = createSession([]);
  expect(isFinished(session)).toBe(true);
  expect(summarize(session)).toEqual({ total: 0, answered: 0, correct: 0 });
});
