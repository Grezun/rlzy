import { describe, expect, it } from "vitest";
import { baseName, checkExtraFiles, EXTRA_PATH_RE, extraExt, extraKind, extraLabel, extraStoragePath, ExtraUploadSchema, checkFootageFile, footageExt, footageStoragePath, FootageSettingsSchema, FOOTAGE_PATH_RE, formatMinSec } from "./footage-form";

describe("checkFootageFile", () => {
  const ok = { name: "talk.MOV", size: 50_000_000, durationSec: 95 };
  it("accepts an MP4 or MOV under the limits", () => {
    expect(checkFootageFile(ok)).toEqual([]);
    expect(checkFootageFile({ ...ok, name: "a.mp4" })).toEqual([]);
  });
  it("rejects other types, empty and oversized files, and videos over 3:00", () => {
    expect(checkFootageFile({ ...ok, name: "talk.avi" })).toEqual(["Upload an MP4 or MOV video."]);
    expect(checkFootageFile({ ...ok, size: 0 })).toEqual(["This file is empty."]);
    expect(checkFootageFile({ ...ok, size: 2 * 1024 ** 3 + 1 })).toEqual(["This video is over 2 GB. Trim or compress it first."]);
    expect(checkFootageFile({ ...ok, durationSec: 192.4 })).toEqual(["This video is 3:13 long. Trim it to 3:00 or less."]);
  });
  it("allows exactly 3:00 and 2 GB, and skips the length check when the browser can't read it", () => {
    expect(checkFootageFile({ ...ok, size: 2 * 1024 ** 3, durationSec: 180 })).toEqual([]);
    expect(checkFootageFile({ ...ok, durationSec: null })).toEqual([]);
  });
});

describe("footage paths and settings", () => {
  it("builds and recognises the storage path", () => {
    const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
    expect(footageStoragePath(id, "mov")).toBe(`footage/${id}/source.mov`);
    expect(FOOTAGE_PATH_RE.test(footageStoragePath(id, "mp4"))).toBe(true);
    expect(FOOTAGE_PATH_RE.test(`footage/${id}/../x.mp4`)).toBe(false);
    expect(footageExt("A.Mp4")).toBe("mp4");
    expect(footageExt("noext")).toBeNull();
  });
  it("accepts 90 s targets and trims optional text", () => {
    const s = FootageSettingsSchema.parse({ language: "he", targetDurationSec: 90, ctaKeyword: " AI ", notes: " קצר " });
    expect(s).toEqual({ language: "he", targetDurationSec: 90, ctaKeyword: "AI", notes: "קצר" });
    expect(() => FootageSettingsSchema.parse({ language: "he", targetDurationSec: 20 })).toThrow();
    expect(() => FootageSettingsSchema.parse({ language: "he", targetDurationSec: 30, ctaKeyword: "x".repeat(31) })).toThrow();
  });
  it("formats minutes and seconds, rounding up to the whole second", () => {
    expect(formatMinSec(59.9)).toBe("1:00");
    expect(formatMinSec(181)).toBe("3:01");
    expect(formatMinSec(180)).toBe("3:00");
    expect(formatMinSec(95)).toBe("1:35");
  });
  it("never shows a too-long clip as 3:00 (180.4 s reads 3:01)", () => {
    expect(checkFootageFile({ name: "a.mp4", size: 10, durationSec: 180.4 })).toEqual(["This video is 3:01 long. Trim it to 3:00 or less."]);
  });
});

describe("extra uploads", () => {
  const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
  it("accepts up to 6 photos and clips under their limits", () => {
    expect(checkExtraFiles([{ name: "screen.PNG", size: 2_000_000 }, { name: "demo.mov", size: 300_000_000 }])).toEqual([]);
    expect(checkExtraFiles([])).toEqual([]);
  });
  it("rejects other types (with a HEIC hint), oversized and empty files, and a seventh file", () => {
    expect(checkExtraFiles([{ name: "IMG_1.HEIC", size: 1000 }])).toEqual(["IMG_1.HEIC: use a JPG, PNG or WEBP photo (convert HEIC to JPG first), or an MP4 or MOV clip."]);
    expect(checkExtraFiles([{ name: "big.jpg", size: 25 * 1024 ** 2 + 1 }])).toEqual(["big.jpg: photos can be at most 25 MB."]);
    expect(checkExtraFiles([{ name: "long.mp4", size: 500 * 1024 ** 2 + 1 }])).toEqual(["long.mp4: clips can be at most 500 MB."]);
    expect(checkExtraFiles([{ name: "x.png", size: 0 }])).toEqual(["x.png is empty."]);
    expect(checkExtraFiles(Array.from({ length: 7 }, (_, i) => ({ name: `${i}.jpg`, size: 10 })))).toEqual(["Add at most 6 extra files."]);
  });
  it("builds paths, kinds and labels", () => {
    expect(extraStoragePath(id, 3, "jpeg")).toBe(`footage/${id}/extra-3.jpeg`);
    expect(EXTRA_PATH_RE.test(`footage/${id}/extra-6.webp`)).toBe(true);
    expect(EXTRA_PATH_RE.test(`footage/${id}/extra-7.webp`)).toBe(false);
    expect(EXTRA_PATH_RE.test(`footage/${id}/source.mp4`)).toBe(false);
    expect(extraExt("A.JPG")).toBe("jpg");
    expect(extraKind("mov")).toBe("video");
    expect(extraKind("png")).toBe("image");
    expect(extraLabel("my screen recording.mov")).toBe("my screen recording");
    expect(extraLabel(".png")).toBe("Upload");
    expect(baseName(" a.b.mov ", 120, "My video")).toBe("a.b");
    expect(baseName(`${"א".repeat(200)}.mp4`, 120, "My video")).toHaveLength(120);
    expect(baseName(".mp4", 120, "My video")).toBe("My video");
  });
  it("validates an extra upload and the optional character", () => {
    expect(ExtraUploadSchema.parse({ storagePath: `footage/${id}/extra-1.png`, label: " screenshot " }).label).toBe("screenshot");
    expect(() => ExtraUploadSchema.parse({ storagePath: `footage/${id}/extra-1.png`, label: "" })).toThrow();
    expect(FootageSettingsSchema.parse({ language: "he", targetDurationSec: 30, characterId: id }).characterId).toBe(id);
    expect(() => FootageSettingsSchema.parse({ language: "he", targetDurationSec: 30, characterId: "me" })).toThrow();
  });
});
