import Foundation
import Combine

final class YaStore: ObservableObject {
    @Published var identity: Identity
    @Published var orders: [Order]
    @Published var log: [ServiceEntry]
    @Published var latitude: Double = 55.751244
    @Published var longitude: Double = 37.618423

    static let personas: [Identity] = [
        Identity(id: 1001, firstName: "Анна", lastName: "Соколова", username: "anna"),
        Identity(id: 1002, firstName: "Максим", lastName: "Орлов", username: "max"),
    ]

    init() {
        identity = Self.personas[0]
        orders = []
        log = []
        seedIfNeeded()
    }

    func seedIfNeeded() {
        guard orders.isEmpty else { return }
        let now = Date()
        let o1 = Order(
            id: "11111111-1111-4111-8111-111111111111",
            status: .open,
            category: "SHOPPING",
            description: "Забрать заказ из Пятёрочки — два пакета.",
            destinationText: "подъезд со двора",
            latitude: 55.755, longitude: 37.62,
            radiusMeters: 5000,
            creatorId: 2001, creatorName: "Олег Крылов", creatorUsername: "oleg_k",
            createdAt: now.addingTimeInterval(-480),
            expiresAt: now.addingTimeInterval(3120)
        )
        let o2 = Order(
            id: "22222222-2222-4222-8222-222222222222",
            status: .open,
            category: "HELP",
            description: "Помочь спустить коляску. Лифт не работает.",
            latitude: 55.748, longitude: 37.625,
            radiusMeters: 2000,
            creatorId: 2002, creatorName: "Ирина Белова", creatorUsername: "irina_b",
            createdAt: now.addingTimeInterval(-900),
            expiresAt: now.addingTimeInterval(2700)
        )
        orders = [o1, o2]
        log = orders.map { chronicleCreated($0) }
    }

    func nearby(radius: Int) -> [Order] {
        prune()
        return orders.filter { o in
            guard o.status == .open, o.creatorId != identity.id, o.expiresAt > Date() else { return false }
            let d = distanceMeters(latitude, longitude, o.latitude, o.longitude)
            return d <= Double(min(radius, o.radiusMeters))
        }
    }

    @discardableResult
    func tryTake(_ id: String) -> Order? {
        prune()
        guard let i = orders.firstIndex(where: { $0.id == id }) else { return nil }
        var o = orders[i]
        guard o.status == .open, o.creatorId != identity.id, o.expiresAt > Date() else { return nil }
        o.status = .taken
        o.takerId = identity.id
        o.takerName = identity.displayName
        o.takerUsername = identity.username
        o.takenAt = Date()
        orders[i] = o
        log = log.map { e in
            guard e.orderId == id else { return e }
            var copy = e
            copy.showGps = false
            copy.gpsLine = nil
            copy.kind = "taken"
            copy.lines.append("Взял: \(identity.displayName)")
            return copy
        }
        return o
    }

    @discardableResult
    func tryComplete(_ id: String) -> Order? {
        guard let i = orders.firstIndex(where: { $0.id == id }) else { return nil }
        var o = orders[i]
        guard o.status == .taken, o.takerId == identity.id else { return nil }
        o.status = .completed
        o.completedAt = Date()
        o.latitude = 0
        o.longitude = 0
        orders[i] = o
        log = log.map { e in
            guard e.orderId == id else { return e }
            var copy = e
            copy.kind = "completed"
            copy.lines.append("Выполнена")
            return copy
        }
        return o
    }

    @discardableResult
    func tryCancel(_ id: String, reason: String) -> Order? {
        guard let i = orders.firstIndex(where: { $0.id == id }) else { return nil }
        var o = orders[i]
        let isCreator = o.creatorId == identity.id
        let isTaker = o.status == .taken && o.takerId == identity.id
        if o.status == .open && !isCreator { return nil }
        if o.status == .taken && !isCreator && !isTaker { return nil }
        if o.status != .open && o.status != .taken { return nil }
        o.status = .cancelled
        o.latitude = 0
        o.longitude = 0
        orders[i] = o
        log = log.map { e in
            guard e.orderId == id else { return e }
            var copy = e
            copy.kind = "cancelled"
            copy.showGps = false
            copy.gpsLine = nil
            copy.lines.append("Отменена: \(reason)")
            return copy
        }
        return o
    }

    func distanceLabel(_ order: Order) -> String {
        let d = distanceMeters(latitude, longitude, order.latitude, order.longitude)
        if d < 300 { return "рядом" }
        if d < 1000 { return "до 1 км" }
        if d < 2000 { return "до 2 км" }
        if d < 5000 { return "до 5 км" }
        if d < 10000 { return "до 10 км" }
        return "до 20 км"
    }

    func create(category: String, description: String, radius: Int, minutes: Int) {
        let now = Date()
        let order = Order(
            id: UUID().uuidString.lowercased(),
            status: .open,
            category: category,
            description: description,
            latitude: latitude, longitude: longitude,
            radiusMeters: radius,
            creatorId: identity.id,
            creatorName: identity.displayName,
            creatorUsername: identity.username,
            createdAt: now,
            expiresAt: now.addingTimeInterval(Double(minutes * 60))
        )
        orders.append(order)
        log.insert(chronicleCreated(order), at: 0)
    }

    private func prune() {
        let now = Date()
        for i in orders.indices where orders[i].status == .open && orders[i].expiresAt <= now {
            orders[i].status = .cancelled
            orders[i].latitude = 0
            orders[i].longitude = 0
        }
    }

    private func distanceMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1, sqrt(a)))
    }

    private func chronicleCreated(_ order: Order) -> ServiceEntry {
        let gps = String(format: "%.5f, %.5f", order.latitude, order.longitude)
        return ServiceEntry(
            id: "log-\(order.id)-created",
            orderId: order.id,
            at: order.createdAt,
            kind: "created",
            lines: [
                Category(rawValue: order.category)?.label ?? order.category,
                order.description,
                "Радиус: \(order.radiusMeters / 1000) км",
                "От: \(order.creatorName)",
                "id:\(order.id.prefix(8))",
            ],
            showGps: true,
            gpsLine: gps
        )
    }
}
