import { readFileSync } from "node:fs";

/** Node only: the verbatim prompt template for a style. */
export function readPrompt(id: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`invalid style id "${id}"`);
  return readFileSync(new URL(`./prompts/${id}.md`, import.meta.url), "utf8");
}
