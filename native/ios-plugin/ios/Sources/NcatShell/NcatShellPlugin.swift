import Foundation
import WebKit
import Capacitor

// ============================================================================
// NcatShellPlugin
//
// 壳的原生侧只做三件 JS 做不到 / 做不稳的事：
//   1. 给 WKWebView 设置完整的真实 iPhone Safari UA（整串覆盖，不追加后缀，
//      保证 cdndefend 这类浏览器验证看到的指纹自洽）。
//   2. 把净化脚本 purify.js 以 WKUserScript(atDocumentStart, 全帧) 注入 ——
//      必须在文档开始执行，才能赶在站点的广告/弹窗脚本之前覆写 window.open；
//      forMainFrameOnly=false 让播放器 iframe 内部也有一份（同源策略下父帧
//      碰不到跨域 iframe，只能让脚本在每个帧里各自运行）。
//   3. 编译并挂载 WKContentRuleList（content-rules.json），在网络层直接
//      掐掉已知广告域名与官方 APP 下载站的资源加载。
//
// 时机：插件 load() 时 bridge.webView 可能还没就绪，用主队列短间隔重试拿。
// 本 App 首个页面是本地引导页（不需要注入），远程页面都是后续导航，
// 在 load() 阶段装好脚本对所有远程页面都来得及。
// ============================================================================

@objc(NcatShellPlugin)
public class NcatShellPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "NcatShellPlugin"
    public let jsName = "NcatShell"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise)
    ]

    private var installAttempts = 0
    private var installed = false

    @objc override public func load() {
        installIntoWebView()
    }

    @objc func ping(_ call: CAPPluginCall) {
        call.resolve(["ok": true, "installed": installed])
    }

    private func installIntoWebView() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.installed { return }
            guard let webView = self.bridge?.webView else {
                self.installAttempts += 1
                if self.installAttempts < 100 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        self.installIntoWebView()
                    }
                } else {
                    CAPLog.print("[NcatShell] webView not available, injection skipped")
                }
                return
            }
            self.installed = true

            // 1) UA：完整真实 Safari 串整串覆盖。
            webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1"

            let controller = webView.configuration.userContentController

            // 2) 净化脚本注入（资源随插件打包，读不到就跳过，不许崩）。
            if let url = Bundle.module.url(forResource: "purify", withExtension: "js"),
               let source = try? String(contentsOf: url, encoding: .utf8) {
                controller.addUserScript(WKUserScript(
                    source: source,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: false
                ))
            } else {
                CAPLog.print("[NcatShell] purify.js resource missing")
            }

            // 3) 内容拦截规则（编译异步，装不上不影响浏览）。
            if let url = Bundle.module.url(forResource: "content-rules", withExtension: "json"),
               let json = try? String(contentsOf: url, encoding: .utf8) {
                WKContentRuleListStore.default().compileContentRuleList(
                    forIdentifier: "ncat-content-rules",
                    encodedContentRuleList: json
                ) { list, error in
                    // WKUserContentController 的增删必须在主线程（审查 Minor）。
                    DispatchQueue.main.async {
                        if let list {
                            controller.add(list)
                        } else if let error {
                            CAPLog.print("[NcatShell] content rule compile failed: \(error.localizedDescription)")
                        }
                    }
                }
            }
        }
    }
}
