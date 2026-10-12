import AVFoundation
import Foundation
import Vision

struct Box: Encodable { let x: Double; let y: Double; let w: Double; let h: Double }

struct Sample: Encodable {
  let tMs: Double
  let box: Box?
  enum CodingKeys: String, CodingKey { case tMs, box }
  // Encode a missing face as null (synthesised Encodable would omit the key).
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(tMs, forKey: .tMs)
    try c.encode(box, forKey: .box)
  }
}

struct Track: Encodable { let width: Int; let height: Int; let fps: Double; let sampleEvery: Int; let samples: [Sample] }

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "track" else { fail("usage: face-helper track <video> [--every N]") }
let url = URL(fileURLWithPath: args[2])
var every = 3
if let i = args.firstIndex(of: "--every"), i + 1 < args.count, let n = Int(args[i + 1]), n > 0 { every = n }
guard FileManager.default.fileExists(atPath: url.path) else { fail("no such file: \(url.path)") }

do {
  let asset = AVURLAsset(url: url)
  guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("no video track in \(url.path)") }
  let size = try await track.load(.naturalSize)
  let fps = Double(try await track.load(.nominalFrameRate))
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  output.alwaysCopiesSampleData = false
  reader.add(output)
  guard reader.startReading() else { fail("cannot read \(url.path): \(reader.error?.localizedDescription ?? "unknown error")") }
  var samples: [Sample] = []
  var index = 0
  while let buffer = output.copyNextSampleBuffer() {
    defer { index += 1 }
    guard index % every == 0, let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
    let tMs = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    let request = VNDetectFaceRectanglesRequest()
    try VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up).perform([request])
    let largest = (request.results ?? []).max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
    // Vision boxes are normalised with the origin bottom-left; output top-left.
    let box = largest.map { f in
      Box(x: Double(f.boundingBox.minX), y: Double(1 - f.boundingBox.maxY), w: Double(f.boundingBox.width), h: Double(f.boundingBox.height))
    }
    samples.append(Sample(tMs: (tMs * 10).rounded() / 10, box: box))
  }
  if reader.status == .failed { fail("reading \(url.path) failed: \(reader.error?.localizedDescription ?? "unknown error")") }
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  FileHandle.standardOutput.write(try encoder.encode(Track(width: Int(size.width), height: Int(size.height), fps: fps, sampleEvery: every, samples: samples)))
} catch {
  fail("face-helper: \(error.localizedDescription)")
}
