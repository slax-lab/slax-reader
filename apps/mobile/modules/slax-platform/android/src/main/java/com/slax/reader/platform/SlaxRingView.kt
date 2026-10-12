package com.slax.reader.platform

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Outline
import android.graphics.RectF
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import android.view.View
import android.view.ViewOutlineProvider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.ceil

/** Source CacheSizeRing and the pinned Material3 1.9.0 circular indicator geometry. */
class SlaxRingView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  var segments = "[]"
  var thickness = 1.0
  var diameter = 24.0
  var track = "#E8E6E3"
  var geometry = "cache"
  var revealDuration = 0
  var indeterminate = false
  private data class Segment(val fraction: Float, val color: Int)
  private var prepared = emptyList<Segment>()
  private var fingerprint: String? = null
  private var reveal = 1f
  private var phase = 0f
  private var revealAnimator: ValueAnimator? = null
  private var motionAnimator: ValueAnimator? = null
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {style = Paint.Style.STROKE}
  private val arc = RectF()
  private val standardEasing = PathInterpolator(0.2f, 0f, 0f, 1f)

  init {
    setWillNotDraw(false); clipChildren = false; clipToPadding = false; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {outline.setRoundRect(0, 0, view.width, view.height, min(view.width, view.height) / 2f)}
    }
  }

  fun update() {
    clipToOutline = geometry == "circle"
    invalidateOutline()
    val next = "$segments/$revealDuration/$geometry"
    if (next != fingerprint) {
      fingerprint = next
      prepared = runCatching {
        val array = JSONArray(segments)
        List(array.length()) {index ->
          val value = array.getJSONObject(index)
          val fraction = value.getDouble("fraction").let {if (it.isFinite()) it.coerceIn(0.0, 1.0).toFloat() else 0f}
          Segment(fraction, ringColor(value.getString("color")))
        }
      }.getOrDefault(emptyList())
      revealAnimator?.cancel(); revealAnimator = null
      reveal = if (revealDuration > 0 && isAttachedToWindow) 0f else 1f
      if (revealDuration > 0 && isAttachedToWindow) {
        revealAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
          duration = revealDuration.toLong(); interpolator = PathInterpolator(0.4f, 0f, 0.2f, 1f)
          addUpdateListener {reveal = it.animatedValue as Float; invalidate()}; start()
        }
      }
    }
    if (indeterminate && isAttachedToWindow && motionAnimator == null) {
      motionAnimator = ValueAnimator.ofFloat(0f, 6000f).apply {
        duration = 6000; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator()
        addUpdateListener {phase = it.animatedValue as Float; invalidate()}; start()
      }
    } else if (!indeterminate) {motionAnimator?.cancel(); motionAnimator = null; phase = 0f}
    invalidate()
  }

  override fun onAttachedToWindow() {super.onAttachedToWindow(); fingerprint = null; update()}
  override fun onDetachedFromWindow() {
    revealAnimator?.cancel(); revealAnimator = null; motionAnimator?.cancel(); motionAnimator = null
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val scale = resources.displayMetrics.density
    val size = diameter.coerceAtLeast(0.0).toFloat() * scale
    val stroke = thickness.coerceAtLeast(0.0).toFloat() * scale
    if (size <= 0f || stroke <= 0f) return
    if (geometry == "circle") {
      // Compose border rounds the physical stroke up and draws it inside its
      // pixel-rounded CircleShape layout, after the background fill.
      val radius = min(width, height) / 2f
      paint.style = Paint.Style.FILL; paint.color = ringColor(track)
      arc.set(0f, 0f, width.toFloat(), height.toFloat())
      // Source background(Color) fills the rectangle beneath the outer layer's
      // CircleShape clip; rounding the fill again changes edge coverage.
      canvas.drawRect(arc, paint)
      paint.style = Paint.Style.STROKE; paint.strokeWidth = ceil(stroke)
      prepared.firstOrNull()?.let {
        paint.color = it.color
        val halfStroke = paint.strokeWidth / 2f
        arc.inset(halfStroke, halfStroke)
        val innerRadius = (radius - halfStroke).coerceAtLeast(0f)
        canvas.drawRoundRect(arc, innerRadius, innerRadius, paint)
      }
      return
    }
    val radius = (size - if (geometry == "material") stroke else 0f) / 2f
    if (radius <= 0f) return
    arc.set(width / 2f - radius, height / 2f - radius, width / 2f + radius, height / 2f + radius)
    paint.strokeWidth = stroke
    paint.strokeCap = if (geometry == "material") Paint.Cap.ROUND else Paint.Cap.BUTT
    if (geometry == "material") {
      val progress = if (indeterminate) {
        if (phase <= 3000f) 0.1f + 0.77f * phase / 3000f
        else 0.87f - 0.77f * standardEasing.getInterpolation((phase - 3000f) / 3000f)
      } else prepared.firstOrNull()?.fraction ?: 0f
      val rotation = if (indeterminate) phase * 1080f / 6000f + (phase / 1500f).toInt() * 90f + min((phase % 1500f) / 300f, 1f) * 90f else -90f
      val sweep = progress * 360f
      val gap = min(sweep, ((4f * scale + stroke) / (PI.toFloat() * size)) * 360f)
      drawArc(canvas, rotation + sweep + gap, 360f - sweep - gap * 2f, ringColor(track))
      prepared.firstOrNull()?.let {drawArc(canvas, rotation, sweep, it.color)}
    } else {
      paint.color = ringColor(track); canvas.drawOval(arc, paint)
      var start = -90f
      prepared.forEach {segment ->
        val sweep = segment.fraction * 360f
        if (sweep > 0f) {val gap = min(2f, sweep / 4f); drawArc(canvas, start + gap / 2f, (sweep - gap) * reveal, segment.color)}
        start += sweep
      }
    }
  }
  private fun drawArc(canvas: Canvas, start: Float, sweep: Float, color: Int) {
    if (sweep <= 0f) return
    paint.color = color; canvas.drawArc(arc, start, sweep, false, paint)
  }
  private fun ringColor(value: String): Int = runCatching {
    val hex = value.removePrefix("#")
    require(value.startsWith("#") && hex.length in setOf(6, 8))
    val number = hex.toLong(16)
    if (hex.length == 6) (0xff000000L or number).toInt()
    else ((number and 0xffL) shl 24 or (number ushr 8)).toInt()
  }.getOrDefault(Color.TRANSPARENT)
}
