import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { concatAudioSegments, fitMusic, sha256File } from "./footage";
import { probe } from "./probe";
import { averageLuma, makeSfxPlaceholders, makeTestImage, makeTestTone } from "./testing";

const dir = () => mkdtemp(join(tmpdir(), "media-footage-"));

describe("footage audio", () => {
  it("joins segments into one 48 kHz track whose length is the sum of the segments", async () => {
    const d = await dir();
    await makeTestTone(join(d, "src.wav"), { durationSec: 4 });
    const segs = [{ inMs: 0, outMs: 866.667 }, { inMs: 1466.667, outMs: 3566.667 }, { inMs: 3600, outMs: 3700 }];
    await concatAudioSegments(join(d, "src.wav"), segs, join(d, "out.wav"));
    const info = await probe(join(d, "out.wav"));
    expect(info.audio?.sampleRate).toBe(48000);
    expect(info.durationSec).toBeCloseTo((866.667 + 2100 + 100) / 1000, 2);
  });
  it("rejects no segments and reversed segments", async () => {
    const d = await dir();
    await makeTestTone(join(d, "src.wav"), { durationSec: 1 });
    await expect(concatAudioSegments(join(d, "src.wav"), [], join(d, "o.wav"))).rejects.toThrow(/at least one segment/);
    await expect(concatAudioSegments(join(d, "src.wav"), [{ inMs: 500, outMs: 400 }], join(d, "o.wav"))).rejects.toThrow(/outMs/);
  });
  it("loops a short music track and trims a long one to the reel", async () => {
    const d = await dir();
    await makeTestTone(join(d, "short.wav"), { durationSec: 2 });
    await fitMusic(join(d, "short.wav"), join(d, "looped.wav"), 5);
    expect((await probe(join(d, "looped.wav"))).durationSec).toBeCloseTo(5, 1);
    await makeTestTone(join(d, "long.wav"), { durationSec: 10 });
    await fitMusic(join(d, "long.wav"), join(d, "trimmed.wav"), 3);
    expect((await probe(join(d, "trimmed.wav"))).durationSec).toBeCloseTo(3, 1);
  });
  it("hashes a file like createHash does", async () => {
    const d = await dir();
    await writeFile(join(d, "x.bin"), "hello");
    expect(await sha256File(join(d, "x.bin"))).toBe(createHash("sha256").update(await readFile(join(d, "x.bin"))).digest("hex"));
  });
});

describe("test helpers", () => {
  it("writes one short placeholder tone per sound effect", async () => {
    const d = await dir();
    await makeSfxPlaceholders(d, ["pop1", "tick"]);
    const info = await probe(join(d, "pop1.wav"));
    expect(info.durationSec).toBeGreaterThan(0.1);
    expect(info.durationSec).toBeLessThan(0.6);
  });
  it("measures average luma", async () => {
    const d = await dir();
    await makeTestImage(join(d, "white.png"), { width: 64, height: 64, color: "white" });
    await makeTestImage(join(d, "black.png"), { width: 64, height: 64, color: "black" });
    expect(await averageLuma(join(d, "white.png"))).toBeGreaterThan(230);
    expect(await averageLuma(join(d, "black.png"))).toBeLessThan(25);
  });
});
