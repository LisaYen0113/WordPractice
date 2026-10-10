// 資料夾篩選。純函式、不改輸入。
// selection 有三態:"all" | "uncategorized" | 某個資料夾的 id

export const ALL_FOLDERS = "all";
export const UNCATEGORIZED = "uncategorized";

export function filterByFolder(words, selection) {
  if (selection === ALL_FOLDERS) {
    return words;
  }
  if (selection === UNCATEGORIZED) {
    return words.filter((word) => !word.folderId);
  }
  return words.filter((word) => word.folderId === selection);
}

// chip 上的字數。前端手上已有完整 deck(上限 200 筆),自己算就好,不必多打 API
export function countByFolder(words) {
  return words.reduce((counts, word) => {
    const key = word.folderId ?? UNCATEGORIZED;
    return { ...counts, [key]: (counts[key] ?? 0) + 1 };
  }, {});
}
