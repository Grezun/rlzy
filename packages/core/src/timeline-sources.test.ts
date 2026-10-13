import { describe, expect, it } from "vitest";
import { assetSrc, mapTimelineSources, timelineAssetFiles } from "./timeline-sources";
import type { Timeline } from "./schema/timeline";

const timeline = (): Timeline => ({
  fps: 30, width: 1080, height: 1920, durationInFrames: 60, language: "he", direction: "rtl",
  style: { captionPreset: "bold_pop", font: "Heebo", palette: ["#FFE14D"] },
  audio: { voiceUrl: assetSrc("v.wav"), musicDuckingDb: -18 },
  clips: [
    { sceneId: "s1", kind: "image", src: assetSrc("a.png"), fromFrame: 0, durationInFrames: 30, motion: "none", transitionIn: "cut" },
    { sceneId: "s2", kind: "graphic", fromFrame: 30, durationInFrames: 30, motion: "none", transitionIn: "cut" },
    { sceneId: "s3", kind: "video", src: "https://already/abs.mp4", fromFrame: 30, durationInFrames: 30, motion: "none", transitionIn: "cut" },
  ],
  captions: { words: [] },
  overlays: [],
});

describe("timeline sources", () => {
  it("lists referenced asset files once each", () => {
    expect(timelineAssetFiles(timeline()).sort()).toEqual(["a.png", "v.wav"]);
  });
  it("resolves asset: refs and leaves other srcs alone", () => {
    const t = mapTimelineSources(timeline(), (f) => `https://signed/${f}`);
    expect(t.audio.voiceUrl).toBe("https://signed/v.wav");
    expect(t.clips.map((c) => c.src)).toEqual(["https://signed/a.png", undefined, "https://already/abs.mp4"]);
    expect(t.audio.musicUrl).toBeUndefined();
  });
  it("lists and maps sound-effect sources", () => {
    const withSfx: Timeline = { ...timeline(), sfx: [{ name: "pop1", frame: 3, src: "asset:p.wav", volumeDb: -12 }] };
    expect(timelineAssetFiles(withSfx).sort()).toEqual(["a.png", "p.wav", "v.wav"]);
    const mapped = mapTimelineSources(withSfx, (f) => `https://signed/${f}`);
    expect(mapped.sfx).toEqual([{ name: "pop1", frame: 3, src: "https://signed/p.wav", volumeDb: -12 }]);
  });
  it("adds no sfx key to a timeline without sound effects", () => {
    const mapped = mapTimelineSources(timeline(), (f) => `https://signed/${f}`);
    expect("sfx" in mapped).toBe(false);
  });
  it("includes and maps cutaway media, never diagrams", () => {
    const t = { ...timeline(), cutaways: [
      { id: "b1", fromFrame: 0, durationInFrames: 30, layout: "full" as const, media: { kind: "video" as const, src: "asset:c.mp4", fit: "cover" as const } },
      { id: "b2", fromFrame: 30, durationInFrames: 30, layout: "split" as const, media: { kind: "diagram" as const, template: "list" as const, items: ["a", "b"] } },
    ] };
    expect(timelineAssetFiles(t)).toContain("c.mp4");
    expect(mapTimelineSources(t, (f) => `http://x/${f}`).cutaways![0].media).toMatchObject({ src: "http://x/c.mp4" });
  });
});
