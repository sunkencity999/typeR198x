# iPadOS & iOS Wrapper Plan

This folder will contain the SwiftUI-based Xcode project that ships Type-R 198X as a native iPad + iPhone app (with optional Mac Catalyst support).

## Architecture

- **Rendering**: Single `WKWebView` pinned edge-to-edge that loads the offline bundle from `../shared/www` via `loadFileURL`.
- **Launch**: Provide native launch screen storyboard that mirrors the neon boot splash.
- **Capabilities**: Hardware keyboard support (full-screen), background audio disabled, Game Center optional.
- **Orientation**: Landscape-only with hardware keyboard friendly size classes.

## Build Steps

1. Run `../sync-web.sh` from repo root to refresh `shared/www` with the latest web assets.
2. Create/open the Xcode project in this folder (ignored by git except docs and source templates).
3. Add the provided Swift sources (`TypeR198XIOSApp.swift`, `WebGameView.swift`) to your Xcode target. They already configure a SwiftUI `WindowGroup` hosting a WKWebView that loads `www/index.html`.
4. Add the `www` folder (from `native/shared/www`) as a folder reference in Xcode so the bundle ships with the synced assets.
5. Provide app icons, launch storyboard, and privacy manifest per App Store policy.
6. Configure signing, run on physical iPad, then push to TestFlight before App Store submission.

## Submission Checklist

- ✅ Sync bundle (`sync-web.sh`).
- ✅ Increment version / build numbers.
- ✅ Archive → Validate → Upload.
- ✅ Attach screenshots (12.9" iPad as primary), privacy answers, and review notes referencing the offline bundle.
