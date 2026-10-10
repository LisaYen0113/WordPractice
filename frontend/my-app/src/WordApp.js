import React, { useMemo, useState } from "react";

import { detailToWord } from "./api/mappers";
import { fillWord } from "./api/words";
import { useAuth } from "./auth/AuthContext";
import AddWord from "./components/AddWord";
import DemoBanner from "./components/DemoBanner";
import Header from "./components/Header";
import Heatmap from "./components/Heatmap";
import PairQuiz from "./components/PairQuiz";
import QuizLauncher from "./components/QuizLauncher";
import { EmptyState, ErrorState, LoadingState } from "./components/StateViews";
import Tabs from "./components/Tabs";
import TextQuiz from "./components/TextQuiz";
import WordDetail from "./components/WordDetail";
import WordRow from "./components/WordRow";
import useReviewWords from "./hooks/useReviewWords";
import { isGuestAccount, readDemoMode, readGuestSession, writeDemoMode, writeGuestSession } from "./utils/demoMode";

// 簡單的 SVG 圖標
const Icons = {
  Play: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
  ),
};

// 熱力圖真資料需要新的每日紀錄表(不在這次範圍)→ 固定空物件。
// 放模組層:參考穩定,Heatmap 不會因每次 render 的新物件而重算。
const NO_RECORDS = {};

/**
 * 登入後的主畫面:單字清單(deck)、新增單字、詳情、測驗入口。
 * 資料來自 useReviewWords(deck + 伺服器端熟悉度)。
 */
export default function WordApp() {
  const { user, signOut } = useAuth();
  const {
    status,
    words,
    error,
    reload,
    upsertWord,
    toggleQuiz,
    setFamiliarity,
    familiarPending,
    familiarErrors,
  } = useReviewWords();

  const [tab, setTab] = useState("new");
  const [selectedId, setSelectedId] = useState(null);
  const [showQuizLauncher, setShowQuizLauncher] = useState(false);
  const [quizMode, setQuizMode] = useState(null);
  // 訪客 session = demo 帳號 + 訪客入口留下的標記(標記載 localStorage,跨分頁可靠)。
  // demo 帳號直接登入(沒標記,例如業主管理字庫)→ 不強制,可正常使用
  const guestSession = isGuestAccount(user?.email) && readGuestSession();
  // 展示模式:F5 還在(sessionStorage 讀回);給別人看時所有 AI 呼叫停用。
  // 訪客 session 一律強制展示:旗標存 sessionStorage(每分頁獨立),訪客開新分頁讀不到旗標,
  // 靠跨分頁的訪客標記補回來 — 新分頁也進不了 AI 開啟的正常模式
  const [demoMode, setDemoMode] = useState(() => readDemoMode() || guestSession);

  // 展示模式切換:一併寫回 sessionStorage(F5 還在);用明值 setter,避免非同步連點用舊布林翻錯
  // 訪客 session 關掉展示 = 交還裝置 → 清旗標與標記後登出,不讓訪客留在 AI 開啟的正常模式
  const setDemo = (on) => {
    if (!on && guestSession) {
      writeDemoMode(false);
      writeGuestSession(false);
      signOut();
      return;
    }
    writeDemoMode(on);
    setDemoMode(on);
  };

  // isFamiliar 由 mapper 從伺服器 familiarCount 推導(>0)
  const displayedWords = useMemo(
    () => words.filter((w) => (tab === "new" ? !w.isFamiliar : w.isFamiliar)),
    [words, tab]
  );

  // 詳情存 id、每次 render 從最新的 words 派生:
  // 標記熟悉後同一筆資料更新,詳情頁的熟悉度會立即同步,不會拿到舊物件
  const selected = words.find((w) => w.id === selectedId) ?? null;
  const quizWordCount = words.filter((w) => w.quizEnabled).length;

  const handleAdd = async (text) => {
    // 展示模式不該新增單字(輸入框已停用;這裡再擋一層,確保不會有任何 AI 呼叫)
    if (demoMode) return;
    const raw = await fillWord(text);
    // 先驗原始回應再進 mapper:後端降級(id:null)或空回應都會讓 mapper 炸掉。
    // 沒有 id 就無法標記/測驗,不進清單。
    if (!raw || raw.id == null) {
      throw new Error("生成成功但沒有存進清單,請稍後再試一次");
    }
    upsertWord(detailToWord(raw));
  };

  const goPrevNext = (delta) => {
    if (!selected) return;
    const index = displayedWords.findIndex((w) => w.id === selected.id);
    if (index === -1) return; // 剛標記熟悉、字已移到另一個分頁 → 停在目前這筆
    const nextIndex = (index + delta + displayedWords.length) % displayedWords.length;
    setSelectedId(displayedWords[nextIndex].id);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden box-border bg-zinc-50 dark:bg-[#0d1410] text-zinc-900 dark:text-zinc-100 font-sans selection:bg-zinc-200 dark:selection:bg-[#29382f] transition-colors duration-300">
      <div className="w-full max-w-3xl mx-auto px-4 py-6 sm:py-8 flex flex-col gap-6 sm:gap-8 pb-24">

        {/* 展示模式提示條 */}
        {demoMode && <DemoBanner onExit={() => setDemo(false)} />}

        {/* Header 區域 */}
        <Header
          email={user?.email ?? ""}
          onSignOut={signOut}
          demoMode={demoMode}
          onToggleDemo={() => setDemo(!demoMode)}
          isGuest={guestSession}
        />

        {/* 數據概覽區域(熱力圖真資料待後端支援,先顯示空卡片) */}
        <section className="bg-white dark:bg-[#122017] rounded-2xl shadow-sm border border-zinc-200 dark:border-[#29382f] p-4 overflow-hidden">
           <Heatmap days={91} records={NO_RECORDS} />
        </section>

        {/* 主要操作區域 */}
        <div className="flex flex-col gap-4 w-full">
          <AddWord onAdd={handleAdd} demoMode={demoMode} />
          <Tabs tab={tab} setTab={setTab} />
        </div>

        {/* 單字列表區域 */}
        <div className="flex flex-col gap-3 min-h-[200px] w-full">
          {status === "error" ? (
            <ErrorState message={error} onRetry={reload} />
          ) : status === "loading" && words.length === 0 ? (
            <LoadingState />
          ) : displayedWords.length > 0 ? (
            displayedWords.map((w) => (
              <WordRow
                key={w.id}
                w={w}
                onClick={(word) => setSelectedId(word.id)}
                toggleQuiz={toggleQuiz}
              />
            ))
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      {/* 底部懸浮按鈕:開始測驗 */}
      {quizWordCount > 0 && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center pointer-events-none z-40 px-4">
          <button
            className="pointer-events-auto flex items-center gap-2 px-6 py-3 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-[#0d1410] font-bold shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 border border-transparent dark:border-zinc-200 max-w-full truncate"
            onClick={() => setShowQuizLauncher(true)}
          >
            <Icons.Play />
            <span>開始測驗 ({quizWordCount})</span>
          </button>
        </div>
      )}

      {/* 測驗選擇 Modal */}
      {showQuizLauncher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="w-full max-w-md bg-white dark:bg-[#122017] rounded-2xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-[#29382f]">
              <QuizLauncher
                wordCount={quizWordCount}
                setStep={(step) => {
                  if (step === "home") setShowQuizLauncher(false);
                }}
                startQuiz={(mode) => {
                  setShowQuizLauncher(false);
                  setQuizMode(mode);
                }}
              />
           </div>
        </div>
      )}

      {/* 單字詳情 Modal */}
      {selected && (
        <WordDetail
          word={selected}
          isFamiliar={selected.isFamiliar}
          isFamiliarPending={Boolean(familiarPending[selected.id])}
          familiarError={familiarErrors[selected.id] ?? null}
          onClose={() => setSelectedId(null)}
          toggleFamiliar={() => setFamiliarity(selected.id, !selected.isFamiliar)}
          onPrev={() => goPrevNext(-1)}
          onNext={() => goPrevNext(1)}
        />
      )}

      {/* 測驗模式 (全螢幕覆蓋)— 白名單:未知值不該蓋出無法關閉的覆蓋層 */}
      {["pair", "text"].includes(quizMode) && (
        <div className="fixed inset-0 z-[60] bg-zinc-50 dark:bg-[#0d1410]">
          {quizMode === "pair" && <PairQuiz words={words} onClose={() => setQuizMode(null)} />}
          {quizMode === "text" && <TextQuiz words={words} onClose={() => setQuizMode(null)} demoMode={demoMode} />}
        </div>
      )}
    </div>
  );
}
