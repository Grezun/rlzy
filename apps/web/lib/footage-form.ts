import { FootageSettingsSchema, type FootageSettings } from "@reel/core";

/** The "Edit my video" form fields; empty optionals are dropped. */
export function parseFootageSettings(fd: FormData): { ok: true; settings: FootageSettings } | { ok: false; errors: string[] } {
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const parsed = FootageSettingsSchema.safeParse({
    language: str("language"),
    targetDurationSec: Number(str("targetDurationSec")),
    ...(str("ctaKeyword") ? { ctaKeyword: str("ctaKeyword") } : {}),
    ...(str("characterId") ? { characterId: str("characterId") } : {}),
    ...(str("notes") ? { notes: str("notes") } : {}),
  });
  return parsed.success
    ? { ok: true, settings: parsed.data }
    : { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`) };
}
