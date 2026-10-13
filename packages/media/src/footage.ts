import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { runFfmpeg } from "./run";

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const SAMPLE_RATE = 48_000;

/**
 * Cuts the given spans out of the input's audio and joins them, in order. Cuts are sample-exact at 48 kHz (a 30 fps
 * frame is exactly 1600 samples), so the voice stays in sync with the picture over 100+ cuts. Each piece gets a short
 * fade in and out so the joins don't click.
 */
export async function concatAudioSegments(input: string, segments: { inMs: number; outMs: number }[], output: string, fadeMs = 5): Promise<void> {
  if (!segments.length) throw new RangeError("concatAudioSegments needs at least one segment");
  const parts = segments.map((s, i) => {
    if (s.outMs <= s.inMs) throw new RangeError(`segment ${i}: outMs (${s.outMs}) must be greater than inMs (${s.inMs})`);
    const start = Math.round((s.inMs * SAMPLE_RATE) / 1000);
    const end = Math.round((s.outMs * SAMPLE_RATE) / 1000);
    const d = (end - start) / SAMPLE_RATE;
    const fade = Math.min(fadeMs / 1000, d / 4).toFixed(4);
    return `[0:a]aresample=${SAMPLE_RATE},atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${(d - Number(fade)).toFixed(4)}:d=${fade}[a${i}]`;
  });
  const graph = `${parts.join(";")};${segments.map((_, i) => `[a${i}]`).join("")}concat=n=${segments.length}:v=0:a=1[out]`;
  await runFfmpeg(["-i", input, "-filter_complex", graph, "-map", "[out]", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", output]);
}

/** Fits a music track to the reel: loops it if short, trims it if long, and fades out at the end. */
export async function fitMusic(input: string, output: string, durationSec: number, fadeOutSec = 1.5): Promise<void> {
  if (!(durationSec > 0)) throw new RangeError(`durationSec must be > 0, got ${durationSec}`);
  const fade = Math.min(fadeOutSec, durationSec / 2);
  await runFfmpeg([
    "-stream_loop", "-1", "-i", input, "-t", durationSec.toFixed(3), "-vn",
    "-af", `afade=t=out:st=${(durationSec - fade).toFixed(3)}:d=${fade.toFixed(3)},aresample=${SAMPLE_RATE}`,
    "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", output,
  ]);
}
