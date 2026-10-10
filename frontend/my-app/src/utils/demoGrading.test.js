import {
  DEMO_FEEDBACK_CORRECT,
  DEMO_FEEDBACK_WRONG,
  selfGradeResult,
} from "./demoGrading";

test("自評答對 → 滿分 + is_correct + 展示文案", () => {
  expect(selfGradeResult(true)).toEqual({
    score: 1,
    is_correct: true,
    feedback: DEMO_FEEDBACK_CORRECT,
  });
});

test("自評答錯 → 0 分 + is_correct false + 展示文案", () => {
  expect(selfGradeResult(false)).toEqual({
    score: 0,
    is_correct: false,
    feedback: DEMO_FEEDBACK_WRONG,
  });
});

test("回傳形狀對齊後端 POST /tests/submit_definition(score / is_correct / feedback)", () => {
  expect(Object.keys(selfGradeResult(true)).sort()).toEqual([
    "feedback",
    "is_correct",
    "score",
  ]);
});
