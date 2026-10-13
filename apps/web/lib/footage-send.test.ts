import { describe, expect, it, vi } from "vitest";
import type { FinishResult } from "./create-footage";
import { forgetUploadsAfter, retryLabel, sendFootage, uploadAll } from "./footage-send";

const steps = (finish: () => Promise<FinishResult>, upload: () => Promise<void> = async () => {}) => ({
  upload: vi.fn(upload), finish: vi.fn(finish), onUploaded: vi.fn(),
});

describe("sendFootage", () => {
  it("uploads, then records the upload", async () => {
    const s = steps(async () => ({ ok: true }));
    expect(await sendFootage(s, false)).toEqual({ kind: "done" });
    expect(s.upload).toHaveBeenCalledOnce();
    expect(s.onUploaded).toHaveBeenCalledOnce();
    expect(s.finish).toHaveBeenCalledOnce();
  });

  it("offers Resume upload when the upload stops, without recording anything", async () => {
    const s = steps(async () => ({ ok: true }), async () => { throw new Error("network down"); });
    const o = await sendFootage(s, false);
    expect(o).toEqual({ kind: "interrupted", errors: [expect.stringMatching(/^Upload interrupted: network down\. .*Resume upload/)] });
    expect(retryLabel(o)).toBe("Resume upload");
    expect(s.onUploaded).not.toHaveBeenCalled();
    expect(s.finish).not.toHaveBeenCalled();
  });

  it("after the upload completed and recording failed, Try again records again and never re-uploads", async () => {
    const results: FinishResult[] = [{ ok: false, errors: ["Couldn't start: timeout"] }, { ok: true }];
    const s = steps(async () => results.shift()!);
    const first = await sendFootage(s, false);
    expect(first).toEqual({ kind: "failed", errors: ["Couldn't start: timeout"], uploaded: true });
    expect(retryLabel(first)).toBe("Try again");
    // The form passes uploaded = true once onUploaded has fired.
    expect(await sendFootage(s, true)).toEqual({ kind: "done" });
    expect(s.upload).toHaveBeenCalledOnce();
    expect(s.finish).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown record call as retryable without re-uploading", async () => {
    const s = steps(async () => { throw new Error("fetch failed"); });
    const o = await sendFootage(s, true);
    expect(o).toEqual({ kind: "failed", errors: ["Couldn't record the upload: fetch failed"], uploaded: true });
    expect(s.upload).not.toHaveBeenCalled();
  });

  it("offers no retry once the video is queued", async () => {
    const s = steps(async () => ({ ok: false, errors: ["Your video is queued, but the reel's status couldn't be updated (timeout)."], queued: true }));
    const o = await sendFootage(s, false);
    expect(o.kind).toBe("queued");
    expect(retryLabel(o)).toBeNull();
  });

  it("uploads again when storage has no file", async () => {
    const s = steps(async () => ({ ok: false, errors: ["The upload didn't finish. Upload the video again."], uploadMissing: true }));
    const o = await sendFootage(s, false);
    expect(o).toEqual({ kind: "failed", errors: ["The upload didn't finish. Upload the video again."], uploaded: false });
    expect(retryLabel(o)).toBe("Upload again");
  });
});

describe("uploadAll", () => {
  const items = [{ objectName: "a", size: 100 }, { objectName: "b", size: 300 }, { objectName: "c", size: 100 }];
  it("never re-sends a finished file after an interruption, and reports progress by bytes", async () => {
    const done = new Set<string>();
    const sent: string[] = [];
    const progress: number[] = [];
    let failB = true;
    const upload = async (item: { objectName: string }, onFraction: (f: number) => void) => {
      sent.push(item.objectName);
      onFraction(0.5);
      if (item.objectName === "b" && failB) { failB = false; throw new Error("network down"); }
    };
    await expect(uploadAll(items, done, upload, (f) => progress.push(f))).rejects.toThrow("network down");
    expect([...done]).toEqual(["a"]);
    await uploadAll(items, done, upload, (f) => progress.push(f));
    expect(sent).toEqual(["a", "b", "b", "c"]);
    expect([...done]).toEqual(["a", "b", "c"]);
    expect(progress.slice(0, 3)).toEqual([0.1, 0.2, 0.5]);
    expect(progress.at(-1)).toBe(1);
  });
  it("after storage reports a missing file, Upload again sends the files again instead of skipping them", async () => {
    const done = new Set(["a", "b", "c"]);
    forgetUploadsAfter(done, { kind: "failed", errors: ["x"], uploaded: true });
    expect([...done]).toEqual(["a", "b", "c"]);
    forgetUploadsAfter(done, { kind: "interrupted", errors: ["x"] });
    expect([...done]).toEqual(["a", "b", "c"]);
    forgetUploadsAfter(done, { kind: "failed", errors: ['"demo" didn\'t finish uploading. Upload again.'], uploaded: false });
    expect([...done]).toEqual([]);
    const sent: string[] = [];
    await uploadAll(items, done, async (item) => { sent.push(item.objectName); }, () => {});
    expect(sent).toEqual(["a", "b", "c"]);
  });
});
