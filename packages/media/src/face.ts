import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FACE_HELPER_DEFAULT = path.resolve(HERE, "../../../tools/face-helper/.build/release/face-helper");
/** User-supplied Hebrew talking-head clip (≤ 10 s); committed only with the user's OK. Tests skip without it. */
export const FIXTURE_TALKING_HEAD = path.resolve(HERE, "../fixtures/talking-head-he.mp4");

export const faceHelperPath = () => process.env.FACE_HELPER_PATH || FACE_HELPER_DEFAULT;
export const faceHelperAvailable = () => existsSync(faceHelperPath());

export class FaceHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceHelperError";
  }
}

/** Runs `face-helper track` and returns its parsed JSON (validate it with RawFaceTrackSchema from @reel/core). */
export function runFaceHelper(video: string, opts: { every?: number; timeoutMs?: number } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(faceHelperPath(), ["track", video, "--every", String(opts.every ?? 3)], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 15 * 60_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-4000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new FaceHelperError(`face-helper failed to start (${e.message}). Run "npm run build:face-helper" on the worker Mac.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new FaceHelperError(err.trim() || `face-helper exited with code ${code}`));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")));
      } catch {
        reject(new FaceHelperError("face-helper printed invalid JSON"));
      }
    });
  });
}
