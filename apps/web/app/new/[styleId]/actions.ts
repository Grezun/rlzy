"use server";
import { redirect } from "next/navigation";
import { createReelFromForm } from "@/lib/create-reel";
import { reelDeps } from "@/lib/reel-deps";
import { parseStyleForm } from "@/lib/style-form";
import { createClient } from "@/lib/supabase/server";
import type { NewReelState } from "../actions";

export async function createStyleReel(styleId: string, _prev: NewReelState, fd: FormData): Promise<NewReelState> {
  const parsed = parseStyleForm(styleId, fd);
  if (!parsed.ok) return { errors: parsed.errors };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { errors: ["Your session expired. Sign in again."] };

  const result = await createReelFromForm(reelDeps(supabase), parsed.form, { title: parsed.title, styleId });
  if (!result.ok) return { errors: result.errors };
  redirect(`/projects/${result.projectId}`);
}
