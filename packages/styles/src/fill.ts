import { ASSET_PLACEHOLDER, SHARED_VARS, type StyleDef } from "./registry";

export type FillInput = {
  values: Record<string, string>;
  script?: string;
  language: "he" | "en";
  durationSec: number;
  accentColor: string;
  voiceDescription: string;
};

export function fillTemplate(prompt: string, def: StyleDef, input: FillInput): string {
  const shared: Record<(typeof SHARED_VARS)[number], string> = {
    LANGUAGE: input.language === "he" ? "Hebrew" : "English",
    DURATION: String(input.durationSec),
    DURATION_SECONDS: String(input.durationSec),
    ACCENT_COLOR: input.accentColor,
    VOICE: input.voiceDescription,
    VOICE_STYLE: input.voiceDescription,
  };
  const fieldKeys = new Set(def.fields.map((f) => f.key));
  const script = input.script?.trim() ? input.script : "not provided: draft one";
  // One pass over the original prompt, so text inside substituted values is never re-read as a variable.
  return prompt.replace(/\{\{\{\{LANGUAGE\}\}_(?:SCRIPT|COPY)\}\}|\{\{([A-Z_]+)\}\}/g, (match, name: string | undefined) => {
    if (name === undefined) return script;
    if (name in shared) return shared[name as keyof typeof shared];
    if (def.assetVars.includes(name)) return ASSET_PLACEHOLDER;
    if (fieldKeys.has(name)) return input.values[name]?.trim() || "not provided";
    throw new Error(`Style ${def.id}: template variable {{${name}}} has no source`);
  });
}
