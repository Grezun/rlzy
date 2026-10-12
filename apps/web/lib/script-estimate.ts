import { estimateSceneSeconds, LENGTH_TOLERANCE } from "@reel/core";

export function describeScriptLength(script: string, language: "he" | "en", targetSec: number): { text: string; tooLong: boolean } | null {
  if (!script.trim()) return null;
  const raw = estimateSceneSeconds(script, language);
  const tooLong = raw > targetSec * LENGTH_TOLERANCE;
  const base = `≈ ${Math.round(raw)} s of speech`;
  return { text: tooLong ? `${base}; longer than your ${targetSec} s target` : base, tooLong };
}
