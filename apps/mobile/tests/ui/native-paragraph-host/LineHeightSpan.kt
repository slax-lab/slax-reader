package android.text.style

import android.graphics.Paint

interface LineHeightSpan {
  fun chooseHeight(text: CharSequence, start: Int, end: Int, spanStartV: Int, lineHeightV: Int, fm: Paint.FontMetricsInt)
}
