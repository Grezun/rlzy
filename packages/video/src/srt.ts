import type { Word } from "@reel/core";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { COMBINE_MS, wordsToCaptions } from "./Captions";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function formatSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
}

function twoLines(text: string): string {
  if (text.length <= 42) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** Subtitle cues that match the burned-in caption pages exactly (same grouping and timing as Captions.tsx). */
export function buildSrt(words: Word[]): string {
  if (!words.length) return "";
  const { pages } = createTikTokStyleCaptions({ captions: wordsToCaptions(words), combineTokensWithinMilliseconds: COMBINE_MS });
  return pages
    .map((page, i) => {
      const end = pages[i + 1]?.startMs ?? page.startMs + page.durationMs;
      const text = page.tokens.map((t) => t.text.trim()).filter(Boolean).join(" ");
      return `${i + 1}\n${formatSrtTime(page.startMs)} --> ${formatSrtTime(end)}\n${twoLines(text)}\n`;
    })
    .join("\n");
}
