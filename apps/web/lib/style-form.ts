import { PlanFormSchema, type PlanForm } from "@reel/core";
import { checkStyleInput, getStyle, styleTitle } from "@reel/styles";

export function parseStyleForm(styleId: string, fd: FormData): { ok: true; form: PlanForm; title: string } | { ok: false; errors: string[] } {
  const def = getStyle(styleId);
  if (!def || def.status !== "available" || def.id === "custom") return { ok: false, errors: ["This style is not available."] };
  const str = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  const raw = Object.fromEntries(def.fields.map((f) => [f.key, str(`field.${f.key}`)]));
  const { values, errors } = checkStyleInput(def, raw);
  if (errors.length) return { ok: false, errors };
  const script = str("script").trim();
  const title = styleTitle(def, values);
  const voiceId = str("voiceId").trim();
  const parsed = PlanFormSchema.safeParse({
    brief: Array.from(`${def.name}: ${title}`).slice(0, 2000).join(""),
    language: str("language"),
    targetDurationSec: Number(str("targetDurationSec")),
    pacing: str("pacing"),
    captionPreset: str("captionPreset"),
    palette: [str("color1"), str("color2")].filter(Boolean),
    ...(voiceId ? { voiceId } : {}),
    style: { id: def.id, values, ...(script ? { script } : {}) },
  });
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`) };
  return { ok: true, form: parsed.data, title };
}

/** The text values the user submitted, echoed back on a failed submit so React's form reset does not wipe them. */
export function submittedValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
