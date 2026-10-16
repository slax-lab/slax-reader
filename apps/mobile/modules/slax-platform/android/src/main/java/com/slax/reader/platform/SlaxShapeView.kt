package com.slax.reader.platform

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import android.view.ViewOutlineProvider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.ceil
import kotlin.math.min

/** Source Compose rounded background, inside border and native outline clipping. */
class SlaxShapeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var radius = 16.0
  var corners = "all"
  var fillColor = "#00000000"
  var borderColor = "#00000000"
  var borderWidth = 0.0
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()
  private val path = Path()

  init {
    setWillNotDraw(false); clipToPadding = false; clipToOutline = true
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        val px = cornerPixels()
        if (corners == "top") {
          path.reset(); rect.set(0f, 0f, width.toFloat(), height.toFloat())
          path.addRoundRect(rect, floatArrayOf(px, px, px, px, 0f, 0f, 0f, 0f), Path.Direction.CW)
          @Suppress("DEPRECATION") outline.setConvexPath(path)
        } else outline.setRoundRect(0, 0, width, height, px)
      }
    }
  }

  fun update() {invalidateOutline(); invalidate()}
  private fun cornerPixels() = min(radius.coerceAtLeast(0.0).toFloat() * resources.displayMetrics.density, min(width, height) / 2f)
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {super.onSizeChanged(w, h, oldw, oldh); update()}
  // Yoga lays out React children; LinearLayout must not reposition them.
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    rect.set(0f, 0f, width.toFloat(), height.toFloat())
    val px = cornerPixels()
    paint.style = Paint.Style.FILL; paint.color = shapeColor(fillColor)
    if (corners == "top") canvas.drawRect(rect, paint) else canvas.drawRoundRect(rect, px, px, paint)
    val stroke = ceil(borderWidth.coerceAtLeast(0.0).toFloat() * resources.displayMetrics.density)
    if (stroke <= 0f) return
    paint.style = Paint.Style.STROKE; paint.strokeWidth = stroke; paint.color = shapeColor(borderColor)
    val half = stroke / 2f
    rect.inset(half, half)
    val inner = (px - half).coerceAtLeast(0f)
    if (corners == "top") {
      path.reset(); path.addRoundRect(rect, floatArrayOf(inner, inner, inner, inner, 0f, 0f, 0f, 0f), Path.Direction.CW)
      canvas.drawPath(path, paint)
    } else canvas.drawRoundRect(rect, inner, inner, paint)
  }

  private fun shapeColor(value: String): Int = runCatching {
    val hex = value.removePrefix("#")
    require(value.startsWith("#") && hex.length in setOf(6, 8))
    val number = hex.toLong(16)
    if (hex.length == 6) (0xff000000L or number).toInt()
    else ((number and 0xffL) shl 24 or (number ushr 8)).toInt()
  }.getOrDefault(Color.TRANSPARENT)
}
