import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPrompt } from "./load";
import { SHARED_VARS, STYLES } from "./registry";

const NESTED = /\{\{\{\{LANGUAGE\}\}_(SCRIPT|COPY)\}\}/g;
const varsIn = (p: string) => [...p.replace(NESTED, "").matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);

describe("style registry", () => {
  const withPrompts = STYLES.filter((s) => s.id !== "custom");
  it("has a prompt file for every style and a style for every prompt file", () => {
    const files = readdirSync(new URL("./prompts/", import.meta.url)).map((f) => f.replace(/\.md$/, "")).sort();
    expect(withPrompts.map((s) => s.id).sort()).toEqual(files);
  });
  it.each(withPrompts.map((s) => [s.id, s] as const))("%s: every variable has a source and every field is used", (_id, s) => {
    const p = readPrompt(s.id);
    const known = new Set([...SHARED_VARS, ...s.assetVars, ...s.fields.map((f) => f.key)]);
    for (const v of varsIn(p)) expect(known.has(v), `${s.id}: {{${v}}} has no source`).toBe(true);
    for (const f of s.fields) expect(p.includes(`{{${f.key}}}`), `${s.id}: field ${f.key} unused`).toBe(true);
    expect(Boolean(s.scriptVar)).toBe(/\{\{\{\{LANGUAGE\}\}_(SCRIPT|COPY)\}\}/.test(p));
  });
  it.each(withPrompts.map((s) => [s.id] as const))("%s: prompt is byte-identical to the spec copy", (id) => {
    const spec = readFileSync(new URL(`../../../docs/superpowers/specs/2026-10-01-reel-styles-prompts/${id}.md`, import.meta.url));
    expect(Buffer.from(readPrompt(id)).equals(spec)).toBe(true);
  });
  it("marks exactly the 4 agreed styles as coming soon", () => {
    expect(STYLES.filter((s) => s.status === "coming_soon").map((s) => s.id).sort()).toEqual(["loop-asmr", "presenter", "screen-tutorial", "text-led"]);
  });
});
