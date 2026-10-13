// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "segment-helper",
  platforms: [.macOS(.v14)],
  targets: [.executableTarget(name: "segment-helper", path: "Sources/segment-helper")]
)
