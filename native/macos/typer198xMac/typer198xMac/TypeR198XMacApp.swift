import SwiftUI

struct ContentView: View {
    var body: some View {
        WebGameView()
    }
}

@main
struct TypeR198XMacApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 1280, minHeight: 720)
        }
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
