import SwiftUI
import WebKit

struct WebGameView: UIViewRepresentable {
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

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        
        // Enable file access for local modules
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

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
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.allowsLinkPreview = false

        loadGame(into: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private func loadGame(into webView: WKWebView) {
        guard let resourceBase = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true) else {
            print("Error: 'www' folder missing from bundle.")
            webView.loadHTMLString(Self.missingBundleHTML, baseURL: nil)
            return
        }

        let indexURL = resourceBase.appendingPathComponent("index.html")
        print("Attempting to load: \(indexURL.path)")
        
        if FileManager.default.fileExists(atPath: indexURL.path) {
            webView.loadFileURL(indexURL, allowingReadAccessTo: resourceBase)
        } else {
            print("Error: File not found at \(indexURL.path)")
            webView.loadHTMLString(Self.missingBundleHTML, baseURL: nil)
        }
    }

    private static let missingBundleHTML = """
    <html><body style='font-family:-apple-system;text-align:center;padding:2rem;background:#05070B;color:#f2f2f2;'>
    <h1>Bundle Missing</h1>
    <p>Add the synced <code>www</code> folder to the app target (see native/sync-web.sh).</p>
    </body></html>
    """
}
