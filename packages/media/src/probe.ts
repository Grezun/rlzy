import { runFfprobe } from "./run";

export type ProbeResult = {
  durationSec: number;
  /** durationSec is the video stream's own length (the container's can be longer, e.g. when the audio runs on). */
  video?: { width: number; height: number; fps: number; codec: string; pixFmt: string; sar: string; durationSec: number };
  audio?: { codec: string; sampleRate: number; channels: number };
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
};

const parseRate = (rate = "0/1") => {
  const [num, den] = rate.split("/").map(Number);
  return den ? num / den : num;
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await runFfprobe(["-show_format", "-show_streams", "-of", "json", file]);
  const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: FfprobeStream[] };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const durationSec = Number(data.format?.duration ?? 0);
  // Some containers (e.g. WebM) give no per-stream duration: fall back to the container's.
  const videoSec = Number(v?.duration);
  return {
    durationSec,
    video: v && {
      width: v.width ?? 0,
      height: v.height ?? 0,
      fps: parseRate(v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v.r_frame_rate),
      codec: v.codec_name ?? "",
      pixFmt: v.pix_fmt ?? "",
      sar: v.sample_aspect_ratio ?? "1:1",
      durationSec: Number.isFinite(videoSec) && videoSec > 0 ? videoSec : durationSec,
    },
    audio: a && { codec: a.codec_name ?? "", sampleRate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0 },
  };
}
