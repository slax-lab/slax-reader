package org.json

// These tests deliberately do not exercise fixture or preference JSON parsing.
class JSONObject(value: String) {
  init { error("Unexpected JSON parsing in the resource concurrency fixture: $value") }
  fun optBoolean(key: String): Boolean = error(key)
  fun optInt(key: String): Int = error(key)
  fun optInt(key: String, fallback: Int): Int = error("$key/$fallback")
  fun getJSONObject(key: String): JSONObject = error(key)
}
