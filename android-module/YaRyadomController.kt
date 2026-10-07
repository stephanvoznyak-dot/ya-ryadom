package org.thunderdog.challegram.yaryadom

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import org.thunderdog.challegram.yaryadom.data.YaRyadomApi
import org.thunderdog.challegram.yaryadom.data.YaRyadomApiException
import org.thunderdog.challegram.yaryadom.data.models.CreateOrderRequest
import org.thunderdog.challegram.yaryadom.ui.YaRyadomScreens
import org.thunderdog.challegram.yaryadom.util.LocationHelper
import java.util.concurrent.Executors

class YaRyadomController(
    private val context: Context,
    private val baseUrl: String,
    private val userId: Long,
    private val firstName: String,
    private val username: String? = null,
    private val nativeSecret: String? = null
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val api = YaRyadomApi(baseUrl, userId, firstName, username, nativeSecret)
    private val locationHelper = LocationHelper(context)
    private val root = FrameLayout(context)
    private var currentLat: Double? = null
    private var currentLng: Double? = null

    init { showHome() }

    fun getView(): View = root

    private fun showHome() {
        setContent(YaRyadomScreens.createHomeView(context,
            onNeedClick = { startCreateOrder() },
            onCanClick = { startNearby() },
            onMyOrdersClick = { loadMyOrders() }))
    }

    private fun startCreateOrder() {
        ensureLocation { lat, lng ->
            currentLat = lat; currentLng = lng
            setContent(YaRyadomScreens.createOrderFormView(context,
                onSubmit = { cat, desc, dest, rad, exp -> createOrder(cat, desc, dest, rad, exp, lat, lng) },
                onBack = { showHome() }))
        }
    }

    private fun startNearby() {
        ensureLocation { lat, lng ->
            currentLat = lat; currentLng = lng
            loadNearby(lat, lng)
        }
    }

    private fun loadNearby(lat: Double, lng: Double, radius: Int = 5000) {
        showLoading()
        executor.execute {
            try {
                val response = api.nearby(lat, lng, radius)
                mainHandler.post {
                    setContent(YaRyadomScreens.createNearbyListView(context, response.items,
                        onTake = { id -> takeOrder(id, lat, lng) },
                        onRefresh = { loadNearby(lat, lng, radius) },
                        onBack = { showHome() }))
                }
            } catch (e: Exception) {
                mainHandler.post { toast(errorMessage(e)); showHome() }
            }
        }
    }

    private fun loadMyOrders() {
        showLoading()
        executor.execute {
            try {
                val response = api.myTaken()
                mainHandler.post {
                    setContent(YaRyadomScreens.createMyOrdersView(context, response.items,
                        onComplete = { id -> completeOrder(id) },
                        onBack = { showHome() }))
                }
            } catch (e: Exception) {
                mainHandler.post { toast(errorMessage(e)); showHome() }
            }
        }
    }

    private fun createOrder(category: String, description: String, destination: String?, radius: Int, expires: Int, lat: Double, lng: Double) {
        showLoading()
        executor.execute {
            try {
                api.createOrder(CreateOrderRequest(category, description, lat, lng, destination, radius, expires))
                mainHandler.post { toast("Заявка создана"); showHome() }
            } catch (e: Exception) {
                mainHandler.post { toast(errorMessage(e)); showHome() }
            }
        }
    }

    private fun takeOrder(orderId: String, lat: Double, lng: Double) {
        showLoading()
        executor.execute {
            try {
                val result = api.takeOrder(orderId)
                mainHandler.post {
                    toast(if (result.notifications?.creatorNotified == true) "Заявка взята. Заказчик уведомлён." else result.message)
                    loadNearby(lat, lng)
                }
            } catch (e: Exception) {
                mainHandler.post { toast(errorMessage(e)); loadNearby(lat, lng) }
            }
        }
    }

    private fun completeOrder(orderId: String) {
        showLoading()
        executor.execute {
            try {
                val result = api.completeOrder(orderId)
                mainHandler.post { toast(result.message); loadMyOrders() }
            } catch (e: Exception) {
                mainHandler.post { toast(errorMessage(e)); loadMyOrders() }
            }
        }
    }

    private fun ensureLocation(onSuccess: (Double, Double) -> Unit) {
        if (currentLat != null && currentLng != null) {
            onSuccess(currentLat!!, currentLng!!); return
        }
        showLoading()
        locationHelper.requestLocation(object : LocationHelper.Callback {
            override fun onLocation(result: LocationHelper.Result) {
                currentLat = result.latitude; currentLng = result.longitude
                onSuccess(result.latitude, result.longitude)
            }
            override fun onError(message: String) { toast(message); showHome() }
            override fun onPermissionRequired() { toast("Нужно разрешение на геолокацию"); showHome() }
        })
    }

    private fun setContent(view: View) {
        root.removeAllViews()
        root.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    private fun showLoading() {
        root.removeAllViews()
        val progress = ProgressBar(context)
        val params = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT)
        params.gravity = android.view.Gravity.CENTER
        root.addView(progress, params)
    }

    private fun toast(message: String) = Toast.makeText(context, message, Toast.LENGTH_SHORT).show()

    private fun errorMessage(e: Exception): String = when (e) {
        is YaRyadomApiException -> e.message ?: "Ошибка сервера (${e.statusCode})"
        else -> e.message ?: "Неизвестная ошибка"
    }
}
