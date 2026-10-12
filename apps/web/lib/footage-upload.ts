import * as tus from "tus-js-client";

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading", planning: "Planning", draft: "Awaiting approval", generating: "Generating", needs_attention: "Needs attention", rendered: "Rendered", failed: "Failed",
};
export const UPLOAD_STALE_MS = 60 * 60 * 1000;

/** Supabase recommends the direct storage host for large uploads. */
export function storageEndpoint(supabaseUrl: string): string {
  const u = new URL(supabaseUrl);
  if (u.hostname.endsWith(".supabase.co") && !u.hostname.includes(".storage.")) u.hostname = u.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  return `${u.origin}/storage/v1/upload/resumable`;
}

export type FootageUploadInput = {
  supabaseUrl: string;
  bucket: string;
  objectName: string;
  contentType: string;
  /** The current access token; called before every request so a long upload never sends an expired one. */
  getToken: () => Promise<string>;
  onProgress: (fraction: number) => void;
};

export function tusUploadOptions(input: FootageUploadInput) {
  return {
    endpoint: storageEndpoint(input.supabaseUrl),
    retryDelays: [0, 3000, 5000, 10_000, 20_000, 60_000],
    headers: { "x-upsert": "true" },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB
    metadata: { bucketName: input.bucket, objectName: input.objectName, contentType: input.contentType, cacheControl: "3600" },
    /** Fresh token on every request: a 2 GB upload can outlive the 1-hour access token. */
    async onBeforeRequest(req: { setHeader(name: string, value: string): void }) {
      req.setHeader("authorization", `Bearer ${await input.getToken()}`);
    },
    onProgress(sent: number, total: number) {
      input.onProgress(total ? sent / total : 0);
    },
  };
}

export const uploadIncomplete = (createdAt: string, now: Date) => now.getTime() - new Date(createdAt).getTime() > UPLOAD_STALE_MS;

export function projectStatusLabel(p: { status: string; format: string; created_at: string }, now: Date): string {
  if (p.status === "uploading" && uploadIncomplete(p.created_at, now)) return "Upload incomplete";
  return STATUS_LABEL[p.status] ?? p.status;
}

/** Browser only: the video's duration from its metadata, or null when the browser can't read it (ingest re-checks). */
export const readVideoDuration = (file: File) => readMediaDuration(file, "video");

/** Browser only: the file's duration in seconds from its metadata, or null when the browser can't read it in 10 s. */
export function readMediaDuration(file: File, tag: "video" | "audio"): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(tag);
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    const timer = setTimeout(() => done(null), 10_000);
    media.preload = "metadata";
    media.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(media.duration) ? media.duration : null); };
    media.onerror = () => { clearTimeout(timer); done(null); };
    media.src = url;
  });
}

/**
 * Browser only: resumable upload. Resumes a previous attempt of the same file to the same object
 * (tus keeps the upload URL in localStorage), so "Resume upload" continues where it stopped.
 */
export function uploadFootageFile(file: File, opts: FootageUploadInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, { ...tusUploadOptions(opts), onError: reject, onSuccess: () => resolve() });
    upload.findPreviousUploads().then((previous) => {
      // The same file may have been sent to an earlier reel; only resume an upload to this reel's object.
      const same = previous.find((p) => p.metadata.objectName === opts.objectName);
      if (same) upload.resumeFromPreviousUpload(same);
      upload.start();
    }, reject);
  });
}
