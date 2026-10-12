import type { Word } from "./schema/timeline";

export const BEAT_PAUSE_MS = 600;
export const BEAT_MAX_MS = 10_000;
export const BEAT_MIN_MS = 1200;
export type BeatSpan = { id: string; startWordIdx: number; endWordIdx: number };

/** Sentence-final punctuation (Latin and Hebrew), optionally followed by closing quotes/brackets. Shared with caption paging. */
export const SENTENCE_END_RE = /[.!?…׃]["'״”’)\]]*$/u;
type Group = [number, number]; // inclusive word indices

const durationOf = (words: Word[], [a, b]: Group) => words[b].endMs - words[a].startMs;
const gapAfter = (words: Word[], i: number) => words[i + 1].startMs - words[i].endMs;

function splitLong(words: Word[], g: Group): Group[] {
  if (g[1] === g[0] || durationOf(words, g) <= BEAT_MAX_MS) return [g];
  let at = g[0];
  for (let i = g[0]; i < g[1]; i++) if (gapAfter(words, i) > gapAfter(words, at)) at = i;
  return [...splitLong(words, [g[0], at]), ...splitLong(words, [at + 1, g[1]])];
}

/** Code-side beat splitting (spec §4.3): sentences and long pauses, long beats split, short beats merged. */
export function splitBeats(words: Word[]): BeatSpan[] {
  if (!words.length) return [];
  let groups: Group[] = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const last = i === words.length - 1;
    if (last || SENTENCE_END_RE.test(words[i].text) || gapAfter(words, i) >= BEAT_PAUSE_MS) {
      groups.push([start, i]);
      start = i + 1;
    }
  }
  groups = groups.flatMap((g) => splitLong(words, g));
  for (;;) {
    const i = groups.findIndex((g) => durationOf(words, g) < BEAT_MIN_MS);
    if (i < 0 || groups.length === 1) break;
    const before = i > 0 ? words[groups[i][0]].startMs - words[groups[i - 1][1]].endMs : Infinity;
    const after = i < groups.length - 1 ? words[groups[i + 1][0]].startMs - words[groups[i][1]].endMs : Infinity;
    if (before <= after) groups.splice(i - 1, 2, [groups[i - 1][0], groups[i][1]]);
    else groups.splice(i, 2, [groups[i][0], groups[i + 1][1]]);
  }
  return groups.map(([a, b], i) => ({ id: `b${i + 1}`, startWordIdx: a, endWordIdx: b }));
}
