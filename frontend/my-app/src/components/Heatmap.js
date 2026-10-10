import React, { useMemo } from "react";

const Icons = {
  Flame: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-orange-500"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.38 0 2.5-1.12 2.5-2.5 0-1.38-1.12-2.5-2.5-2.5a2.5 2.5 0 0 0-2.5 2.5m2.5 5.5A5.5 5.5 0 0 1 5.5 14.5c0-2.28 1.4-4.25 3.4-5.1C7 7.57 7 5.25 7 5.25c2 1.33 5 4.86 5 9.25a5.5 5.5 0 0 1-5.5 5.5m5.5-16c-3 2.1-6 5.5-6 9.5 0 4.14 3.36 7.5 7.5 7.5S20 16.64 20 12.5c0-4-3-7.4-6-9.5z"/></svg>
  )
};

export default function Heatmap({ days = 91, records = {} }) {
  // 91天剛好是 13 週 (7 * 13)，排版會比較整齊
  const grid = useMemo(() => {
    const arr = [];
    const today = new Date();
    // 調整順序，讓今天在最後面，或者根據需求反轉
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      arr.push({ key, val: records[key] || 0 });
    }
    return arr;
  }, [days, records]);

  // 根據次數決定顏色等級
  const getColorClass = (val) => {
    if (val === 0) return "bg-zinc-100 dark:bg-[#29382f]";
    if (val < 2) return "bg-emerald-200 dark:bg-[#3d5245]";
    if (val < 5) return "bg-emerald-400 dark:bg-[#5c7a6b]";
    return "bg-emerald-500 dark:bg-[#4ade80] shadow-[0_0_8px_rgba(74,222,128,0.4)]"; // 最高級發光
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Title */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-sm font-bold text-zinc-700 dark:text-zinc-200">
          <Icons.Flame />
          <span>學習熱力圖</span>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">Last {days} days</span>
      </div>

      {/* Grid Container */}
      {/* 使用 flex-wrap 搭配 gap 讓它自動適應寬度，比固定 grid-cols 更安全 */}
      <div className="flex flex-wrap content-start gap-[3px] sm:gap-1">
        {grid.map((c) => (
          <div
            key={c.key}
            title={`${c.key}: ${c.val} words`}
            className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-sm transition-all duration-300 hover:scale-125 hover:z-10 cursor-help ${getColorClass(c.val)}`}
          />
        ))}
      </div>

      {/* Legend (圖例) */}
      <div className="flex items-center justify-end gap-2 text-[10px] text-zinc-400 dark:text-zinc-500 px-1 mt-1">
        <span>Less</span>
        <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-sm bg-zinc-100 dark:bg-[#29382f]"></div>
            <div className="w-2.5 h-2.5 rounded-sm bg-emerald-200 dark:bg-[#3d5245]"></div>
            <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400 dark:bg-[#5c7a6b]"></div>
            <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500 dark:bg-[#4ade80]"></div>
        </div>
        <span>More</span>
      </div>
    </div>
  );
}