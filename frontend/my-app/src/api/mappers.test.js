import { cardToWord, detailToWord } from "./mappers";

const CARD = {
  word_id: "11111111-1111-1111-1111-111111111111",
  word: "resilient",
  pos: "adj.",
  definition: "able to recover quickly",
  kk_pronunciation: "[rɪˈzɪliənt]",
  etymology: "源自拉丁語 resilire",
  synonyms: ["tough"],
  toeic_examples: ["Be resilient."],
  familiarity_score: 3,
};

describe("cardToWord", () => {
  test("maps a backend card to the frontend word shape", () => {
    expect(cardToWord(CARD)).toEqual({
      id: CARD.word_id,
      word: "resilient",
      pos: "adj.",
      definition: "able to recover quickly",
      pronunciation: "[rɪˈzɪliənt]",
      etymology: "源自拉丁語 resilire",
      synonyms: ["tough"],
      toeic: ["Be resilient."],
      familiarCount: 3,
      isFamiliar: true, // 3 > 0
      folderId: null, // CARD / DETAIL 都沒有 folder_id → 未分類
      quizEnabled: false, // 測驗開關是 session-local,預設關
    });
  });

  test("null optionals become undefined / [] (WordDetail 會對字串呼叫 trim)", () => {
    const word = cardToWord({
      ...CARD,
      etymology: null,
      synonyms: null,
      toeic_examples: null,
    });
    expect(word.etymology).toBeUndefined();
    expect(word.synonyms).toEqual([]);
    expect(word.toeic).toEqual([]);
  });

  test("familiarity_score drives familiarCount and isFamiliar (> 0)", () => {
    const fresh = cardToWord({ ...CARD, familiarity_score: 0 });
    expect(fresh.familiarCount).toBe(0);
    expect(fresh.isFamiliar).toBe(false);

    const known = cardToWord({ ...CARD, familiarity_score: 5 });
    expect(known.familiarCount).toBe(5);
    expect(known.isFamiliar).toBe(true);
  });

  // 釘住:直接回傳 card.folder_id(少了 ?? null)→ 未分類的字 folderId 是 undefined,
  // 與 utils/folders 的 null 判定不一致,未分類分頁會漏掉這些字。
  test("folder_id 轉成 folderId;未分類是 null", () => {
    expect(cardToWord({ ...CARD, folder_id: "f-1" }).folderId).toBe("f-1");
    expect(cardToWord({ ...CARD, folder_id: null }).folderId).toBeNull();
  });

  test("does not mutate its input", () => {
    const frozen = Object.freeze({ ...CARD });
    expect(() => cardToWord(frozen)).not.toThrow();
  });
});

describe("detailToWord", () => {
  const DETAIL = {
    id: "22222222-2222-2222-2222-222222222222",
    word: "resilient",
    pos: "adj.",
    definition: "able to recover quickly",
    kk_pronunciation: "[rɪˈzɪliənt]",
    etymology: null,
    synonyms: ["tough"],
    antonyms: ["fragile"],
    inflections: ["resiliently", "resilience"],
    phrases: ["be resilient to"],
    toeic_examples: ["Be resilient."],
  };

  test("inflections join into a variants string (WordDetail 對 variants 呼叫 .trim())", () => {
    expect(detailToWord(DETAIL).variants).toBe("resiliently、resilience");
  });

  test("empty inflections become an empty string, never an array", () => {
    const word = detailToWord({ ...DETAIL, inflections: [] });
    expect(word.variants).toBe("");
    expect(typeof word.variants).toBe("string");
  });

  test("a freshly added word is quiz-enabled and not familiar", () => {
    const word = detailToWord(DETAIL);
    expect(word.quizEnabled).toBe(true);
    expect(word.familiarCount).toBe(0);
    expect(word.isFamiliar).toBe(false);
  });

  // 釘住:detailToWord 漏了 folderId 欄位 → 剛加入的字在指派/篩選 UI 拿到 undefined,
  // 送 undefined 給 assignFolder 就變成 422,字當場加不進任何資料夾。
  test("剛生成的字一律未分類", () => {
    expect(detailToWord(DETAIL).folderId).toBeNull();
  });

  test("full mapping shape", () => {
    expect(detailToWord(DETAIL)).toEqual({
      id: DETAIL.id,
      word: "resilient",
      pos: "adj.",
      definition: "able to recover quickly",
      pronunciation: "[rɪˈzɪliənt]",
      etymology: undefined,
      synonyms: ["tough"],
      antonyms: ["fragile"],
      variants: "resiliently、resilience",
      phrases: ["be resilient to"],
      toeic: ["Be resilient."],
      familiarCount: 0,
      isFamiliar: false,
      folderId: null, // CARD / DETAIL 都沒有 folder_id → 未分類
      quizEnabled: true,
    });
  });

  test("does not mutate its input", () => {
    const frozen = Object.freeze({ ...DETAIL, inflections: Object.freeze([...DETAIL.inflections]) });
    expect(() => detailToWord(frozen)).not.toThrow();
  });
});
