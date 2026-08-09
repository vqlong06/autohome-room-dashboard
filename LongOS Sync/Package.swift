// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "LongOSSyncCore",
    platforms: [
        .macOS(.v13),
        .iOS(.v17)
    ],
    products: [
        .library(name: "LongOSSyncCore", targets: ["LongOSSyncCore"])
    ],
    targets: [
        .target(
            name: "LongOSSyncCore",
            path: "LongOSSyncCore"
        ),
        .testTarget(
            name: "LongOSSyncCoreTests",
            dependencies: ["LongOSSyncCore"],
            path: "LongOSSyncCoreTests"
        )
    ]
)
