import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/** Copies a JPEG with an EXIF orientation tag added (6 = a portrait phone photo stored landscape). Tests only. */
export async function addExifOrientation(input: string, output: string, orientation: number): Promise<void> {
  const jpeg = await readFile(input);
  // Big-endian TIFF: header (8 bytes), one IFD with one entry (Orientation, SHORT, count 1), then "no next IFD".
  const tiff = Buffer.alloc(26);
  tiff.write("MM\0*", 0, "latin1");
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  // Right after the SOI marker (the first 2 bytes).
  await writeFile(output, Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]));
}

/** The RGB of one frame region (an 8x8 crop at fraction fx, fy of the frame, averaged to one pixel) at `sec`. Tests only. */
export async function pixelRgb(video: string, dir: string, sec: number, fx: number, fy: number): Promise<number[]> {
  const out = join(dir, `px-${sec}-${fx}-${fy}.rgb`);
  await runFfmpeg(["-ss", String(sec), "-i", video, "-vf", `crop=8:8:iw*${fx}:ih*${fy},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", out]);
  return [...(await readFile(out))];
}
