import { describe, expect, it, vi } from "vitest";
import type { FinishResult } from "./create-footage";
import { retryLabel, sendFootage } from "./footage-send";

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
