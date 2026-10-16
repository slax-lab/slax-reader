package android.webkit

import java.io.InputStream

class WebResourceResponse(val mime: String?, val encoding: String?, val data: InputStream) {
  var status = 200
  var headers: Map<String, String> = emptyMap()
  constructor(mime: String?, encoding: String?, status: Int, reason: String, headers: Map<String, String>, data: InputStream): this(mime, encoding, data) { this.status = status; this.headers = headers }
}
