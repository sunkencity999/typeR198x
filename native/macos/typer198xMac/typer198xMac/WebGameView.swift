import SwiftUI
import WebKit

struct WebGameView: NSViewRepresentable {
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            switch navigationAction.request.url?.scheme {
            case "http", "https":
                decisionHandler(.cancel)
            default:
                decisionHandler(.allow)
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.suppressesIncrementalRendering = false
        
        // Enable file access for local modules/assets
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        // Enable inspector
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Inject Error Handler
        let errorScript = WKUserScript(source: """
            window.onerror = function(msg, url, line, col, error) {
                alert("JS Error: " + msg + "\\n" + url + ":" + line);
            };
            window.addEventListener('unhandledrejection', function(e) {
                alert("JS Promise Rejection: " + e.reason);
            });
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        configuration.userContentController.addUserScript(errorScript)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsMagnification = true
        webView.allowsBackForwardNavigationGestures = false
        webView.customUserAgent = "TypeR198X-macOS"

        loadGame(into: webView)
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    private func loadGame(into webView: WKWebView) {
        guard let baseURL = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true) else {
            print("Error: Could not find 'www' folder in Bundle Resources.")
            webView.loadHTMLString(Self.missingBundleHTML, baseURL: nil)
            return
        }

        let indexURL = baseURL.appendingPathComponent("index.html")
        print("Loading game from: \(indexURL.path)")
        
        if FileManager.default.fileExists(atPath: indexURL.path) {
            webView.loadFileURL(indexURL, allowingReadAccessTo: baseURL)
        } else {
            print("Error: index.html not found at \(indexURL.path)")
            webView.loadHTMLString(Self.missingBundleHTML, baseURL: nil)
        }
    }

    private static let missingBundleHTML = """
    <html><body style='font-family:-apple-system;text-align:center;padding:2rem;background:#05070B;color:#f2f2f2;'>
    <h1>Bundle Missing</h1>
    <p>Add the synced <code>www</code> folder to the macOS target (see native/sync-web.sh).</p>
    </body></html>
    """
}
