import { mapTimelineSources, TimelineSchema, timelineAssetFiles, type Timeline } from "@reel/core";
import { BUCKETS, type Database } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

export interface SigningClient {
  createSignedUrls(bucket: string, paths: string[], expiresIn: number): Promise<Record<string, string>>;
  createSignedUrl(bucket: string, path: string, expiresIn: number, download?: string): Promise<string>;
}

export type SignedRender = { reelUrl: string; previewUrl: string; thumbnailUrl: string; srtUrl?: string; timeline: Timeline };

export async function signRender(
  client: SigningClient,
  render: { reel_path: string; preview_path: string; thumbnail_path: string; srt_path?: string | null; timeline: unknown },
): Promise<SignedRender> {
  const timeline = TimelineSchema.parse(render.timeline);
  const files = timelineAssetFiles(timeline);
  const urls = files.length ? await client.createSignedUrls(BUCKETS.assets, files, SIGNED_URL_TTL_SECONDS) : {};
  const missing = files.filter((f) => !urls[f]);
  if (missing.length) throw new Error(`Preview media is missing from storage: ${missing.join(", ")}`);
  const [reelUrl, previewUrl, thumbnailUrl, srtUrl] = await Promise.all([
    client.createSignedUrl(BUCKETS.renders, render.reel_path, SIGNED_URL_TTL_SECONDS, "reel.mp4"),
    client.createSignedUrl(BUCKETS.renders, render.preview_path, SIGNED_URL_TTL_SECONDS),
    client.createSignedUrl(BUCKETS.renders, render.thumbnail_path, SIGNED_URL_TTL_SECONDS),
    render.srt_path ? client.createSignedUrl(BUCKETS.renders, render.srt_path, SIGNED_URL_TTL_SECONDS, "reel.srt") : Promise.resolve(undefined),
  ]);
  return { reelUrl, previewUrl, thumbnailUrl, srtUrl, timeline: mapTimelineSources(timeline, (f) => urls[f]) };
}

export function supabaseSigningClient(sb: SupabaseClient<Database>): SigningClient {
  return {
    async createSignedUrls(bucket, paths, expiresIn) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrls(paths, expiresIn);
      if (error) throw new Error(`signing ${bucket} failed: ${error.message}`);
      const out: Record<string, string> = {};
      for (const d of data ?? []) if (d.signedUrl && !d.error && d.path) out[d.path] = d.signedUrl;
      return out;
    },
    async createSignedUrl(bucket, path, expiresIn, download) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn, download ? { download } : undefined);
      if (error || !data) throw new Error(`signing ${bucket}/${path} failed: ${error?.message ?? "no data"}`);
      return data.signedUrl;
    },
  };
}
