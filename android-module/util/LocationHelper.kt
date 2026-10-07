package org.thunderdog.challegram.yaryadom.util

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/**
 * Simple location helper using Android LocationManager.
 * Prefer integrating with Telegram X permission flow in production.
 */
class LocationHelper(private val context: Context) {

    data class Result(val latitude: Double, val longitude: Double, val accuracy: Float?)

    interface Callback {
        fun onLocation(result: Result)
        fun onError(message: String)
        fun onPermissionRequired()
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    fun requestLocation(callback: Callback) {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) {
            callback.onPermissionRequired()
            return
        }

        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        ).filter { lm.isProviderEnabled(it) }

        if (providers.isEmpty()) {
            callback.onError("Location providers are disabled")
            return
        }

        // Try last known first
        @SuppressLint("MissingPermission")
        val last = providers.mapNotNull { lm.getLastKnownLocation(it) }
            .maxByOrNull { it.time }

        if (last != null && System.currentTimeMillis() - last.time < 60_000) {
            callback.onLocation(Result(last.latitude, last.longitude, last.accuracy))
            return
        }

        var delivered = false
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (delivered) return
                delivered = true
                try { lm.removeUpdates(this) } catch (_: Exception) {}
                mainHandler.post {
                    callback.onLocation(Result(location.latitude, location.longitude, location.accuracy))
                }
            }
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Deprecated("Deprecated in API")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }

        @SuppressLint("MissingPermission")
        try {
            for (p in providers) {
                lm.requestLocationUpdates(p, 0L, 0f, listener, Looper.getMainLooper())
            }
        } catch (e: Exception) {
            callback.onError(e.message ?: "Location request failed")
            return
        }

        // Timeout
        mainHandler.postDelayed({
            if (!delivered) {
                delivered = true
                try { lm.removeUpdates(listener) } catch (_: Exception) {}
                if (last != null) {
                    callback.onLocation(Result(last.latitude, last.longitude, last.accuracy))
                } else {
                    callback.onError("Location timeout")
                }
            }
        }, 12_000)
    }
}
