import SwiftUI

struct LaunchScreenView: View {
    var body: some View {
        ZStack {
            Color(red: 0.02, green: 0.04, blue: 0.07)
                .ignoresSafeArea()
            VStack(spacing: 24) {
                Image("LaunchLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 240)
                    .shadow(color: Color(red: 0.99, green: 0.45, blue: 0.95).opacity(0.45), radius: 24, x: 0, y: 12)
                Text("TYPE-R 198X")
                    .font(.system(size: 32, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(red: 0.99, green: 0.45, blue: 0.95))
                    .shadow(color: Color.black.opacity(0.6), radius: 6, x: 0, y: 3)
                Text("Typing the WordStorm")
                    .font(.system(size: 16, weight: .medium, design: .monospaced))
                    .foregroundStyle(Color(red: 0.32, green: 0.87, blue: 0.97))
                    .opacity(0.9)
            }
            .padding()
        }
    }
}

#Preview {
    LaunchScreenView()
}
