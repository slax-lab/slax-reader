package com.slax.reader.extension

import java.io.InterruptedIOException
import java.net.SocketTimeoutException

internal fun Exception.isShareTimeout(): Boolean =
  this is SocketTimeoutException || (this is InterruptedIOException && message == "timeout")
