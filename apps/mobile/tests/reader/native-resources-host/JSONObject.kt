package org.json

class JSONObject(private val value: String) {
  init { require(value == "{\"values\":{\"download_images\":0}}" || value == "{\"download_images\":0}") {"Unexpected fixture JSON"} }
  fun optBoolean(key: String): Boolean = error(key)
  fun optInt(key: String): Int = optInt(key, 0)
  fun optInt(key: String, fallback: Int): Int {require(key == "download_images"); return 0}
  fun getJSONObject(key: String): JSONObject {require(key == "values"); return JSONObject("{\"download_images\":0}")}
}
