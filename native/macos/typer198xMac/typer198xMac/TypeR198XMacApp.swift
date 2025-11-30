import SwiftUI

@main
struct TypeR198XMacApp: App {
    var body: some Scene {
        WindowGroup {
            WebGameView()
                .frame(minWidth: 1280, minHeight: 720)
        }
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
