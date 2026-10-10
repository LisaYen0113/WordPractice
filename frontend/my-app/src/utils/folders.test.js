import { ALL_FOLDERS, UNCATEGORIZED, countByFolder, filterByFolder } from "./folders";

const WORDS = [
  { id: "w-1", folderId: "f-a" },
  { id: "w-2", folderId: null },
  { id: "w-3", folderId: "f-b" },
  { id: "w-4", folderId: "f-a" },
  { id: "w-5" }, // 舊資料沒有這個欄位 → 視為未分類
];

describe("filterByFolder", () => {
  test("all 回傳原陣列(不做多餘的複製)", () => {
    // 釘住:選「全部」要短路回傳同一個陣列,多繞一層複製會讓呼叫端的參照比對失效
    expect(filterByFolder(WORDS, ALL_FOLDERS)).toBe(WORDS);
  });

  test("uncategorized 只留沒有資料夾的字", () => {
    // 釘住:folderId 是 null 或整個欄位不存在(舊資料)都算未分類,漏掉一種就會少字
    expect(filterByFolder(WORDS, UNCATEGORIZED).map((w) => w.id)).toEqual(["w-2", "w-5"]);
  });

  test("指定資料夾 id 只留該資料夾的字", () => {
    // 釘住:要比對精準的資料夾 id,用寬鬆比對會把其他資料夾的字一起撈進來
    expect(filterByFolder(WORDS, "f-a").map((w) => w.id)).toEqual(["w-1", "w-4"]);
  });

  test("不存在的資料夾回空陣列(不回退成全部)", () => {
    // 釘住:不存在的資料夾要回空陣列,不能回退成全部(資料夾剛被刪掉時會突然看到整個字庫)
    expect(filterByFolder(WORDS, "f-gone")).toEqual([]);
  });

  test("不改輸入(凍結整個陣列,原地改寫會直接爆)", () => {
    // freeze 單一元素只擋得到「改欄位」,擋不到 splice / push / length = 這種原地改寫;
    // 要凍結的是陣列本身。selection 用不匹配的 id,否則「清空再把符合的塞回去」
    // 這種 bug 會湊巧通過 —— 這正是這個測試要釘的東西。
    const input = Object.freeze([
      { id: "w-1", folderId: "f-a" },
      { id: "w-2", folderId: "f-b" },
    ]);

    const result = filterByFolder(input, "f-gone");

    expect(result).toEqual([]);
    expect(result).not.toBe(input); // 回傳的必須是新陣列,不是被掏空的原陣列
    expect(input.map((w) => w.id)).toEqual(["w-1", "w-2"]);
  });
});

describe("countByFolder", () => {
  test("分別算出每個資料夾與未分類的字數", () => {
    // 釘住:未分類要算在 uncategorized 這個鍵上,不能變成 null / undefined 的鍵讓 chip 少一顆
    expect(countByFolder(WORDS)).toEqual({ "f-a": 2, "f-b": 1, [UNCATEGORIZED]: 2 });
  });

  test("空清單回空物件", () => {
    // 釘住:空 deck 是初次載入的常態,reduce 沒給初始值會直接 TypeError
    expect(countByFolder([])).toEqual({});
  });
});
