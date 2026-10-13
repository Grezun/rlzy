/**
 * Free local preview of background replacement: no API keys and no paid calls.
 *   npm run preview:background                          the fixture clip (or a test video) over a test scene
 *   npm run preview:background -- <video> [<image>]     your own clip (first 8 s) over your own image (a missing clip exits 1)
 * It uses Apple Vision when npm run build:segment-helper (and build:face-helper) were run; otherwise the fake ellipse.
 * Writes work/stills/background/: plate-01…04.png, matte-01…04.png and sheet.png (plates on top, mattes below), then
 * look-01…08.png and look-sheet.png (the Hebrew look sample with the plate as the speaker).
 */
import { RawFaceTrackSchema, smoothFaceTrack } from "@reel/core";
import {
  compositeSpeakerPlate, faceHelperAvailable, FIXTURE_TALKING_HEAD, makeEllipseMatte, makeMatte, makeTestVideo, matteCoverage, runFaceHelper, runFfmpeg, segmentHelperAvailable,
} from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { renderReelStill } from "@reel/video/render";
import { LOOK_FRAMES, sampleLookTimeline } from "@reel/video/sample-footage";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { serveDir } from "../src/serve";

const STILL_SECONDS = [0.5, 2, 3.5, 5];

async function main() {
  const [videoArg, imageArg] = process.argv.slice(2);
  if (videoArg && !existsSync(resolve(videoArg))) {
    console.error(`no such file: ${resolve(videoArg)}`);
    process.exit(1);
  }
  const out = resolve("work/stills/background");
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "bg-preview-"));
  try {
    let source = videoArg ? resolve(videoArg) : FIXTURE_TALKING_HEAD;
    // Only with no clip given: the fixture, or a generated test video when the fixture isn't checked out.
    if (!videoArg && !existsSync(source)) {
      source = join(dir, "test.mp4");
      await makeTestVideo(source, { durationSec: 7 });
    }
    // The working copy, as ingest makes it (first 8 s, 1080×1920, 30 fps).
    const working = join(dir, "working.mp4");
    await runFfmpeg(["-i", source, "-t", "8", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", working]);
    let faces: string | undefined;
    if (faceHelperAvailable()) {
      faces = join(dir, "faces.json");
      await writeFile(faces, JSON.stringify(smoothFaceTrack(RawFaceTrackSchema.parse(await runFaceHelper(working)))));
    }
    const matte = join(dir, "matte.mp4");
    const vision = segmentHelperAvailable();
    const started = Date.now();
    if (vision) await makeMatte(working, matte, { faces });
    else await makeEllipseMatte(working, matte);
    console.log(`cut-out: ${vision ? `Apple Vision${faces ? " + face region" : " (no face helper: whole matte kept)"}` : "fake ellipse (run npm run build:segment-helper for the real one)"}, ${((Date.now() - started) / 1000).toFixed(1)} s, coverage ${((await matteCoverage(matte)) * 100).toFixed(0)} %`);
    const scene = join(dir, `scene${imageArg ? extname(imageArg) : ".png"}`);
    if (imageArg) await copyFile(resolve(imageArg), scene);
    else await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=s=1080x1920", "-frames:v", "1", scene]);
    const plate = join(dir, "plate.mp4");
    await compositeSpeakerPlate({ video: working, matte, backgrounds: [{ image: scene, fromMs: 0 }], out: plate, look: houseStyle.edit.background, tmpDir: join(dir, "t") });
    for (const [i, sec] of STILL_SECONDS.entries()) {
      const n = String(i + 1).padStart(2, "0");
      await runFfmpeg(["-ss", String(sec), "-i", plate, "-frames:v", "1", join(out, `plate-${n}.png`)]);
      await runFfmpeg(["-ss", String(sec), "-i", matte, "-frames:v", "1", join(out, `matte-${n}.png`)]);
    }
    await runFfmpeg([
      "-framerate", "1", "-i", join(out, "plate-%02d.png"), "-framerate", "1", "-i", join(out, "matte-%02d.png"),
      "-filter_complex", "[0:v]scale=270:-1,tile=4x1[a];[1:v]scale=270:-1,tile=4x1[b];[a][b]vstack", "-frames:v", "1", join(out, "sheet.png"),
    ]);
    console.log(join(out, "sheet.png"));
    const server = await serveDir(dir);
    try {
      const timeline = sampleLookTimeline("he", { videoSrc: server.urlFor("plate.mp4"), imageSrc: server.urlFor(basename(scene)) });
      for (const [i, [name, frame]] of LOOK_FRAMES.entries()) {
        const file = join(out, `look-${String(i + 1).padStart(2, "0")}.png`);
        await renderReelStill(timeline, file, frame);
        console.log(`${file}  (${name}, frame ${frame})`);
      }
    } finally {
      await server.close();
    }
    await runFfmpeg(["-framerate", "1", "-i", join(out, "look-%02d.png"), "-vf", "scale=270:-1,tile=4x2", "-frames:v", "1", join(out, "look-sheet.png")]);
    console.log(join(out, "look-sheet.png"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
