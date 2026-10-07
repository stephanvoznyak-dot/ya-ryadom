# Интеграция модуля «Я рядом» в Telegram X

Актуальная версия модуля с поддержкой HMAC-авторизации и улучшенным UI.

## Состав

```
yaryadom/
├── YaRyadomController.kt
├── data/
│   ├── YaRyadomApi.kt
│   └── models/
│       └── Models.kt
├── ui/
│   └── YaRyadomScreens.kt
├── util/
│   └── LocationHelper.kt
└── INTEGRATION.md
```

## 1. Копирование файлов

Скопируйте содержимое модуля в исходники Telegram X:

```
app/src/main/java/org/thunderdog/challegram/yaryadom/
```

## 2. Разрешения (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
```

## 3. Backend (обязательно)

1. Добавьте в `.env` бота:

```
NATIVE_CLIENT_SECRET=сгенерируйте-длинный-случайный-секрет-не-менее-32-символов
```

2. Примените патч из `backend-native-auth-patch.ts`.

## 4. Подключение в навигацию

```kotlin
val me = tdlib.myUser()

val controller = YaRyadomController(
    context = context,
    baseUrl = "https://your-ya-ryadom-domain.com",
    userId = me.id,
    firstName = me.firstName,
    username = me.username,
    nativeSecret = "тот-же-секрет-что-и-NATIVE_CLIENT_SECRET"
)

container.addView(controller.getView())
```

## 5. Сборка APK

```bash
./gradlew assembleLatestUniversalDebug
```

См. полный INTEGRATION.md в репозитории telegram-x или в этом модуле.
