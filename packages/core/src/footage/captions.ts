import { SENTENCE_END_RE } from "../beats";
import type { Word } from "../schema/timeline";
import type { EditStyle } from "./style";

export type ReelWord = Word & { idx: number; beatId: string };

/** Characters a viewer sees: combining marks (niqqud, cantillation) don't take width; maqaf and emoji count once. */
export const visibleLength = (text: string) => [...text.normalize("NFC").replace(/\p{M}/gu, "")].length;

const CLAUSE_END = /[,;:،]["'״”’)\]]*$/u;

/** Caption pages (spec §5.6): about 3 words, at most captionMaxChars, breaking at punctuation first, never across beats. */
export function pageWords(words: ReelWord[], style: Pick<EditStyle, "captionMaxChars" | "captionMaxWords">): ReelWord[][] {
  const pages: ReelWord[][] = [];
  let page: ReelWord[] = [];
  const text = (ws: ReelWord[]) => ws.map((w) => w.text).join(" ");
  for (const w of words) {
    if (page.length && (page[0].beatId !== w.beatId || page.length >= style.captionMaxWords || visibleLength(text([...page, w])) > style.captionMaxChars)) {
      pages.push(page);
      page = [];
    }
    page.push(w);
    if (SENTENCE_END_RE.test(w.text) || (CLAUSE_END.test(w.text) && page.length >= 2)) {
      pages.push(page);
      page = [];
    }
  }
  if (page.length) pages.push(page);
  return pages;
}
