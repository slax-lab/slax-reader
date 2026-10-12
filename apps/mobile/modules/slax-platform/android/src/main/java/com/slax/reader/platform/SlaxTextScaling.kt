package com.slax.reader.platform

import kotlin.math.abs
import kotlin.math.sign

/** Pinned Compose UI 1.11.2 font-scaling curves, including nonlinear scaling on pre-34 Android. */
internal object SlaxTextScaling {
  private val sizes = floatArrayOf(8f, 10f, 12f, 14f, 18f, 20f, 24f, 30f, 100f)
  private val tables = listOf(
    1f to sizes,
    1.15f to floatArrayOf(9.2f, 11.5f, 13.8f, 16.4f, 19.8f, 21.8f, 25.2f, 30f, 100f),
    1.3f to floatArrayOf(10.4f, 13f, 15.6f, 18.8f, 21.6f, 23.6f, 26.4f, 30f, 100f),
    1.5f to floatArrayOf(12f, 15f, 18f, 22f, 24f, 26f, 28f, 30f, 100f),
    1.8f to floatArrayOf(14.4f, 18f, 21.6f, 24.4f, 27.6f, 30.8f, 32.8f, 34.8f, 100f),
    2f to floatArrayOf(16f, 20f, 24f, 26f, 30f, 34f, 36f, 38f, 100f),
  )

  fun spToDp(sp: Float, scale: Float): Float {
    require(sp.isFinite() && scale.isFinite() && scale > 0f)
    if (scale < 1.03f) return sp * scale
    val key = (scale * 100).toInt()
    val exact = tables.firstOrNull {(it.first * 100).toInt() == key}
    if (exact != null) return convert(sp, exact.second)
    if (scale > 2f) return sp * scale
    val upper = tables.indexOfFirst {(it.first * 100).toInt() > key}
    val lower = tables[upper - 1]
    val higher = tables[upper]
    val amount = ((scale - lower.first) / (higher.first - lower.first)).coerceIn(0f, 1f)
    val interpolated = FloatArray(sizes.size) {index -> lower.second[index] + amount * (higher.second[index] - lower.second[index])}
    return convert(sp, interpolated)
  }

  private fun convert(value: Float, outputs: FloatArray): Float {
    val positive = abs(value)
    val upper = sizes.indexOfFirst {it >= positive}
    if (upper < 0) return value * (outputs.last() / sizes.last())
    if (upper == 0) return value * (outputs[0] / sizes[0])
    val amount = (positive - sizes[upper - 1]) / (sizes[upper] - sizes[upper - 1])
    return sign(value) * (outputs[upper - 1] + amount * (outputs[upper] - outputs[upper - 1]))
  }
}
