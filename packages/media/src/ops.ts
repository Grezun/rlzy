import { probe } from "./probe";
import { runFfmpeg } from "./run";

export const MAX_SLOWDOWN = 1.15;
const H264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p"];

export async function conformVideo(input: string, output: string, opts: { keepAudio?: boolean } = {}): Promise<void> {
  const vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p";
  await runFfmpeg([
    "-i", input, "-vf", vf, ...H264,
    ...(opts.keepAudio ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : ["-an"]),
    "-movflags", "+faststart", output,
  ]);
}

/** Extra uploads: fit inside 1080×1920 keeping the whole picture (Remotion fits it to its slot), 30 fps, no audio, first maxSec only. */
export async function conformClip(input: string, output: string, maxSec = 10): Promise<void> {
  const vf = "scale=w=1080:h=1920:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1,format=yuv420p";
  await runFfmpeg(["-i", input, "-t", String(maxSec), "-vf", vf, ...H264, "-an", "-movflags", "+faststart", output]);
}

/** Long side of an extra photo: 2× the reel's 1080 width is plenty for a Ken Burns push, and keeps renders light. */
export const PHOTO_MAX_SIDE = 2160;

/**
 * Extra photos: re-encoded upright. ffmpeg applies the EXIF orientation when decoding (ffprobe reports the raw,
 * unrotated size), and the output carries no orientation tag, so its probed size is the size the reel shows.
 * Large photos are scaled down (after the rotation) so the long side is at most PHOTO_MAX_SIDE; never upscaled.
 */
export async function conformPhoto(input: string, output: string): Promise<void> {
  const m = PHOTO_MAX_SIDE;
  const vf = `scale=w='min(${m},iw)':h='min(${m},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  await runFfmpeg(["-i", input, "-vf", vf, "-frames:v", "1", ...(output.endsWith(".jpg") ? ["-q:v", "2"] : []), output]);
}

export async function fitDuration(input: string, output: string, targetSec: number): Promise<void> {
  if (!(targetSec > 0)) throw new RangeError(`targetSec must be > 0, got ${targetSec}`);
  const { durationSec } = await probe(input);
  const filters: string[] = [];
  if (durationSec < targetSec) {
    const factor = Math.min(MAX_SLOWDOWN, targetSec / durationSec);
    filters.push(`setpts=${factor.toFixed(4)}*PTS`);
    const slowed = durationSec * factor;
    if (slowed < targetSec) filters.push(`tpad=stop_mode=clone:stop_duration=${(targetSec - slowed + 0.2).toFixed(3)}`);
  }
  filters.push("fps=30", "format=yuv420p");
  await runFfmpeg(["-i", input, "-vf", filters.join(","), "-t", targetSec.toFixed(3), "-an", ...H264, "-movflags", "+faststart", output]);
}

export async function extractAudio(input: string, output: string): Promise<void> {
  await runFfmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output]);
}

export async function sliceAudio(input: string, output: string, startMs: number, endMs: number): Promise<void> {
  if (endMs <= startMs) throw new RangeError(`endMs (${endMs}) must be greater than startMs (${startMs})`);
  const af = `atrim=start=${(startMs / 1000).toFixed(3)}:end=${(endMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS`;
  await runFfmpeg(["-i", input, "-vn", "-af", af, "-c:a", "pcm_s16le", output]);
}

/** Removes silence at the END only; leading audio is untouched so word timestamps stay valid. */
export async function trimTrailingSilence(input: string, output: string): Promise<void> {
  const af = "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse";
  await runFfmpeg(["-i", input, "-vn", "-af", af, "-c:a", "pcm_s16le", output]);
}
