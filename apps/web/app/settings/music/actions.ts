"use server";
import { revalidatePath } from "next/cache";
import { MusicTrackInputSchema } from "@/lib/music-form";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; errors: string[] };

/** Records a track the browser already uploaded to storage. */
export async function addMusicTrack(input: unknown): Promise<Result> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) return { ok: false, errors: ["Your session expired. Sign in again."] };
  const parsed = MusicTrackInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const { storagePath, title, mood, durationSec } = parsed.data;
  const { error } = await sb.from("team_music").insert({ storage_path: storagePath, title, mood, duration_sec: durationSec });
  if (error) return { ok: false, errors: [`Couldn't add the track: ${error.message}`] };
  revalidatePath("/settings/music");
  return { ok: true };
}
