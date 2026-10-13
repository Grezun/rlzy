import { footageDurationMs, LENGTH_TOLERANCE, parseEditPlan, type Cutaway, type EditPlan, type EditStyle, type Word } from "@reel/core";

export type PlanAction =
  | { type: "toggleKeep"; beatId: string }
  | { type: "setEmphasis"; beatId: string; wordIdx: number | null }
  | { type: "setEmoji"; beatId: string; emoji: string }
  | { type: "setColdOpen"; beatId: string | null }
  | { type: "setHeadline"; small: string; big: string }
  | { type: "setPatternBreak"; value: "zoom_hit" | "flash" | "broll" | "none" }
  | { type: "setCutaway"; beatId: string; cutaway: Cutaway | null }
  | { type: "setCharacter"; character: { id: string; name: string } | null }
  | { type: "setReason"; reason: string }
  | { type: "setEnding"; ending: EditPlan["ending"] }
  | { type: "setMusic"; music: EditPlan["music"] }
  | { type: "setSfx"; sfx: EditPlan["sfx"] };

type Beat = EditPlan["beats"][number];
const withBeat = (p: EditPlan, id: string, f: (b: Beat) => Beat): EditPlan => ({ ...p, beats: p.beats.map((b) => (b.id === id ? f(b) : b)) });
const without = <T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> => {
  const { [k]: _drop, ...rest } = o;
  return rest;
};

export function editPlan(plan: EditPlan, a: PlanAction): EditPlan {
  switch (a.type) {
    case "toggleKeep": {
      const next = withBeat(plan, a.beatId, (b) => ({ ...b, keep: !b.keep }));
      const cold = next.hook.coldOpenBeatId;
      return cold && !next.beats.find((b) => b.id === cold)?.keep ? { ...next, hook: without(next.hook, "coldOpenBeatId") } : next;
    }
    case "setEmphasis":
      return withBeat(plan, a.beatId, (b) =>
        a.wordIdx !== null && a.wordIdx >= b.startWordIdx && a.wordIdx <= b.endWordIdx ? { ...b, emphasisWordIdx: a.wordIdx } : without(b, "emphasisWordIdx"));
    case "setEmoji":
      return withBeat(plan, a.beatId, (b) => (a.emoji.trim() ? { ...b, emoji: a.emoji } : without(b, "emoji")));
    case "setColdOpen":
      return { ...plan, hook: a.beatId ? { ...plan.hook, coldOpenBeatId: a.beatId } : without(plan.hook, "coldOpenBeatId") };
    case "setHeadline":
      return { ...plan, hook: { ...plan.hook, headline: { small: a.small, big: a.big } } };
    case "setPatternBreak":
      return { ...plan, hook: { ...plan.hook, patternBreak: a.value } };
    case "setCutaway":
      return withBeat(plan, a.beatId, (b) => (a.cutaway ? { ...b, cutaway: a.cutaway } : without(b, "cutaway")));
    case "setCharacter":
      return a.character ? { ...plan, character: a.character } : without(plan, "character");
    case "setReason":
      return { ...plan, hook: { ...plan.hook, reason: a.reason } };
    case "setEnding":
      return { ...plan, ending: a.ending };
    case "setMusic":
      return { ...plan, music: a.music };
    case "setSfx":
      return { ...plan, sfx: a.sfx };
  }
}

const trimCutaway = (c: Cutaway): Cutaway => {
  const s = c.source;
  if (s.kind === "ai_broll" || s.kind === "ai_self") return { ...c, source: { ...s, prompt: s.prompt.trim() } };
  if (s.kind === "diagram") return { ...c, source: { ...s, items: s.items.map((t) => t.trim()).filter(Boolean) } };
  return c;
};

/** Trims text and turns an empty headline into "no headline" (the schema requires a present headline's big line). */
export function normalizePlanForSave(plan: EditPlan): EditPlan {
  const h = plan.hook.headline;
  const hook = h && h.big.trim() ? { ...plan.hook, headline: { small: h.small.trim(), big: h.big.trim() } } : without(plan.hook, "headline");
  return {
    ...plan,
    hook: { ...hook, reason: plan.hook.reason.trim() },
    beats: plan.beats.map((b) => {
      const e = b.emoji !== undefined && !b.emoji.trim() ? without(b, "emoji") : b;
      return e.cutaway ? { ...e, cutaway: trimCutaway(e.cutaway) } : e;
    }),
  };
}

export type EditPlanCheck = { ok: true; plan: EditPlan } | { ok: false; errors: string[] };

export function checkEditPlan(input: unknown): EditPlanCheck {
  try {
    const raw = input && typeof input === "object" && "hook" in input && "beats" in input ? normalizePlanForSave(input as EditPlan) : input;
    return { ok: true, plan: parseEditPlan(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lines = message.split("\n").slice(1).map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
    return { ok: false, errors: lines.length ? lines : ["Invalid edit plan."] };
  }
}

export function describeFootageLength(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source" | "targetDurationSec">, words: Word[], style: EditStyle): { text: string; tooLong: boolean } {
  const seconds = Math.round(footageDurationMs(plan, words, style) / 1000);
  const tooLong = seconds > plan.targetDurationSec * LENGTH_TOLERANCE;
  const base = `Length ≈ ${seconds} s (target ${plan.targetDurationSec} s)`;
  return { text: tooLong ? `${base}: over the target; drop beats to shorten it.` : base, tooLong };
}
