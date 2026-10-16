package com.slax.reader.utils

/** External SDK delivery and standalone platform flows are deliberately unavailable in UI fixtures. */
actual object FirebaseHelper {
    actual fun logEvent(name: String, params: Map<String, Any>?) = Unit
    actual fun setUserId(userId: String?) = Unit
    actual fun setUserProperty(name: String, value: String?) = Unit
    actual fun setCrashlyticsUserId(userId: String?) = Unit
}
actual fun shareContent(title: String, text: String, url: String, imageBytes: ByteArray?) {
    error("Native outbound sharing requires its separate source fixture")
}
actual class IAPManager actual constructor() {
    private var callback: IAPCallback? = null
    actual fun setCallback(callback: IAPCallback?) {this.callback = callback}
    actual fun loadProducts(productIds: List<String>) {callback?.onLoadFailed("StoreKit is unavailable in controlled UI fixtures")}
    actual fun purchase(productId: String, orderId: String) {error("No real purchase is allowed in a UI fixture")}
    actual fun purchaseWithOffer(productId: String, orderId: String, offer: IAPProductOffer) {error("No real purchase is allowed in a UI fixture")}
    actual fun restorePurchases() {error("No real restoration is allowed in a UI fixture")}
    actual fun isPurchased(productId: String): Boolean = false
    actual fun getPurchasedIds(): List<String> = emptyList()
    actual fun canMakePayments(): Boolean = false
    actual fun getProducts(): List<IAPProduct> = emptyList()
}
