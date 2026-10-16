package com.slax.reader.utils

/** Capture-only analytics port. Production Firebase initialization is never used by fixtures. */
actual object FirebaseHelper {
    actual fun logEvent(name: String, params: Map<String, Any>?) {}
    actual fun setUserId(userId: String?) {}
    actual fun setUserProperty(name: String, value: String?) {}
    actual fun setCrashlyticsUserId(userId: String?) {}
}
