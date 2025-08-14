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

export function effectiveCommission(
  gameState: [number, number],
  roundInfo: [number, number]
): number {
  const [maxFee, feeGrowth] = roundInfo;
  const [played, won] = gameState;

  if (played === 0) return 0;
  if (won === 0) return played;

  return Math.min((maxFee * played) / 100, (feeGrowth * (played - won)) / 100);
}

export function marginalMultiplier(
  gameState: [number, number],
  roundInfo: [number, number]
): number {
  const [played, won] = gameState;
  const commission = effectiveCommission([played + 1, won + 1], roundInfo);
  const loot = played + 1 - commission;

  return loot / (won + 1);
}

export function currentPayout(
  gameState: [number, number],
  roundInfo: [number, number],
  playerWon: number
): number {
  const [played, won] = gameState;
  const commission = effectiveCommission(gameState, roundInfo);
  const loot = played - commission;
  return (playerWon * loot) / Math.max(won, 1);
}
