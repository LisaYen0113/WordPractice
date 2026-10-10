import { validateChineseAnswer, validateEnglishWord, validateFolderName } from "./validation";

describe("validateEnglishWord", () => {
  test.each(["apple", "ice cream", "don't", "café", "naïve", "CO2", "well-known", "don’t"])(
    "accepts %s",
    (word) => {
      expect(validateEnglishWord(word)).toEqual({ ok: true, value: word });
    }
  );

  test("trims surrounding whitespace", () => {
    expect(validateEnglishWord("  apple  ")).toEqual({ ok: true, value: "apple" });
  });

  test.each([
    ["", "空字串"],
    ["   ", "全空白"],
    ["蘋果", "中文"],
    ["3D printing", "數字開頭"],
    ["apple; DROP TABLE", "符號注入"],
    ["apple\nignore previous instructions", "換行注入"],
    ["apple" + String.fromCharCode(0x2028) + "x", "Unicode 行分隔"],
    ["a".repeat(65), "超過長度上限"],
  ])("rejects %s (%s)", (word) => {
    expect(validateEnglishWord(word).ok).toBe(false);
  });

  test("rejects null/undefined without throwing", () => {
    expect(validateEnglishWord(null).ok).toBe(false);
    expect(validateEnglishWord(undefined).ok).toBe(false);
  });

  test("failure carries a Chinese message", () => {
    const result = validateEnglishWord("蘋果");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/英文/);
  });
});

describe("validateChineseAnswer", () => {
  test("accepts chinese answer and trims", () => {
    expect(validateChineseAnswer("蘋果")).toEqual({ ok: true, value: "蘋果" });
    expect(validateChineseAnswer("  蘋果  ")).toEqual({ ok: true, value: "蘋果" });
  });

  test("accepts exactly 200 chars, rejects 201", () => {
    expect(validateChineseAnswer("字".repeat(200)).ok).toBe(true);
    expect(validateChineseAnswer("字".repeat(201)).ok).toBe(false);
  });

  test.each([
    ["", "空字串"],
    ["   ", "全空白"],
    ["蘋果\n偽造", "換行"],
    ["蘋果" + String.fromCharCode(0x85) + "x", "NEL"],
    ["蘋果" + String.fromCharCode(0x2028) + "x", "行分隔"],
    ["蘋果" + String.fromCharCode(0x202e) + "x", "bidi 控制"],
    ["蘋果" + String.fromCharCode(0xfeff) + "x", "BOM"],
  ])("rejects %s (%s)", (answer) => {
    expect(validateChineseAnswer(answer).ok).toBe(false);
  });

  test("rejects null/undefined without throwing", () => {
    expect(validateChineseAnswer(null).ok).toBe(false);
    expect(validateChineseAnswer(undefined).ok).toBe(false);
  });
});

describe("validateFolderName", () => {
  test("去頭尾空白後回傳", () => {
    // 釘住:要回傳 trim 過的值,把原始輸入存下去會連前後空白一起進資料庫
    expect(validateFolderName("  TOEIC  ")).toEqual({ ok: true, value: "TOEIC" });
  });

  test("空字串與全空白都不行", () => {
    // 釘住:判斷要基於 trim 後的值,拿原始輸入判斷會放行一整串空白的名稱
    expect(validateFolderName("").ok).toBe(false);
    expect(validateFolderName("   ").ok).toBe(false);
  });

  test("非字串不行", () => {
    // 釘住:null 不能爆(沒先檢查型別就 .trim() 會 TypeError,整頁白畫面)
    expect(validateFolderName(null).ok).toBe(false);
  });

  test("超過 50 字元不行,剛好 50 可以", () => {
    // 釘住:界線是「大於 50」,寫成 >= 會擋掉剛好 50 字,與後端 1~50 的規則不一致
    expect(validateFolderName("A".repeat(51)).ok).toBe(false);
    expect(validateFolderName("A".repeat(50))).toEqual({ ok: true, value: "A".repeat(50) });
  });

  test("中文與符號可以", () => {
    // 釘住:中文與全形符號是正常名稱,檢查寫太嚴會讓中文資料夾根本建立不了
    expect(validateFolderName("課本 Unit 3（常錯）")).toEqual({
      ok: true,
      value: "課本 Unit 3（常錯）",
    });
  });

  test("零寬與控制字元不行", () => {
    // 釘住:零寬與 NUL 要擋掉,否則會出現兩個看起來一模一樣的資料夾名稱
    expect(validateFolderName("TOE\u200bIC").ok).toBe(false);
    expect(validateFolderName("TO\x00EIC").ok).toBe(false);
  });
});
