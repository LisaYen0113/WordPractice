// 展示模式的自評:展示給別人看時完全不呼叫 AI(零成本、即時出結果)。
// 資料庫的單字定義是英文,而測驗輸入是中文 → 本機做字串比對永遠對不上(會整場誤判),
// 因此改由操作者在看過定義後自己按「答對了 / 再想想」,分數照常累計。
// 正式判分仍走後端 AI(/tests/submit_definition)。

export const DEMO_FEEDBACK_CORRECT = "(展示模式)你自己判定答對了。";
export const DEMO_FEEDBACK_WRONG = "(展示模式)再看看下面的單字定義。";

// 回傳形狀刻意對齊後端 POST /tests/submit_definition 的回應(score / is_correct / feedback),
// 讓 TextQuiz 的判分流程可以無痛切換。
export function selfGradeResult(isCorrect) {
  return {
    score: isCorrect ? 1 : 0,
    is_correct: isCorrect,
    feedback: isCorrect ? DEMO_FEEDBACK_CORRECT : DEMO_FEEDBACK_WRONG,
  };
}
