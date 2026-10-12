"use server";
import { redirect } from "next/navigation";
import { createReelFromForm } from "@/lib/create-reel";
import { reelDeps } from "@/lib/reel-deps";
import { parseStyleForm, submittedValues } from "@/lib/style-form";
import { createClient } from "@/lib/supabase/server";
import type { NewReelState } from "../actions";

/** On error, `values` echoes what was submitted so the form can restore it after React resets it. */
export type StyleReelState = NewReelState & { values?: Record<string, string> };

export async function createStyleReel(styleId: string, _prev: StyleReelState, fd: FormData): Promise<StyleReelState> {
  const fail = (errors: string[]): StyleReelState => ({ errors, values: submittedValues(fd) });
  const parsed = parseStyleForm(styleId, fd);
  if (!parsed.ok) return fail(parsed.errors);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return fail(["Your session expired. Sign in again."]);

  const result = await createReelFromForm(reelDeps(supabase), parsed.form, { title: parsed.title, styleId });
  if (!result.ok) return fail(result.errors);
  redirect(`/projects/${result.projectId}`);
}
