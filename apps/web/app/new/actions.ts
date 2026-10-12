"use server";
import { redirect } from "next/navigation";
import { createReelFromForm } from "@/lib/create-reel";
import { parsePlanForm } from "@/lib/plan-form";
import { reelDeps } from "@/lib/reel-deps";
import { createClient } from "@/lib/supabase/server";

export type NewReelState = { errors?: string[] };

export async function createReel(_prev: NewReelState, formData: FormData): Promise<NewReelState> {
  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { errors: ["Your session expired. Sign in again."] };

  const result = await createReelFromForm(reelDeps(supabase), parsed.form);
  if (!result.ok) return { errors: result.errors };
  redirect(`/projects/${result.projectId}`);
}
