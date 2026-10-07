package org.thunderdog.challegram.yaryadom.data.models

/**
 * Data models for Ya Ryadom module.
 * Keep in sync with backend API.
 */

data class UserInfo(
    val id: Long,
    val firstName: String,
    val lastName: String? = null,
    val username: String? = null
)

data class CreateOrderRequest(
    val category: String,
    val description: String,
    val latitude: Double,
    val longitude: Double,
    val destinationText: String? = null,
    val radiusMeters: Int = 5000,
    val expiresInMinutes: Int = 30
)

data class CreateOrderResponse(
    val id: String,
    val status: String,
    val expiresAt: String
)

data class NearbyItem(
    val id: String,
    val category: String,
    val description: String,
    val destinationText: String? = null,
    val distanceMeters: Int? = null,
    val status: String,
    val creatorName: String
)

data class NearbyResponse(
    val items: List<NearbyItem>
)

data class MineItem(
    val id: String,
    val category: String,
    val description: String,
    val destinationText: String? = null,
    val status: String,
    val creatorName: String,
    val creatorUsername: String? = null
)

data class MineResponse(
    val items: List<MineItem>
)

data class TakeResponse(
    val id: String,
    val status: String,
    val message: String,
    val notifications: Notifications? = null
)

data class Notifications(
    val creatorNotified: Boolean,
    val takerNotified: Boolean
)

data class CompleteResponse(
    val id: String,
    val status: String,
    val message: String
)

/** Categories — keep in sync with backend enum */
object Categories {
    val ALL = listOf(
        "DELIVERY" to "Delivery",
        "RIDE" to "Ride",
        "HELP" to "Help",
        "SHOPPING" to "Shopping",
        "REPAIR" to "Repair",
        "CLEANING" to "Cleaning",
        "COMPUTER" to "Computer",
        "RENTAL" to "Rental",
        "OTHER" to "Other"
    )

    fun label(code: String): String =
        ALL.find { it.first == code }?.second ?: code
}

/** Search radii in meters */
object Radii {
    val ALL = listOf(
        1000 to "1 km",
        2000 to "2 km",
        5000 to "5 km",
        10000 to "10 km",
        20000 to "20 km"
    )
}
