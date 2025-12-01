import SwiftUI

struct ContentView: View {
    var body: some View {
        WebGameView()
            .ignoresSafeArea()
            .statusBar(hidden: true)
            .persistentSystemOverlays(.hidden)
    }
}

@main
struct TypeR198XIOSApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
