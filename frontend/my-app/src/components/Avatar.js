/**
 * 圓形頭像:顯示 email 首字(大寫)。取代原本永遠 404 的 /avatar.png。
 * className 覆寫尺寸/字級(預設 36px)。
 */
export default function Avatar({ email = "", className = "h-9 w-9 text-sm" }) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-emerald-500 font-semibold text-white ${className}`}
    >
      {initial}
    </span>
  );
}
