export const normalizeScript = (s: string) =>
  s.normalize("NFC").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/\s+/g, " ").trim();

const show = (c: string | undefined) => (c === undefined ? "(end)" : `"${c}" (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`);

/** Exact-script check: the scenes, joined, must equal the user's script (whitespace and invisible marks aside). */
export function scriptMatches(expected: string, scenes: string[]): { ok: true } | { ok: false; diff: string } {
  const want = Array.from(normalizeScript(expected));
  const got = Array.from(normalizeScript(scenes.join(" ")));
  if (want.length === got.length && want.every((c, k) => c === got[k])) return { ok: true };
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  const ctx = (a: string[]) => a.slice(Math.max(0, i - 40), i + 40).join("");
  return {
    ok: false,
    diff: `The scenes differ from the script at character ${i + 1}. Expected ${show(want[i])}, found ${show(got[i])}.\nScript:  …${ctx(want)}…\nScenes:  …${ctx(got)}…`,
  };
}
