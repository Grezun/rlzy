import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "./run";

/** Synthetic fixtures generated with lavfi, so no binary media is committed. */
export async function makeTestVideo(
  out: string,
  { durationSec = 2, width = 1080, height = 1920, fps = 30, withAudio = false } = {},
): Promise<void> {
  await runFfmpeg([
    "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSec}`,
    ...(withAudio ? ["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${durationSec}`] : []),
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ...(withAudio ? ["-c:a", "aac", "-shortest"] : []),
    out,
  ]);
}

export async function makeTestTone(
  out: string,
  { durationSec = 2, volumeDb = -20, trailingSilenceSec = 0 } = {},
): Promise<void> {
  await runFfmpeg([
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    "-af", `volume=${volumeDb}dB,apad=pad_dur=${trailingSilenceSec}`,
    "-c:a", "pcm_s16le", out,
  ]);
}

export async function makeTestImage(out: string, { width = 1080, height = 1920, color = "blue" } = {}): Promise<void> {
  await runFfmpeg(["-f", "lavfi", "-i", `color=c=${color}:size=${width}x${height}`, "-frames:v", "1", out]);
}

/** Short sine blips standing in for the sound-effect pack (tests and the fake worker). */
export async function makeSfxPlaceholders(dir: string, names: readonly string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [i, name] of names.entries()) {
    await runFfmpeg([
      "-f", "lavfi", "-i", `sine=frequency=${600 + i * 120}:sample_rate=48000:duration=0.25`,
      "-af", "volume=-12dB,afade=t=out:st=0.15:d=0.1", "-c:a", "pcm_s16le", join(dir, `${name}.wav`),
    ]);
  }
}

/** Average luma (0–255) of an image, via FFmpeg's signalstats. */
export async function averageLuma(image: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-i", image, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]);
  const match = stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  if (!match) throw new Error(`no YAVG in ffmpeg output for ${image}`);
  return Number(match[1]);
}
