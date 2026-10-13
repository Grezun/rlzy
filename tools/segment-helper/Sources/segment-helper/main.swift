// segment-helper: a person matte from a video with Apple Vision (footage editor plan 3, spec §4.2 step 6).
//
//   segment-helper matte <video> [--faces <face-track.json>] [--smooth A]
//
// Writes one raw 8-bit grey frame per video frame, at the video's size, to stdout (white = the speaker), for ffmpeg:
//   … | ffmpeg -f rawvideo -pix_fmt gray -s WxH -r FPS -i pipe:0 …
// The first stderr line is "WxH fps"; the last is a STATS line. On any error: a message on stderr and exit code 1.
//
// Per frame:
//   1. VNGeneratePersonSegmentationRequest at .accurate. One request object is reused, so Vision keeps its own temporal
//      consistency. (.balanced halos and the person-instance mask ghosts the background: both failed the spike.)
//   2. The matte is scaled to the frame.
//   3. --faces: the smoothed face track ingest stores ({intervalMs, samples: [{tMs, box | null}]}; boxes normalised,
//      origin top-left). Only the matte region connected to the face is kept, so a bottle on the table or a chunk of wall
//      drops out. With no face at this time, the frame is kept as it is.
//   4. --smooth A: blended with the previous output frame (A = the previous frame's weight).
import AVFoundation
import CoreImage
import Foundation
import Vision

struct Box: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
struct FaceSample: Decodable { let tMs: Double; let box: Box? }
struct FaceTrack: Decodable { let intervalMs: Double; let samples: [FaceSample] }

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}
func note(_ message: String) { FileHandle.standardError.write(Data((message + "\n").utf8)) }

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "matte" else { fail("usage: segment-helper matte <video> [--faces <face-track.json>] [--smooth A]") }
let url = URL(fileURLWithPath: args[2])
func opt(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}
guard FileManager.default.fileExists(atPath: url.path) else { fail("no such file: \(url.path)") }
let smooth = Float(opt("--smooth") ?? "0") ?? -1
guard smooth >= 0, smooth < 1 else { fail("--smooth must be a number from 0 to below 1") }
let track: FaceTrack? = {
  guard let path = opt("--faces") else { return nil }
  guard let data = FileManager.default.contents(atPath: path) else { fail("no such file: \(path)") }
  do { return try JSONDecoder().decode(FaceTrack.self, from: data) } catch { fail("--faces is not a face track: \(error.localizedDescription)") }
}()

/// The face box nearest to tMs within one sampling interval, or nil. Frames arrive in order, so `cursor` only moves forward.
func faceBox(_ track: FaceTrack?, at tMs: Double, cursor: inout Int) -> Box? {
  guard let t = track, !t.samples.isEmpty else { return nil }
  let s = t.samples
  while cursor + 1 < s.count && s[cursor + 1].tMs <= tMs { cursor += 1 }
  var best = s[cursor]
  if cursor + 1 < s.count && abs(s[cursor + 1].tMs - tMs) < abs(best.tMs - tMs) { best = s[cursor + 1] }
  return abs(best.tMs - tMs) <= t.intervalMs ? best.box : nil
}

/// Keeps the matte region connected to the face: a flood fill over a 4 px grid of cells whose centre is ≥ 128, seeded
/// from every such cell inside the face box, plus a one-cell ring for the soft edge. Everything else is zeroed.
/// A face box with no matte inside leaves the frame as it is.
func keepFaceRegion(_ frame: inout [UInt8], width w: Int, height h: Int, face: Box) {
  let step = 4
  let gw = (w + step - 1) / step
  let gh = (h + step - 1) / step
  var on = [Bool](repeating: false, count: gw * gh)
  for gy in 0..<gh {
    let y = min(h - 1, gy * step + step / 2)
    for gx in 0..<gw {
      let x = min(w - 1, gx * step + step / 2)
      on[gy * gw + gx] = frame[y * w + x] >= 128
    }
  }
  let cellX = { (v: Double) -> Int in min(gw - 1, max(0, Int(v * Double(w)) / step)) }
  let cellY = { (v: Double) -> Int in min(gh - 1, max(0, Int(v * Double(h)) / step)) }
  let x0 = cellX(face.x), x1 = cellX(face.x + face.w), y0 = cellY(face.y), y1 = cellY(face.y + face.h)
  var reached = [Bool](repeating: false, count: gw * gh)
  var queue: [Int] = []
  for gy in y0...y1 {
    for gx in x0...x1 {
      let i = gy * gw + gx
      if on[i] && !reached[i] { reached[i] = true; queue.append(i) }
    }
  }
  if queue.isEmpty { return }
  var head = 0
  while head < queue.count {
    let i = queue[head]
    head += 1
    let gx = i % gw, gy = i / gw
    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
      let nx = gx + dx, ny = gy + dy
      guard nx >= 0, ny >= 0, nx < gw, ny < gh else { continue }
      let j = ny * gw + nx
      if on[j] && !reached[j] { reached[j] = true; queue.append(j) }
    }
  }
  for gy in 0..<gh {
    for gx in 0..<gw {
      var keep = false
      for dy in -1...1 where !keep {
        for dx in -1...1 where !keep {
          let nx = gx + dx, ny = gy + dy
          if nx >= 0, ny >= 0, nx < gw, ny < gh, reached[ny * gw + nx] { keep = true }
        }
      }
      if keep { continue }
      for y in (gy * step)..<min(h, (gy + 1) * step) {
        for x in (gx * step)..<min(w, (gx + 1) * step) { frame[y * w + x] = 0 }
      }
    }
  }
}

do {
  let asset = AVURLAsset(url: url)
  guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else { fail("no video track in \(url.path)") }
  let size = try await videoTrack.load(.naturalSize)
  let fps = Double(try await videoTrack.load(.nominalFrameRate))
  let w = Int(size.width), h = Int(size.height)
  note("\(w)x\(h) \(fps)")

  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  output.alwaysCopiesSampleData = false
  reader.add(output)
  guard reader.startReading() else { fail("cannot read \(url.path): \(reader.error?.localizedDescription ?? "unknown error")") }

  let request = VNGeneratePersonSegmentationRequest()
  request.qualityLevel = .accurate
  request.outputPixelFormat = kCVPixelFormatType_OneComponent8
  let sequence = VNSequenceRequestHandler()
  let ci = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
  var frame = [UInt8](repeating: 0, count: w * h)
  var prev = [Float](repeating: 0, count: w * h)
  var havePrev = false
  var count = 0
  var cursor = 0
  let started = Date()
  let stdout = FileHandle.standardOutput

  while let buffer = output.copyNextSampleBuffer() {
    guard let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
    let tMs = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    try sequence.perform([request], on: pixels, orientation: .up)
    guard let mask = request.results?.first?.pixelBuffer else { fail("no matte for frame \(count)") }
    let image = CIImage(cvPixelBuffer: mask)
    let scaled = image.transformed(by: CGAffineTransform(scaleX: Double(w) / image.extent.width, y: Double(h) / image.extent.height))
    frame.withUnsafeMutableBytes { raw in
      ci.render(scaled, toBitmap: raw.baseAddress!, rowBytes: w, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .L8, colorSpace: nil)
    }
    if let face = faceBox(track, at: tMs, cursor: &cursor) { keepFaceRegion(&frame, width: w, height: h, face: face) }
    if smooth > 0 {
      for i in 0..<frame.count {
        let v = havePrev ? smooth * prev[i] + (1 - smooth) * Float(frame[i]) : Float(frame[i])
        prev[i] = v
        frame[i] = UInt8(min(255, max(0, v.rounded())))
      }
      havePrev = true
    }
    stdout.write(Data(frame))
    count += 1
  }
  if reader.status == .failed { fail("reading \(url.path) failed: \(reader.error?.localizedDescription ?? "unknown error")") }
  let seconds = Date().timeIntervalSince(started)
  note(String(format: "STATS frames=%d seconds=%.1f fps=%.1f", count, seconds, Double(count) / max(seconds, 0.001)))
} catch {
  fail("segment-helper: \(error.localizedDescription)")
}
