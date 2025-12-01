import SwiftUI
import WebKit

struct WebGameView: NSViewRepresentable {
    @MainActor
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

    class WebViewContainer: NSView {
        let webView: WKWebView

        init(webView: WKWebView) {
            self.webView = webView
            super.init(frame: .zero)
            webView.translatesAutoresizingMaskIntoConstraints = false
            self.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: self.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: self.trailingAnchor),
                webView.topAnchor.constraint(equalTo: self.topAnchor),
                webView.bottomAnchor.constraint(equalTo: self.bottomAnchor)
            ])
        }

        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WebViewContainer {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.suppressesIncrementalRendering = false
        
        // Enable file access for local modules/assets
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        configuration.preferences.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        // Enable inspector
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Inject Error Handler
        let errorScript = WKUserScript(source: """
            function showDebugError(msg) {
                var errDiv = document.createElement('div');
                errDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:rgba(0,0,0,0.9);color:#ff5555;z-index:99999;padding:20px;font-family:monospace;font-size:16px;white-space:pre-wrap;overflow:auto;height:100vh;';
                errDiv.textContent = 'DEBUG ERROR:\\n' + msg;
                document.body.appendChild(errDiv);
            }
            window.onerror = function(msg, url, line, col, error) {
                showDebugError(msg + "\\n" + url + ":" + line);
            };
            window.addEventListener('unhandledrejection', function(e) {
                showDebugError("Promise Rejection: " + e.reason);
            });
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        configuration.userContentController.addUserScript(errorScript)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsMagnification = true
        webView.allowsBackForwardNavigationGestures = false
        webView.customUserAgent = "TypeR198X-macOS"

        loadGame(into: webView)
        
        return WebViewContainer(webView: webView)
    }

    func updateNSView(_ nsView: WebViewContainer, context: Context) {}

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
    <p>Ensure <code>www</code> is synced to <code>native/macos/typer198xMac/www</code> and included in the target.</p>
    </body></html>
    """
}
