import SwiftUI

@main
struct YaRyadomApp: App {
    @StateObject private var store = YaStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
