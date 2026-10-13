"use server";
import { revalidatePath } from "next/cache";
import { CharacterInputSchema } from "@/lib/character-form";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; errors: string[] };

/** Saves a Soul ID character trained outside the app (its reference id). */
export async function addCharacter(input: unknown): Promise<Result> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) return { ok: false, errors: ["Your session expired. Sign in again."] };
  const parsed = CharacterInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const { error } = await sb.from("soul_characters").insert({ name: parsed.data.name, reference_id: parsed.data.referenceId });
  if (error) return { ok: false, errors: [error.code === "23505" ? "This reference id is already saved." : `Couldn't add the character: ${error.message}`] };
  revalidatePath("/settings/characters");
  return { ok: true };
}
