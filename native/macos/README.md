# macOS Wrapper Plan

This folder hosts the SwiftUI + WKWebView macOS project that packages Type-R 198X as a notarized desktop app. Only this README is tracked; Xcode-generated files remain ignored.

## Architecture

- SwiftUI App lifecycle with a single `WindowGroup` presenting an `NSViewRepresentable` WKWebView.
- Reuses the shared offline bundle (`../shared/www`). Copy it into the Xcode project as a folder reference so assets stay on disk.
- Adds basic native chrome: standard menu bar (Quit, About), `Cmd+R` to reload, `Cmd+F` to focus the game canvas via `evaluateJavaScript('game.focusGameCanvas?.()')`.

## Build Steps

1. Run `../sync-web.sh` to refresh `shared/www` with the latest HTML/CSS/JS/assets.
2. Open/create the Xcode project in this folder. Add the `www` folder reference to the app target's resources.
3. Drop in the provided Swift files (`TypeR198XMacApp.swift`, `WebGameView.swift`) so your target already exposes a SwiftUI `WindowGroup` that loads the bundled `www/index.html` in a WKWebView.
4. Configure the `WKWebView` with:
   - `loadFileURL(_:allowingReadAccessTo:)` pointed at `index.html`.
   - `configuration.mediaTypesRequiringUserActionForPlayback = []` so audio works without extra taps.
   - `setValue(true, forKey: "drawsBackground")` or CSS to keep the neon black backdrop.
5. Provide a custom app icon and privacy manifest.
6. Enable Hardened Runtime, App Sandbox, `com.apple.security.network.client`, and optionally `com.apple.security.device.audio-input`.
7. Archive, notarize (or distribute via TestFlight for Mac if you share an iPad build), then upload through App Store Connect.

## Submission Checklist

- ✅ Run tests/build on Intel + Apple Silicon.
- ✅ Verify window resizing, fullscreen, and keyboard shortcuts.
- ✅ Ensure `~/Library/Application Support/TypeR198X` is **not** used – saves stay in the web localStorage sandbox.
- ✅ Upload with screenshots (1280×800+) and updated metadata.
