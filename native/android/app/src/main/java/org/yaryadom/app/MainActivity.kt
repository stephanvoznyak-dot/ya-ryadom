package org.yaryadom.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import java.util.UUID

data class Identity(val id: Int, val firstName: String, val lastName: String)
data class Order(
    val id: String,
    var status: String,
    val category: String,
    val description: String,
    val creatorId: Int,
    val creatorName: String,
    var takerId: Int? = null,
    val radiusMeters: Int = 5000,
    val latitude: Double = 55.751244,
    val longitude: Double = 37.618423,
    var showGps: Boolean = true,
)

private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)))
}

private fun bucket(meters: Double): String {
    if (meters < 300) return "рядом"
    if (meters < 1000) return "до 1 км"
    if (meters < 2000) return "до 2 км"
    if (meters < 5000) return "до 5 км"
    if (meters < 10000) return "до 10 км"
    return "до 20 км"
}

private const val HERE_LAT = 55.751244
private const val HERE_LNG = 37.618423

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { App() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App() {
    val paper = Color(0xFFF3EFE6)
    val ink = Color(0xFF1A1714)
    val sage = Color(0xFF2F5D50)
    val personas = listOf(
        Identity(1001, "Анна", "Соколова"),
        Identity(1002, "Максим", "Орлов"),
    )
    var me by remember { mutableStateOf(personas[0]) }
    var tab by remember { mutableIntStateOf(0) }
    var msg by remember { mutableStateOf("") }
    val orders = remember {
        mutableStateListOf(
            Order("1", "OPEN", "HELP", "Помочь спустить коляску. Лифт не работает.", 2002, "Ирина Белова", radiusMeters = 5000),
            Order("2", "OPEN", "SHOPPING", "Забрать два пакета из Пятёрочки.", 2001, "Олег Крылов", radiusMeters = 5000),
            Order("3", "OPEN", "RENTAL", "Дрель на вечер. Радиус заявки 2 км.", 2004, "Кирилл Носов", radiusMeters = 2000, latitude = 55.78, longitude = 37.62),
        )
    }

    fun take(id: String) {
        val i = orders.indexOfFirst { it.id == id }
        if (i < 0) { msg = "Нет заявки"; return }
        val o = orders[i]
        if (o.status != "OPEN" || o.creatorId == me.id) {
            msg = "Уже недоступна"
            return
        }
        orders[i] = o.copy(status = "TAKEN", takerId = me.id, showGps = false)
        msg = "Взято. Координаты скрыты."
    }

    fun complete(id: String) {
        val i = orders.indexOfFirst { it.id == id }
        if (i < 0) return
        val o = orders[i]
        if (o.status != "TAKEN" || o.takerId != me.id) {
            msg = "Нельзя завершить"
            return
        }
        orders[i] = o.copy(status = "COMPLETED")
        msg = "Выполнена"
    }

    fun cancel(id: String) {
        val i = orders.indexOfFirst { it.id == id }
        if (i < 0) return
        val o = orders[i]
        val isCreator = o.creatorId == me.id
        val isTaker = o.status == "TAKEN" && o.takerId == me.id
        if (o.status == "OPEN" && !isCreator) { msg = "Нельзя отменить"; return }
        if (o.status == "TAKEN" && !isCreator && !isTaker) { msg = "Нельзя отменить"; return }
        if (o.status != "OPEN" && o.status != "TAKEN") return
        orders[i] = o.copy(status = "CANCELLED", showGps = false)
        msg = "Отменена, координаты стёрты"
    }

    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = sage,
            onPrimary = paper,
            background = paper,
            onBackground = ink,
            surface = Color(0xFFFFFDF8),
            onSurface = ink,
        ),
    ) {
        Scaffold(
            containerColor = paper,
            topBar = { TopAppBar(title = { Text("Я рядом") }) },
            bottomBar = {
                NavigationBar {
                    listOf("Главная", "Рядом", "Мои", "Код").forEachIndexed { i, label ->
                        NavigationBarItem(
                            selected = tab == i,
                            onClick = { tab = i },
                            icon = {},
                            label = { Text(label) },
                        )
                    }
                }
            },
        ) { padding ->
            when (tab) {
                0 -> HomePane(padding, me, personas, { me = it }, { tab = 1 }) { text ->
                    if (text.trim().length >= 3) {
                        orders.add(
                            Order(
                                id = UUID.randomUUID().toString(),
                                status = "OPEN",
                                category = "HELP",
                                description = text.trim(),
                                creatorId = me.id,
                                creatorName = "${me.firstName} ${me.lastName}",
                            ),
                        )
                        tab = 2
                    }
                }
                1 -> NearbyPane(
                    padding,
                    orders.filter { o ->
                        o.status == "OPEN" && o.creatorId != me.id &&
                            haversine(HERE_LAT, HERE_LNG, o.latitude, o.longitude) <= minOf(5000.0, o.radiusMeters.toDouble())
                    },
                    orders.count { o ->
                        o.status == "OPEN" && o.creatorId != me.id &&
                            haversine(HERE_LAT, HERE_LNG, o.latitude, o.longitude).let { d ->
                                d <= 5000.0 && d > o.radiusMeters.toDouble()
                            }
                    },
                    msg,
                    ::take,
                )
                2 -> MinePane(
                    padding,
                    orders.filter { it.status == "TAKEN" && it.takerId == me.id },
                    orders.filter { it.creatorId == me.id },
                    ::complete,
                    ::cancel,
                )
                else -> SourcePane(padding)
            }
        }
    }
}

@Composable
private fun HomePane(
    padding: PaddingValues,
    me: Identity,
    personas: List<Identity>,
    onMe: (Identity) -> Unit,
    onNearby: () -> Unit,
    onCreate: (String) -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().padding(padding).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Привет, ${me.firstName}", style = MaterialTheme.typography.bodyMedium)
        Text("Одна заявка — один исполнитель. GPS не попадает в ленту.")
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Мне нужно") },
        )
        Button(onClick = { onCreate(draft) }, modifier = Modifier.fillMaxWidth()) { Text("Создать заявку") }
        OutlinedButton(onClick = onNearby, modifier = Modifier.fillMaxWidth()) { Text("Я могу") }
        personas.forEach { p ->
            OutlinedButton(onClick = { onMe(p) }) {
                Text(if (p.id == me.id) "Вы: ${p.firstName}" else "Стать ${p.firstName}")
            }
        }
    }
}

@Composable
private fun NearbyPane(
    padding: PaddingValues,
    items: List<Order>,
    hidden: Int,
    msg: String,
    onTake: (String) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(padding).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text("Расстояние — диапазон, не метры. Радиус поиска 5 км.") }
        if (hidden > 0) item { Text("Ещё $hidden не показано: дальше радиуса автора.") }
        if (msg.isNotEmpty()) item { Text(msg, color = MaterialTheme.colorScheme.primary) }
        items(items, key = { it.id }) { o ->
            val label = bucket(haversine(HERE_LAT, HERE_LNG, o.latitude, o.longitude))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(o.category, style = MaterialTheme.typography.labelSmall)
                Text(o.description)
                Text("$label · ${o.creatorName}", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { onTake(o.id) }) { Text("Взять") }
            }
        }
    }
}

@Composable
private fun MinePane(
    padding: PaddingValues,
    taken: List<Order>,
    created: List<Order>,
    onComplete: (String) -> Unit,
    onCancel: (String) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(padding).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text("В работе") }
        items(taken, key = { it.id }) { o ->
            Column {
                Text(o.description)
                Button(onClick = { onComplete(o.id) }) { Text("Завершить") }
                OutlinedButton(onClick = { onCancel(o.id) }) { Text("Отменить") }
            }
        }
        item { Text("Созданные") }
        items(created, key = { "c-" + it.id }) { o ->
            Column {
                Text("${o.status}: ${o.description}")
                if (o.status == "OPEN" || o.status == "TAKEN") {
                    OutlinedButton(onClick = { onCancel(o.id) }) { Text("Отменить") }
                }
            }
        }
    }
}

@Composable
private fun SourcePane(padding: PaddingValues) {
    Column(Modifier.padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Исходники на GitHub")
        Text("https://github.com/stephanvoznyak-dot/ya-ryadom")
        Text("ZIP исходников и APK — во вкладке Actions / Releases и в веб-приложении.")
    }
}
