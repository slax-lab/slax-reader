package com.slax.reader.platform

import android.graphics.Paint
import android.text.style.LineHeightSpan

/** Compare the owned span to the actual pinned source span, including first/last leading. */
fun main() {
  val sourceClass = Class.forName("androidx.compose.ui.text.android.style.LineHeightStyleSpan")
  val constructor = sourceClass.getDeclaredConstructor(Float::class.javaPrimitiveType, Int::class.javaPrimitiveType, Int::class.javaPrimitiveType,
    Boolean::class.javaPrimitiveType, Boolean::class.javaPrimitiveType, Float::class.javaPrimitiveType, Int::class.javaPrimitiveType).apply {isAccessible = true}
  val modeClass = Class.forName("androidx.compose.ui.text.style.LineHeightStyle\$Mode")
  val companion = modeClass.getField("Companion").get(null)
  val fixed = companion.javaClass.methods.single {it.name.startsWith("getFixed-")}.invoke(companion) as Int
  var comparisons = 0
  for (height in listOf(10f, 20f, 52.5f, 82.5f, 125f)) {
    for ((initialAscent, initialDescent) in listOf(-34 to 9, -54 to 14, -73 to 20)) {
      for (ranges in listOf(listOf(0 to 12), listOf(0 to 4, 4 to 8, 8 to 12), listOf(0 to 6, 6 to 12))) {
        val expected = constructor.newInstance(height, 0, 12, false, false, .5f, fixed) as LineHeightSpan
        val actual = SlaxLineHeightSpan(height)
        for ((start, end) in ranges) {
          fun metrics() = Paint.FontMetricsInt().apply {
            top = initialAscent - 6; ascent = initialAscent; descent = initialDescent; bottom = initialDescent + 3; leading = 2
          }
          val sourceMetrics = metrics(); val ownedMetrics = metrics()
          expected.chooseHeight("hello world!", start, end, 0, 0, sourceMetrics)
          actual.chooseHeight("hello world!", start, end, 0, 0, ownedMetrics)
          check(sourceMetrics.ascent == ownedMetrics.ascent && sourceMetrics.descent == ownedMetrics.descent && sourceMetrics.top == ownedMetrics.top && sourceMetrics.bottom == ownedMetrics.bottom && sourceMetrics.leading == ownedMetrics.leading) {
            "Source span mismatch at height=$height range=$start..$end metrics=$initialAscent/$initialDescent"
          }
          comparisons++
        }
      }
    }
  }
  println("Passed $comparisons first/middle/last/single-line metric comparisons against pinned Compose Material3 Center/None/Fixed span; native layout/raster remains separate")
}
