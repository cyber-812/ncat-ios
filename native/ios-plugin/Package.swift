// swift-tools-version: 5.9
import PackageDescription

// name 必须叫 NcatShell：Capacitor CLI 由插件 package.json 的 name（ncat-shell）
// 推导出 fixName = NcatShell，并按此名写入 CapApp-SPM/Package.swift。
let package = Package(
    name: "NcatShell",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "NcatShell", targets: ["NcatShell"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "NcatShell",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/NcatShell",
            resources: [
                .copy("purify.js"),
                .copy("content-rules.json")
            ])
    ]
)
