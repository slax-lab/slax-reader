package com.slax.reader.platform

import kotlin.math.abs

/** Compare the application converter against the actual pinned Compose artifact, not copied expectations. */
fun main() {
  val factoryClass = Class.forName("androidx.compose.ui.unit.fontscaling.FontScaleConverterFactory")
  val factory = factoryClass.getField("INSTANCE").get(null)
  val forScale = factoryClass.getMethod("forScale", Float::class.javaPrimitiveType)
  val converterType = Class.forName("androidx.compose.ui.unit.fontscaling.FontScaleConverter")
  val convert = converterType.getMethod("convertSpToDp", Float::class.javaPrimitiveType)
  var comparisons = 0
  for (scale in listOf(.85f, 1f, 1.01f, 1.03f, 1.1f, 1.15f, 1.2f, 1.3f, 1.5f, 1.65f, 1.8f, 2f, 2.009f, 2.4f)) {
    val source = forScale.invoke(factory, scale)
    for (size in listOf(0f, 5f, 8f, 11f, 12f, 15f, 17f, 20f, 24f, 30f, 50f, 100f, 120f, -11f)) {
      val expected = if (source == null) size * scale else convert.invoke(source, size) as Float
      val actual = SlaxTextScaling.spToDp(size, scale)
      check(abs(expected - actual) < .0001f) {"Source scaling mismatch: $size SP at $scale: $actual vs $expected"}
      comparisons++
    }
  }
  check(SlaxTextScaling.spToDp(15f, 1f) * 2.625f == 39.375f)
  check(SlaxTextScaling.spToDp(17f, 2f) != 17f * 2f)
  check(runCatching {SlaxTextScaling.spToDp(11f, Float.NaN)}.isFailure)
  println("Passed $comparisons comparisons against pinned Compose nonlinear font scaling")
}
