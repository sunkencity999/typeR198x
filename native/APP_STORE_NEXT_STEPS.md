# Native Release Next Steps

The Swift scaffolding is in place. Follow these concrete steps to finish the App Store submissions for both the iOS/iPadOS (incl. Catalyst) and macOS binaries.

## 1. Refresh the Web Bundle

1. `bash native/sync-web.sh`
2. In each Xcode project, remove the previous `www` folder reference (if any) and add the freshly synced `native/shared/www` as a folder reference set to "Create folder references".

## 2. Configure the iOS/iPadOS Project

1. Open `native/ios/` in Xcode and create a new SwiftUI App project (or workspace) named **TypeR198XIOS**.
2. Drag `TypeR198XIOSApp.swift` and `WebGameView.swift` into the target (ensure "Copy items if needed" is unchecked).
3. Add `www` folder reference to the target's resources.
4. Turn on Mac Catalyst support if desired.
5. Set the deployment targets (iPadOS 16+, iOS 16+ optional) and restrict orientations to Landscape.
6. Provide:
   - App icons (1024, 180, 167, 152, etc.).
   - Launch Screen storyboard or SwiftUI view that mirrors the neon splash.
   - Privacy manifest with `NSPrivacyCollectedDataTypes` = empty (no tracking).
7. Enable `App Sandbox` (default) and disable background modes you don’t need.
8. Sign with your Apple Developer Team + bundle ID `com.yourteam.typer198x` (adjust accordingly).
9. Build & run on a physical iPad, verify audio, keyboard focus, pause/resume, and offline behavior.

## 3. Configure the macOS Project

1. Open/create the macOS SwiftUI App in `native/macos/` (TypeR198XMac).
2. Add `TypeR198XMacApp.swift` and `WebGameView.swift` plus the `www` folder reference.
3. Set minimum macOS 13+ deployment target.
4. Enable App Sandbox with:
   - `com.apple.security.network.client`
   - `com.apple.security.device.audio-input` (optional if you plan to capture mic)
5. Provide macOS icon set (512, 256, 128, etc.).
6. Hardened Runtime on, disable automatic termination, support fullscreen.
7. Test on Intel (Rosetta) + Apple Silicon (native) if possible.

## 4. QA & TestFlight

1. In App Store Connect, create two apps (or a universal entry with Catalyst):
   - **TypeR 198X** (iOS/iPadOS + Catalyst target)
   - **TypeR 198X macOS** (if shipping a separate App ID)
2. Provide metadata, age rating, privacy policy URL, and `sign-in required?` = No.
3. Archive builds from Xcode → "Distribute via App Store Connect".
4. Use TestFlight to invite internal testers; capture screenshots (12.9" iPad landscape, 11", iPad mini; Mac screenshots 1280×720+).
5. Collect feedback, verify no crashes in App Store Connect metrics.

## 5. Submission Checklist

- [ ] Version numbers incremented (e.g., 1.0 → 1.0.1) and build numbers unique.
- [ ] App Store icons, screenshots, and preview videos uploaded.
- [ ] Privacy questionnaire answered (no data collection if web bundle only uses localStorage).
- [ ] Review notes explain the offline web bundle + WKWebView approach.
- [ ] Compliance statements (encryption: uses standard TLS only → answer "No" to custom crypto).
- [ ] Final smoke test on release builds before hitting "Submit for Review".
