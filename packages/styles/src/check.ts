import type { StyleDef } from "./registry";

export function checkStyleInput(def: StyleDef, raw: Record<string, string>): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const f of def.fields) {
    const v = (raw[f.key] ?? "").trim();
    if (!v) {
      if (f.required) errors.push(`${f.label} is required`);
      continue;
    }
    if (v.length > f.maxLength) errors.push(`${f.label} is too long (max ${f.maxLength} characters)`);
    else if (f.options && !f.options.includes(v)) errors.push(`${f.label} must be one of: ${f.options.join(", ")}`);
    else values[f.key] = v;
  }
  return { values, errors };
}

export function styleTitle(def: StyleDef, values: Record<string, string>): string {
  const v = def.titleField ? values[def.titleField] : undefined;
  return Array.from(v || def.name).slice(0, 120).join("");
}
