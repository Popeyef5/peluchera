import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseTimestamp(ts: number) {
  const date = new Date(ts * 1000);
  const month =
    new Intl.DateTimeFormat("en", { month: "short" }).format(date) + ".";
  const day = date.getDate();
  const suf = (n: number) => {
    const j = n % 10,
      k = n % 100;
    if (j === 1 && k !== 11) return "st";
    if (j === 2 && k !== 12) return "nd";
    if (j === 3 && k !== 13) return "rd";
    return "th";
  };
  return `${month} ${day}${suf(day)}`;
}
