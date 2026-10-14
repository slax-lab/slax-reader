package com.slax.reader.platform

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.BoringLayout
import android.text.StaticLayout
import android.text.SpannableString
import android.text.Spanned
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.TextUtils
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.max
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Plain source labels retain fractional TextPaint size instead of React Native's integer SP ceil. */
class SlaxTextView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  var text = ""
  var fontSize = 11.0
  var fontWeight = 400
  var textColor = "#0F1419"
  var alignment = "left"
  var centerAsGroup = false
  var ellipsis = "end"
  var paragraph = false
  var maxLines = 1
  var lineHeightSp = 0.0
  var measurementKey = ""
  val onTextMetrics by EventDispatcher()
  private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
  private var layout: Layout? = null
  private var drawLeft = 0
  private var drawTop = 0
  private var lastHeight = -1
  private var lastMetricsKey = ""

  init {setWillNotDraw(false); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES}

  fun update() {
    val density = resources.displayMetrics.density
    paint.density = density
    paint.textSize = SlaxTextScaling.spToDp(fontSize.coerceIn(1.0, 200.0).toFloat(), resources.configuration.fontScale) * density
    paint.typeface = if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, fontWeight.coerceIn(1, 1000), false)
      else Typeface.create(if (fontWeight >= 500) "sans-serif-medium" else "sans-serif", if (fontWeight >= 700) Typeface.BOLD else Typeface.NORMAL)
    paint.color = runCatching {
      // Paragraph props use the repository's React Native RRGGBBAA tokens.
      val nativeColor = if (paragraph && textColor.startsWith("#") && textColor.length == 9)
        "#${textColor.takeLast(2)}${textColor.substring(1, 7)}" else textColor
      Color.parseColor(nativeColor)
    }.getOrDefault(Color.BLACK)
    paint.textLocales = resources.configuration.locales
    paint.letterSpacing = 0f
    paint.isSubpixelText = false
    paint.hinting = Paint.HINTING_ON
    contentDescription = text
    rebuild()
  }

  private fun rebuild() {
    if (width <= 0) {layout = null; return}
    val mode = when (ellipsis) {"middle" -> TextUtils.TruncateAt.MIDDLE; "clip" -> null; else -> TextUtils.TruncateAt.END}
    val textAlignment = when (alignment) {"center" -> Layout.Alignment.ALIGN_CENTER; "right" -> Layout.Alignment.ALIGN_OPPOSITE; else -> Layout.Alignment.ALIGN_NORMAL}
    val boring = BoringLayout.isBoring(text, paint)
    val intrinsicWidth = ceil(Layout.getDesiredWidth(text, paint).toDouble()).toInt().coerceAtLeast(1)
    val fits = intrinsicWidth <= width
    val compact = !paragraph && fits && (alignment == "center" || centerAsGroup)
    val layoutWidth = if (compact) intrinsicWidth else width
    drawLeft = if (compact) ((width - layoutWidth) / 2f).roundToInt() else 0
    val sourceText: CharSequence = if (paragraph && lineHeightSp.isFinite() && lineHeightSp > 0 && text.isNotEmpty()) {
      // Density resolves line height relative to the actual scaled font above 1.05,
      // before Material3's centered leading is retained on every line.
      val heightSp = lineHeightSp.coerceIn(1.0, 1000.0).toFloat()
      val heightPx = if (resources.configuration.fontScale > 1.05f)
        heightSp / fontSize.coerceIn(1.0, 200.0).toFloat() * paint.textSize
      else SlaxTextScaling.spToDp(heightSp, resources.configuration.fontScale) * resources.displayMetrics.density
      SpannableString(text).apply {setSpan(SlaxLineHeightSpan(heightPx), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)}
    } else text
    val lineLimit = if (paragraph) if (maxLines <= 0) Int.MAX_VALUE else maxLines else 1
    val builder = StaticLayout.Builder.obtain(sourceText, 0, sourceText.length, paint, layoutWidth)
      .setAlignment(textAlignment).setIncludePad(false).setMaxLines(lineLimit)
      .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_LTR)
      .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE).setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
    if (mode != null && (!paragraph || maxLines > 0)) builder.setEllipsize(if (paragraph) TextUtils.TruncateAt.END else mode).setEllipsizedWidth(layoutWidth)
    if (Build.VERSION.SDK_INT >= 28) builder.setUseLineSpacingFromFallbacks(true)
    layout = if (!paragraph && boring != null && fits) BoringLayout.make(text, paint, layoutWidth, textAlignment, 1f, 0f, boring, false)
      else builder.build()
    // Single-line mode retains its existing BoringLayout/native metrics.
    val actualLayout = checkNotNull(layout)
    drawTop = 0
    var bottomPadding = 0
    if (paragraph && Build.VERSION.SDK_INT < 28 && actualLayout.lineCount > 0) {
      // Original TextLayout adds glyph bounds only when native fallback spacing
      // is unavailable. Center/None leading is already included in the layout.
      val bounds = android.graphics.Rect()
      paint.getTextBounds(text, actualLayout.getLineStart(0), actualLayout.getLineEnd(0), bounds)
      drawTop = max(0, actualLayout.getLineAscent(0) - bounds.top)
      val last = actualLayout.lineCount - 1
      paint.getTextBounds(text, actualLayout.getLineStart(last), actualLayout.getLineEnd(last), bounds)
      bottomPadding = max(0, bounds.bottom - actualLayout.getLineDescent(last))
    }
    val naturalHeight = max(1, actualLayout.height + drawTop + bottomPadding)
    val metricsKey = "$text/$fontSize/$fontWeight/${resources.configuration.fontScale}/$paragraph/$lineHeightSp/$maxLines/$layoutWidth/$measurementKey"
    if (naturalHeight != lastHeight || metricsKey != lastMetricsKey) {
      lastHeight = naturalHeight
      lastMetricsKey = metricsKey
      onTextMetrics(mapOf(
        "height" to naturalHeight / resources.displayMetrics.density.toDouble(),
        "width" to intrinsicWidth / resources.displayMetrics.density.toDouble(),
        "text" to text, "fontSize" to fontSize, "fontWeight" to fontWeight,
        "fontScale" to resources.configuration.fontScale.toDouble(),
        "layoutWidth" to layoutWidth / resources.displayMetrics.density.toDouble(),
        "lineHeightSp" to lineHeightSp, "maxLines" to maxLines, "paragraph" to paragraph,
        "measurementKey" to measurementKey, "lineCount" to actualLayout.lineCount
      ))
    }
    invalidate()
  }
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {super.onSizeChanged(w, h, oldw, oldh); rebuild()}
  override fun onConfigurationChanged(newConfig: Configuration) {super.onConfigurationChanged(newConfig); update()}
  override fun onDraw(canvas: Canvas) {super.onDraw(canvas); canvas.save(); canvas.translate(drawLeft.toFloat(), drawTop.toFloat()); layout?.draw(canvas); canvas.restore()}
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info); info.className = "android.widget.TextView"; info.text = text
  }
}
