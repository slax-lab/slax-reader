package android.graphics

/** Metric-only host boundary; no Android layout, paint or raster behavior is simulated. */
class Paint {
  class FontMetricsInt {
    @JvmField var top = 0
    @JvmField var ascent = 0
    @JvmField var descent = 0
    @JvmField var bottom = 0
    @JvmField var leading = 0
  }
}
