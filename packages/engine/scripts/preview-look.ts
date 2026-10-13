/**
 * Free local preview of the footage look: no API keys and no paid calls. It renders the look sample timeline with a
 * lavfi test video as the speaker and a landscape checker-gradient still as the B-roll (shown whole over its blurred
 * fill, so the Ken Burns drift and the fill's parallax are visible), then one contact sheet per language.
 *   npm run preview:look   →   work/stills/look/he-01.png … he-08.png, he-sheet.png (and en-…)
 */
import { makeTestVideo, runFfmpeg } from "@reel/media";
import { renderReelStill } from "@reel/video/render";
import { LOOK_FRAMES, sampleLookTimeline } from "@reel/video/sample-footage";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveDir } from "../src/serve";

async function main() {
  const out = resolve("work/stills/look");
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "look-"));
  try {
    await makeTestVideo(join(dir, "speaker.mp4"), { durationSec: 7 });
    // 120 px checkers over a diagonal gradient: any zoom, drift or parallax shows as moving edges.
    const checker = "if(mod(floor(X/120)+floor(Y/120),2),255,60)";
    await runFfmpeg([
      "-f", "lavfi", "-i", "color=c=black:size=1920x1080",
      "-vf", `geq=r='${checker}*X/W':g='${checker}*(1-X/W)':b='${checker}*Y/H'`, "-frames:v", "1", join(dir, "still.png"),
    ]);
    await renderSheets(out, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function renderSheets(out: string, dir: string) {
  const server = await serveDir(dir);
  try {
    for (const lang of ["he", "en"] as const) {
      const timeline = sampleLookTimeline(lang, { videoSrc: server.urlFor("speaker.mp4"), imageSrc: server.urlFor("still.png") });
      for (const [i, [name, frame]] of LOOK_FRAMES.entries()) {
        const file = join(out, `${lang}-${String(i + 1).padStart(2, "0")}.png`);
        await renderReelStill(timeline, file, frame);
        console.log(`${file}  (${name}, frame ${frame})`);
      }
      const sheet = join(out, `${lang}-sheet.png`);
      await runFfmpeg(["-framerate", "1", "-i", join(out, `${lang}-%02d.png`), "-vf", "scale=270:-1,tile=4x2", "-frames:v", "1", sheet]);
      console.log(sheet);
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
