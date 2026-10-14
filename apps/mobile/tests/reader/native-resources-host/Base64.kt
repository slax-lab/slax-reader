package android.util
object Base64 {
  const val NO_WRAP = 2
  fun encodeToString(data: ByteArray, flags: Int): String = java.util.Base64.getEncoder().encodeToString(data)
}
