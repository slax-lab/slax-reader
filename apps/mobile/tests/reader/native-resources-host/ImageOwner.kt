package com.slax.reader.platform
internal object SlaxReaderView {
  var activeOwner: String? = "synthetic-owner"
  fun owns(owner: String) = activeOwner == owner
}
