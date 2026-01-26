// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MacInputListener",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(name: "mac-input-listener", targets: ["MacInputListener"])
    ],
    targets: [
        .executableTarget(
            name: "MacInputListener",
            path: "Sources"
        )
    ]
)
