package android.net

class Uri private constructor(private val value: java.net.URI) {
  val scheme: String? get() = value.scheme
  val path: String? get() = value.path
  override fun toString() = value.toString()
  companion object {
    fun parse(value: String) = Uri(java.net.URI(value))
    fun fromFile(file: java.io.File) = Uri(file.toURI())
  }
}
