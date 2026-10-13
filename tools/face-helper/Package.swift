// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "face-helper",
  platforms: [.macOS(.v13)],
  targets: [.executableTarget(name: "face-helper", path: "Sources/face-helper")]
)
