// 前端預檢:對齊後端限制,先擋掉明顯無效的輸入,免得白打一趟 422。
// 後端仍是最終裁判(app/schemas/words.py、app/schemas/test.py)。

const MAX_WORD_LENGTH = 64;
const MAX_ANSWER_LENGTH = 200;

// 首字必須是字母,其後可字母 / 數字 / 空白 / ' / - / ’(對齊後端的 EnglishWord pattern)
const ENGLISH_WORD_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ][A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ0-9 '’-]*$/;

// 後端不允許的隱形/控制字元(C0、DEL、C1、零寬、bidi、行分隔、BOM)
// 以碼位組字串再建 regex,避免在原始碼放不好辨識的 escape
const UNSAFE_CODEPOINTS = [
  ...Array.from({ length: 32 }, (_, i) => i), // 0x00–0x1F
  0x7f, // DEL
  ...Array.from({ length: 32 }, (_, i) => 0x80 + i), // 0x80–0x9F
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, // 零寬與方向標記
  0x2028, 0x2029, // 行 / 段落分隔
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, // bidi 控制
  0x2060, // word joiner
  0xfeff, // BOM
];

const UNSAFE_CHAR_PATTERN = new RegExp(
  "[" + UNSAFE_CODEPOINTS.map((c) => String.fromCharCode(c)).join("") + "]"
);

export function validateEnglishWord(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "只能輸入英文字" };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: "請先輸入單字" };
  }
  if (value.length > MAX_WORD_LENGTH) {
    return { ok: false, error: `單字最多 ${MAX_WORD_LENGTH} 個字元` };
  }
  if (!ENGLISH_WORD_PATTERN.test(value)) {
    return { ok: false, error: "只能輸入英文字(僅限字母、空白、' 與 -)" };
  }
  return { ok: true, value };
}

export function validateChineseAnswer(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "請先輸入中文意思" };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: "請先輸入中文意思" };
  }
  if (value.length > MAX_ANSWER_LENGTH) {
    return { ok: false, error: `答案最多 ${MAX_ANSWER_LENGTH} 個字元` };
  }
  if (UNSAFE_CHAR_PATTERN.test(value)) {
    return { ok: false, error: "答案含有不允許的字元" };
  }
  return { ok: true, value };
}
