// 後端 snake_case → 前端元件形狀。純函式、不改輸入。

export function cardToWord(card) {
  const score = card.familiarity_score ?? 0;
  return {
    id: card.word_id,
    word: card.word,
    pos: card.pos,
    definition: card.definition,
    pronunciation: card.kk_pronunciation,
    etymology: card.etymology ?? undefined,
    synonyms: card.synonyms ?? [],
    toeic: card.toeic_examples ?? [],
    familiarCount: score,
    // 分頁過濾與詳情按鈕都靠這個欄位;必須在這裡就從伺服器分數推導,
    // 否則 deck 載入的字一律被當成未熟悉(列上有綠勾、卻在「未學習」分頁)
    isFamiliar: score > 0,
    folderId: card.folder_id ?? null, // 未分類是 null
    quizEnabled: false, // 測驗開關是 session-local,重整後重設
  };
}

export function detailToWord(detail) {
  return {
    id: detail.id,
    word: detail.word,
    pos: detail.pos,
    definition: detail.definition,
    pronunciation: detail.kk_pronunciation,
    etymology: detail.etymology ?? undefined,
    synonyms: detail.synonyms ?? [],
    antonyms: detail.antonyms ?? [],
    // WordDetail 會對 variants 呼叫 .trim() → 必須是字串,不能給陣列
    variants: (detail.inflections ?? []).join("、"),
    phrases: detail.phrases ?? [],
    toeic: detail.toeic_examples ?? [],
    familiarCount: 0,
    isFamiliar: false, // 剛生成的字一定未熟悉
    folderId: null, // 剛加入的字一律未分類
    quizEnabled: true, // 剛加入的字直接開放測驗(沿用原本的加入體驗)
  };
}
