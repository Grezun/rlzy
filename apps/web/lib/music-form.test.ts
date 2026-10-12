import { describe, expect, it } from "vitest";
import { checkMusicFile, MusicTrackInputSchema, musicStoragePath } from "./music-form";

const ID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
describe("music form", () => {
  it("accepts mp3/wav/m4a/aac up to 100 MB and 15 minutes", () => {
    expect(checkMusicFile({ name: "beat.MP3", size: 5_000_000, durationSec: 120 })).toEqual([]);
    expect(checkMusicFile({ name: "beat.flac", size: 5_000_000, durationSec: 120 })).toEqual(["Upload an MP3, WAV, M4A or AAC file."]);
    expect(checkMusicFile({ name: "a.mp3", size: 101 * 1024 * 1024, durationSec: 120 })).toEqual(["This track is over 100 MB."]);
    expect(checkMusicFile({ name: "a.mp3", size: 1000, durationSec: 901 })).toEqual(["This track is over 15 minutes."]);
  });
  it("validates the row the server inserts", () => {
    expect(musicStoragePath(ID, "mp3")).toBe(`music/${ID}.mp3`);
    expect(MusicTrackInputSchema.parse({ storagePath: `music/${ID}.mp3`, title: " Lo-fi ", mood: "calm", durationSec: 95.4 }).title).toBe("Lo-fi");
    expect(() => MusicTrackInputSchema.parse({ storagePath: "footage/x.mp3", title: "x", mood: "calm", durationSec: 9 })).toThrow();
    expect(() => MusicTrackInputSchema.parse({ storagePath: `music/${ID}.mp3`, title: "x", mood: "sad", durationSec: 9 })).toThrow();
  });
});
