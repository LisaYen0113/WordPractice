// 英翻中測驗的 session 狀態機:純函式、immutable,每個操作回新物件。

export function createSession(words) {
  return {
    items: words.map((w) => ({
      wordId: w.id,
      word: w.word,
      pronunciation: w.pronunciation,
      pos: w.pos,
      definition: w.definition,
    })),
    index: 0,
    results: [],
  };
}

export function isFinished(session) {
  return session.index >= session.items.length;
}

export function currentItem(session) {
  if (isFinished(session)) return null;
  return session.items[session.index];
}

export function nextQuestion(session) {
  if (isFinished(session)) return session;
  return { ...session, index: session.index + 1 };
}

export function recordResult(session, { score, correct, feedback, userInput = "" }) {
  const item = currentItem(session);
  if (!item) return session; // 已結束 → 原樣回傳
  return {
    ...session,
    results: [
      ...session.results,
      { wordId: item.wordId, word: item.word, userInput, score, correct, feedback },
    ],
  };
}

export function summarize(session) {
  return {
    total: session.items.length,
    answered: session.results.length,
    correct: session.results.filter((r) => r.correct).length,
  };
}
