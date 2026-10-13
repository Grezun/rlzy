import { TranscriptSchema, type Transcript } from "@reel/core";
import { BUCKETS, type Database } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server only. The worker mirrors each asset to the `assets` bucket under the file name it records in the `assets`
 * index (transcripts are `<hash>.data`), so look the object up there rather than guessing its name.
 */
export async function loadTranscript(sb: SupabaseClient<Database>, hash: string): Promise<Transcript> {
  const { data: row, error: lookupError } = await sb.from("assets").select("storage_path").eq("input_hash", hash).maybeSingle();
  if (lookupError) throw new Error(`Couldn't look up the transcript: ${lookupError.message}`);
  if (!row) throw new Error("The transcript is missing from the asset index. Upload the video again.");
  const { data, error } = await sb.storage.from(BUCKETS.assets).download(row.storage_path);
  if (error || !data) throw new Error(`The transcript is missing from storage (${error?.message ?? "no data"}).`);
  return TranscriptSchema.parse(JSON.parse(await data.text()));
}
