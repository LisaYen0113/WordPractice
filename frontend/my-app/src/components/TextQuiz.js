import React, { useEffect, useMemo, useRef, useState } from "react";

import { submitDefinition } from "../api/tests";
import {
  createSession,
  currentItem,
  isFinished,
  nextQuestion,
  recordResult,
  summarize,
} from "../quiz/quizSession";
import { selfGradeResult } from "../utils/demoGrading";
import { validateChineseAnswer } from "../utils/validation";
import DemoSelfGrade from "./DemoSelfGrade";
import TextQuizFeedback from "./TextQuizFeedback";
import TextQuizQuestion from "./TextQuizQuestion";
import TextQuizSummary from "./TextQuizSummary";

// 簡單的 SVG 圖標
const Icons = {
  Keyboard: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M6 12h.001"/><path d="M10 12h.001"/><path d="M14 12h.001"/><path d="M18 12h.001"/><path d="M7 16h10"/></svg>
  ),
  Close: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  )
};

/**
 * 英翻中測驗:看英文單字,輸入中文意思,送後端 AI 判分。
 * 流程:answering →(送出/判分中)→ feedback →(下一題)… → summary。
 * 判分失敗可「重試」或「跳過本題」(跳過記為答錯)。
 * 展示模式(demoMode):不判分也不呼叫 AI — 送出後進自評畫面,由操作者對照定義自己判定。
 */
export default function TextQuiz({ words, onClose, demoMode = false }) {
  // 只挑有開啟測驗的字;session 在掛載時固定(不受背景 reload 影響)
  const initialWords = useMemo(() => words.filter((w) => w.quizEnabled), [words]);
  const [session, setSession] = useState(() => createSession(initialWords));
  const [phase, setPhase] = useState("answering"); // answering | selfgrading(展示模式)| feedback | summary
  const [input, setInput] = useState("");
  const [grading, setGrading] = useState(false);
  const [answerError, setAnswerError] = useState(null);
  const [gradeError, setGradeError] = useState(null);
  // 判分逾時:伺服器可能已經記錄 → 不再提供盲重試(重送會重複計分)
  const [gradeUnknown, setGradeUnknown] = useState(false);

  const item = currentItem(session);
  const lastResult = session.results.length > 0 ? session.results[session.results.length - 1] : null;

  // 最新 session 的鏡射:非同步判分回來時,只認「還在同一個字」的結果
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // 前進到下一題;最後一題答完 → 總結
  const advance = (fromSession) => {
    const next = nextQuestion(fromSession);
    setSession(next);
    setInput("");
    setAnswerError(null);
    setGradeError(null);
    setGradeUnknown(false);
    setPhase(isFinished(next) ? "summary" : "answering");
  };

  const submitAnswer = async () => {
    if (grading || !item) return;
    const attemptedId = item.wordId;

    const check = validateChineseAnswer(input);
    if (!check.ok) {
      setAnswerError(check.error);
      return;
    }

    // 展示模式:不判分、不呼叫 AI → 進自評畫面(資料庫的定義是英文,本機比對判不了中文答案)
    if (demoMode) {
      setAnswerError(null);
      setPhase("selfgrading");
      return;
    }

    setGrading(true);
    setAnswerError(null);
    setGradeError(null);
    setGradeUnknown(false);
    try {
      const result = await submitDefinition(attemptedId, check.value);
      // 等待期間題目已被跳過/前進 → 丟棄過期結果,不倒退進度也不記到別題
      if (currentItem(sessionRef.current)?.wordId !== attemptedId) return;
      setSession(
        recordResult(sessionRef.current, {
          score: result.score,
          correct: result.is_correct,
          feedback: result.feedback,
          userInput: check.value,
        })
      );
      setPhase("feedback");
    } catch (err) {
      // 同上的過期保護:使用者已跳過這題,就不該再冒出這題的錯誤
      if (currentItem(sessionRef.current)?.wordId !== attemptedId) return;
      if (err?.code === "TIMEOUT") {
        // 請求已送出但 60 秒內沒回應 → 後端可能判完也記分了,盲重試會重複計分
        setGradeUnknown(true);
        setGradeError("判分等太久,結果可能已經記錄。請按「跳過本題」繼續。");
      } else {
        setGradeError(err?.message || "判分失敗,請稍後再試");
      }
    } finally {
      setGrading(false);
    }
  };

  // 展示模式的自評結果:操作者看過定義後自己按對/錯,用與後端相同的形狀記錄
  const handleSelfGrade = (isCorrect) => {
    if (!item) return;
    const result = selfGradeResult(isCorrect);
    setSession(
      recordResult(session, {
        score: result.score,
        correct: result.is_correct,
        feedback: result.feedback,
        userInput: input.trim(),
      })
    );
    setPhase("feedback");
  };

  const handleNext = () => advance(session);

  const handleSkip = () => {
    if (!item) return;
    // AI 沒判成 → 記為答錯(score 0 / 無回饋),不卡住整場測驗
    advance(
      recordResult(session, {
        score: 0,
        correct: false,
        feedback: null,
        userInput: input.trim(),
      })
    );
  };

  const showSummary = phase === "summary" || !item;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-100 dark:bg-[#0d1410] p-4 animate-in fade-in duration-300">
      <div className="relative w-full max-w-lg bg-white dark:bg-[#122017] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200 dark:border-[#29382f]">

        {/* Header - 使用 Blue 色系區隔 */}
        <header className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-[#29382f]">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
               <Icons.Keyboard />
             </div>
             <div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white leading-none">英翻中拼寫</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-medium">看英文,輸入中文意思</p>
                {demoMode && (
                  <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">展示模式(不呼叫 AI)</p>
                )}
             </div>
          </div>
          <button
             onClick={onClose}
             aria-label="關閉測驗"
             className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-[#29382f] text-zinc-400 dark:text-zinc-500 transition-colors"
          >
             <Icons.Close />
          </button>
        </header>

        {/* Content Body */}
        <div className="p-6 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
          {showSummary ? (
            <TextQuizSummary
              summary={summarize(session)}
              results={session.results}
              onClose={onClose}
            />
          ) : phase === "selfgrading" ? (
            <DemoSelfGrade item={item} answer={input} onChoose={handleSelfGrade} />
          ) : phase === "feedback" && lastResult ? (
            <TextQuizFeedback
              item={item}
              result={lastResult}
              isLast={isFinished(nextQuestion(session))}
              onNext={handleNext}
              demoMode={demoMode}
            />
          ) : (
            <TextQuizQuestion
              item={item}
              index={session.index}
              total={session.items.length}
              value={input}
              onChange={(value) => {
                setInput(value);
                setAnswerError(null);
              }}
              onSubmit={submitAnswer}
              pending={grading}
              error={answerError}
              gradeError={gradeError}
              onRetry={submitAnswer}
              onSkip={handleSkip}
              canRetry={!gradeUnknown}
            />
          )}
        </div>

      </div>
    </div>
  );
}
