import SwiftUI

struct ContentView: View {
    @EnvironmentObject var store: YaStore
    @State private var tab = 0
    @State private var description = ""
    @State private var message = ""

    var body: some View {
        TabView(selection: $tab) {
            home.tabItem { Label("Главная", systemImage: "hands.sparkles") }.tag(0)
            nearby.tabItem { Label("Рядом", systemImage: "dot.radiowaves.left.forward") }.tag(1)
            mine.tabItem { Label("Мои", systemImage: "checklist") }.tag(2)
            service.tabItem { Label("Хроника", systemImage: "text.bubble") }.tag(3)
            source.tabItem { Label("Код", systemImage: "chevron.left.forwardslash.chevron.right") }.tag(4)
        }
        .tint(Color(red: 0.18, green: 0.36, blue: 0.31))
    }

    var home: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Привет, \(store.identity.displayName)")
                    .foregroundStyle(.secondary)
                Text("Я рядом")
                    .font(.largeTitle.weight(.medium))
                Text("Одна заявка — один исполнитель. Координаты не показываются в ленте.")
                    .foregroundStyle(.secondary)
                Button("Мне нужно") { tab = 0; showCreate = true }
                    .buttonStyle(.borderedProminent)
                Button("Я могу") { tab = 1 }
                    .buttonStyle(.bordered)
                Picker("Персона", selection: $store.identity) {
                    ForEach(YaStore.personas) { p in
                        Text(p.displayName).tag(p)
                    }
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Я рядом")
            .sheet(isPresented: $showCreate) { createSheet }
        }
    }

    @State private var showCreate = false

    var createSheet: some View {
        NavigationStack {
            Form {
                TextField("Описание", text: $description, axis: .vertical)
                Button("Создать") {
                    store.create(category: "HELP", description: description, radius: 5000, minutes: 30)
                    description = ""
                    showCreate = false
                    tab = 2
                }
                .disabled(description.trimmingCharacters(in: .whitespaces).count < 3)
            }
            .navigationTitle("Мне нужно")
        }
    }

    var nearby: some View {
        NavigationStack {
            List(store.nearby(radius: 20000)) { o in
                VStack(alignment: .leading, spacing: 6) {
                    Text(Category(rawValue: o.category)?.label ?? o.category)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(o.description)
                    Text(store.distanceLabel(o))
                        .font(.caption)
                        .foregroundStyle(Color(red: 0.18, green: 0.36, blue: 0.31))
                    Button("Взять") {
                        message = store.tryTake(o.id) == nil ? "Уже недоступна" : "Взято"
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Рядом")
            .safeAreaInset(edge: .bottom) {
                if !message.isEmpty { Text(message).padding() }
            }
        }
    }

    var mine: some View {
        NavigationStack {
            List {
                Section("В работе") {
                    ForEach(store.orders.filter { $0.status == .taken && $0.takerId == store.identity.id }) { o in
                        VStack(alignment: .leading) {
                            Text(o.description)
                            if let user = o.creatorUsername {
                                Text("@\(user)").font(.caption)
                            }
                            HStack {
                                Button("Завершить") { _ = store.tryComplete(o.id) }
                                Button("Отменить") { _ = store.tryCancel(o.id, reason: "Передумал") }
                            }
                        }
                    }
                }
                Section("Созданные") {
                    ForEach(store.orders.filter { $0.creatorId == store.identity.id }) { o in
                        VStack(alignment: .leading) {
                            Text("\(o.status.rawValue): \(o.description)")
                            if o.status == .open || o.status == .taken {
                                Button("Отменить") { _ = store.tryCancel(o.id, reason: "Передумал") }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Мои")
        }
    }

    var service: some View {
        NavigationStack {
            List(store.log) { e in
                VStack(alignment: .leading, spacing: 4) {
                    Text(e.kind).font(.caption).foregroundStyle(.secondary)
                    ForEach(e.lines, id: \.self) { Text($0) }
                    Text(e.showGps ? (e.gpsLine ?? "") : "Координаты скрыты")
                        .font(.caption2)
                        .foregroundStyle(e.showGps ? .red : .secondary)
                }
            }
            .navigationTitle("Хроника")
        }
    }

    var source: some View {
        NavigationStack {
            List {
                Link("GitHub: исходники", destination: URL(string: "https://github.com/stephanvoznyak-dot/ya-ryadom")!)
                Text("Архив ZIP и APK — в релизе GitHub и в веб-приложении, вкладка «Код».")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Исходники")
        }
    }
}
