const normalize = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Exact-script check: the scenes, joined, must equal the user's script (whitespace aside). */
export function scriptMatches(expected: string, scenes: string[]): { ok: true } | { ok: false; diff: string } {
  const want = normalize(expected);
  const got = normalize(scenes.join(" "));
  if (want === got) return { ok: true };
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  const ctx = (s: string) => s.slice(Math.max(0, i - 40), i + 40);
  return { ok: false, diff: `The scenes differ from the script at character ${i + 1}.\nScript:  …${ctx(want)}…\nScenes:  …${ctx(got)}…` };
}
