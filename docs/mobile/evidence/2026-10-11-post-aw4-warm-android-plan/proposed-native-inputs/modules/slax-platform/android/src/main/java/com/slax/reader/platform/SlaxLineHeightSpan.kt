package com.slax.reader.platform

import android.graphics.Paint
import android.text.style.LineHeightSpan
import kotlin.math.ceil

/** The source Material3 Text inherits centered leading, Fixed height, and Trim.None. */
internal class SlaxLineHeightSpan(private val lineHeight: Float) : LineHeightSpan {
  private var initialized = false
  private var ascent = 0
  private var descent = 0

  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanStartV: Int, lineHeightV: Int, fm: Paint.FontMetricsInt) {
    val naturalHeight = fm.descent - fm.ascent
    if (naturalHeight <= 0) return
    if (!initialized) {
      val targetHeight = ceil(lineHeight.toDouble()).toInt()
      val extra = targetHeight - naturalHeight
      val descentExtra = ceil((extra * .5f).toDouble()).toInt()
      descent = fm.descent + descentExtra
      ascent = descent - targetHeight
      initialized = true
    }
    fm.ascent = ascent
    fm.descent = descent
  }
}
