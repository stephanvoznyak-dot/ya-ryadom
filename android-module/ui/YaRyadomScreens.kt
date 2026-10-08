package org.thunderdog.challegram.yaryadom.ui

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import org.thunderdog.challegram.yaryadom.data.models.Categories
import org.thunderdog.challegram.yaryadom.data.models.MineItem
import org.thunderdog.challegram.yaryadom.data.models.NearbyItem
import org.thunderdog.challegram.yaryadom.data.models.Radii

/** Theme-aware UI screens for Ya Ryadom native module. */
object YaRyadomScreens {

    private data class Theme(
        val bg: Int, val cardBg: Int, val textPrimary: Int,
        val textSecondary: Int, val accent: Int, val accentText: Int, val secondaryBtn: Int
    )

    private fun theme(context: Context): Theme {
        val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        return if (night) Theme(
            Color.parseColor("#0F0F0F"), Color.parseColor("#1C1C1E"),
            Color.parseColor("#FFFFFF"), Color.parseColor("#8E8E93"),
            Color.parseColor("#2AABEE"), Color.WHITE, Color.parseColor("#2C2C2E")
        ) else Theme(
            Color.parseColor("#F2F2F7"), Color.WHITE,
            Color.parseColor("#000000"), Color.parseColor("#6D6D72"),
            Color.parseColor("#2AABEE"), Color.WHITE, Color.parseColor("#E5E5EA")
        )
    }

    fun createHomeView(
        context: Context,
        onNeedClick: () -> Unit,
        onCanClick: () -> Unit,
        onMyOrdersClick: () -> Unit
    ): View {
        val t = theme(context)
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(t.bg)
            setPadding(dp(context, 24), dp(context, 40), dp(context, 24), dp(context, 24))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        layout.addView(TextView(context).apply {
            text = "Я рядом"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            setTypeface(null, Typeface.BOLD); setTextColor(t.textPrimary); gravity = Gravity.CENTER
        })
        layout.addView(TextView(context).apply {
            text = "Локальные заявки рядом с вами"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(t.textSecondary); gravity = Gravity.CENTER
            setPadding(0, dp(context, 8), 0, dp(context, 36))
        })
        layout.addView(makePrimaryButton(context, t, "Мне нужно", onNeedClick))
        layout.addView(space(context, 14))
        layout.addView(makePrimaryButton(context, t, "Я могу", onCanClick))
        layout.addView(space(context, 14))
        layout.addView(makeSecondaryButton(context, t, "Мои заявки", onMyOrdersClick))
        return ScrollView(context).apply { setBackgroundColor(t.bg); addView(layout) }
    }

    fun createOrderFormView(
        context: Context,
        onSubmit: (category: String, description: String, destination: String?, radius: Int, expires: Int) -> Unit,
        onBack: () -> Unit
    ): View {
        val t = theme(context)
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(t.bg)
            setPadding(dp(context, 20), dp(context, 16), dp(context, 20), dp(context, 24))
        }
        layout.addView(makeHeader(context, t, "Новая заявка", onBack))

        layout.addView(makeLabel(context, t, "Категория"))
        val categorySpinner = Spinner(context)
        categorySpinner.adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, Categories.ALL.map { it.second })
        layout.addView(categorySpinner)
        layout.addView(space(context, 16))

        layout.addView(makeLabel(context, t, "Описание"))
        val description = EditText(context).apply {
            hint = "Что нужно сделать?"; setTextColor(t.textPrimary); setHintTextColor(t.textSecondary)
            minLines = 3; setBackgroundColor(t.cardBg)
            setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
        }
        layout.addView(description)
        layout.addView(space(context, 16))

        layout.addView(makeLabel(context, t, "Куда (необязательно)"))
        val destination = EditText(context).apply {
            hint = "Адрес или ориентир"; setTextColor(t.textPrimary); setHintTextColor(t.textSecondary)
            setBackgroundColor(t.cardBg)
            setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
        }
        layout.addView(destination)
        layout.addView(space(context, 16))

        layout.addView(makeLabel(context, t, "Радиус поиска"))
        val radiusSpinner = Spinner(context)
        radiusSpinner.adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, Radii.ALL.map { it.second })
        radiusSpinner.setSelection(2)
        layout.addView(radiusSpinner)
        layout.addView(space(context, 16))

        layout.addView(makeLabel(context, t, "Срок (минуты)"))
        val expires = EditText(context).apply {
            setText("30"); inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setTextColor(t.textPrimary); setBackgroundColor(t.cardBg)
            setPadding(dp(context, 12), dp(context, 10), dp(context, 12), dp(context, 10))
        }
        layout.addView(expires)
        layout.addView(space(context, 28))

        layout.addView(makePrimaryButton(context, t, "Создать заявку") {
            val cat = Categories.ALL.getOrNull(categorySpinner.selectedItemPosition)?.first ?: "OTHER"
            val desc = description.text.toString().trim()
            if (desc.length < 3) {
                Toast.makeText(context, "Описание слишком короткое", Toast.LENGTH_SHORT).show()
                return@makePrimaryButton
            }
            val dest = destination.text.toString().trim().ifEmpty { null }
            val rad = Radii.ALL.getOrNull(radiusSpinner.selectedItemPosition)?.first ?: 5000
            val exp = expires.text.toString().toIntOrNull()?.coerceIn(5, 1440) ?: 30
            onSubmit(cat, desc, dest, rad, exp)
        })

        return ScrollView(context).apply { setBackgroundColor(t.bg); addView(layout) }
    }

    fun createNearbyListView(
        context: Context,
        items: List<NearbyItem>,
        onTake: (String) -> Unit,
        onRefresh: () -> Unit,
        onBack: () -> Unit
    ): View {
        val t = theme(context)
        val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(t.bg) }
        root.addView(makeHeader(context, t, "Рядом со мной", onBack, onRefresh))
        if (items.isEmpty()) {
            root.addView(TextView(context).apply {
                text = "Нет открытых заявок"; setTextColor(t.textSecondary); gravity = Gravity.CENTER
                setPadding(dp(context, 24), dp(context, 48), dp(context, 24), 0)
            })
            return root
        }
        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 16))
        }
        for (item in items) {
            list.addView(makeOrderCard(context, t, item) { onTake(item.id) })
            list.addView(space(context, 10))
        }
        root.addView(ScrollView(context).apply {
            setBackgroundColor(t.bg); addView(list)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    fun createMyOrdersView(
        context: Context,
        items: List<MineItem>,
        onComplete: (String) -> Unit,
        onBack: () -> Unit
    ): View {
        val t = theme(context)
        val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(t.bg) }
        root.addView(makeHeader(context, t, "Мои заявки", onBack))
        if (items.isEmpty()) {
            root.addView(TextView(context).apply {
                text = "Нет взятых заявок"; setTextColor(t.textSecondary); gravity = Gravity.CENTER
                setPadding(dp(context, 24), dp(context, 48), dp(context, 24), 0)
            })
            return root
        }
        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 16))
        }
        for (item in items) {
            list.addView(makeMineCard(context, t, item) { onComplete(item.id) })
            list.addView(space(context, 10))
        }
        root.addView(ScrollView(context).apply {
            setBackgroundColor(t.bg); addView(list)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    private fun makeHeader(context: Context, t: Theme, title: String, onBack: () -> Unit, onAction: (() -> Unit)? = null): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(context, 8), dp(context, 12), dp(context, 8), dp(context, 12))
            setBackgroundColor(t.cardBg)
        }
        row.addView(TextView(context).apply {
            text = "←"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f); setTextColor(t.accent)
            setPadding(dp(context, 12), dp(context, 4), dp(context, 12), dp(context, 4))
            setOnClickListener { onBack() }
        })
        row.addView(TextView(context).apply {
            text = title; setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f); setTypeface(null, Typeface.BOLD)
            setTextColor(t.textPrimary)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        if (onAction != null) {
            row.addView(TextView(context).apply {
                text = "↻"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f); setTextColor(t.accent)
                setPadding(dp(context, 12), dp(context, 4), dp(context, 12), dp(context, 4))
                setOnClickListener { onAction() }
            })
        }
        return row
    }

    private fun makeOrderCard(context: Context, t: Theme, item: NearbyItem, onTake: () -> Unit): View {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundRect(t.cardBg, dp(context, 12).toFloat())
            setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
        }
        card.addView(TextView(context).apply {
            text = Categories.label(item.category); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(t.accent); setTypeface(null, Typeface.BOLD)
        })
        card.addView(TextView(context).apply {
            text = item.description; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(t.textPrimary); setPadding(0, dp(context, 4), 0, dp(context, 6))
        })
        card.addView(TextView(context).apply {
            val dist = item.distanceMeters?.let { "${it} м · " } ?: ""
            text = "$dist${item.creatorName}"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(t.textSecondary)
        })
        card.addView(space(context, 12))
        card.addView(makePrimaryButton(context, t, "Взять заявку", onTake))
        return card
    }

    private fun makeMineCard(context: Context, t: Theme, item: MineItem, onComplete: () -> Unit): View {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundRect(t.cardBg, dp(context, 12).toFloat())
            setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
        }
        card.addView(TextView(context).apply {
            text = Categories.label(item.category); setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(t.accent); setTypeface(null, Typeface.BOLD)
        })
        card.addView(TextView(context).apply {
            text = item.description; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(t.textPrimary); setPadding(0, dp(context, 4), 0, dp(context, 6))
        })
        card.addView(TextView(context).apply {
            val uname = item.creatorUsername?.let { " @$it" } ?: ""
            text = "${item.creatorName}$uname · ${item.status}"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); setTextColor(t.textSecondary)
        })
        if (item.status == "TAKEN") {
            card.addView(space(context, 12))
            card.addView(makePrimaryButton(context, t, "Завершить", onComplete))
        }
        return card
    }

    private fun makePrimaryButton(context: Context, t: Theme, text: String, onClick: () -> Unit) =
        TextView(context).apply {
            this.text = text; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setTypeface(null, Typeface.BOLD)
            setTextColor(t.accentText); gravity = Gravity.CENTER
            background = roundRect(t.accent, dp(context, 10).toFloat())
            setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
            setOnClickListener { onClick() }
        }

    private fun makeSecondaryButton(context: Context, t: Theme, text: String, onClick: () -> Unit) =
        TextView(context).apply {
            this.text = text; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setTextColor(t.textPrimary)
            gravity = Gravity.CENTER; background = roundRect(t.secondaryBtn, dp(context, 10).toFloat())
            setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
            setOnClickListener { onClick() }
        }

    private fun makeLabel(context: Context, t: Theme, text: String) = TextView(context).apply {
        this.text = text; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f); setTextColor(t.textSecondary)
        setPadding(0, 0, 0, dp(context, 6))
    }

    private fun space(context: Context, v: Int) = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, v))
    }

    private fun roundRect(color: Int, radius: Float) = GradientDrawable().apply {
        setColor(color); cornerRadius = radius
    }

    private fun dp(context: Context, value: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics
    ).toInt()
}
