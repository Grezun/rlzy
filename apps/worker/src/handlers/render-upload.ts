import { BUCKETS, renderPaths } from "@reel/db";
import type { RenderOutputs } from "@reel/engine";
import type { BlobStore } from "../storage";

/** Uploads a finished render's deliverables to the renders bucket and returns their storage paths. */
export async function uploadRender(blobs: BlobStore, projectId: string, version: number, out: Pick<RenderOutputs, "reel" | "preview" | "thumbnail" | "srt">) {
  const paths = renderPaths(projectId, version);
  await blobs.upload(BUCKETS.renders, paths.reel, out.reel, "video/mp4");
  await blobs.upload(BUCKETS.renders, paths.preview, out.preview, "video/mp4");
  await blobs.upload(BUCKETS.renders, paths.thumbnail, out.thumbnail, "image/jpeg");
  await blobs.upload(BUCKETS.renders, paths.srt, out.srt, "application/x-subrip");
  return paths;
}
