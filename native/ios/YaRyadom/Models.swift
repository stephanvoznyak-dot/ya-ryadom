import Foundation

enum OrderStatus: String, Codable {
    case open = "OPEN"
    case taken = "TAKEN"
    case completed = "COMPLETED"
    case cancelled = "CANCELLED"
}

struct Identity: Codable, Identifiable, Hashable {
    var id: Int
    var firstName: String
    var lastName: String?
    var username: String?

    var displayName: String {
        [firstName, lastName].compactMap { $0 }.joined(separator: " ")
    }
}

struct Order: Codable, Identifiable {
    var id: String
    var status: OrderStatus
    var category: String
    var description: String
    var destinationText: String?
    var latitude: Double
    var longitude: Double
    var radiusMeters: Int
    var creatorId: Int
    var creatorName: String
    var creatorUsername: String?
    var takerId: Int?
    var takerName: String?
    var takerUsername: String?
    var createdAt: Date
    var expiresAt: Date
    var takenAt: Date?
    var completedAt: Date?
}

struct ServiceEntry: Codable, Identifiable {
    var id: String
    var orderId: String
    var at: Date
    var kind: String
    var lines: [String]
    var showGps: Bool
    var gpsLine: String?
}

enum Category: String, CaseIterable {
    case delivery = "DELIVERY"
    case ride = "RIDE"
    case help = "HELP"
    case shopping = "SHOPPING"
    case repair = "REPAIR"
    case cleaning = "CLEANING"
    case computer = "COMPUTER"
    case rental = "RENTAL"
    case other = "OTHER"

    var label: String {
        switch self {
        case .delivery: return "Доставка"
        case .ride: return "Поездка"
        case .help: return "Помощь"
        case .shopping: return "Купить / принести"
        case .repair: return "Ремонт"
        case .cleaning: return "Уборка"
        case .computer: return "Компьютер"
        case .rental: return "Прокат"
        case .other: return "Другое"
        }
    }
}
