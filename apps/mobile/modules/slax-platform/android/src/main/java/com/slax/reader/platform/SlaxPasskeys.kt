package com.slax.reader.platform

import android.app.Activity
import android.os.CancellationSignal
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal object SlaxPasskeys {
  private var active: CancellationSignal? = null

  fun cancel() { active?.cancel(); active = null }

  suspend fun perform(activity: Activity, options: String, register: Boolean): String? = suspendCancellableCoroutine { continuation ->
    check(active == null) { "A passkey operation is already active" }
    val createRequest = if (register) CreatePublicKeyCredentialRequest(options) else null
    val getRequest = if (register) null else GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options)))
    val cancellation = CancellationSignal()
    active = cancellation
    continuation.invokeOnCancellation { cancellation.cancel() }
    fun complete(value: String?, error: Exception? = null) {
      if (active === cancellation) active = null
      if (continuation.isActive) {
        if (error == null) continuation.resume(value) else continuation.resumeWithException(error)
      }
    }
    val manager = CredentialManager.create(activity)
    val executor = ContextCompat.getMainExecutor(activity)
    if (register) {
      manager.createCredentialAsync(activity, createRequest!!, cancellation, executor,
        object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
          override fun onResult(result: CreateCredentialResponse) {
            if (result is CreatePublicKeyCredentialResponse) complete(result.registrationResponseJson)
            else complete(null, IllegalStateException("Unexpected passkey registration response"))
          }
          override fun onError(error: CreateCredentialException) {
            if (error is CreateCredentialCancellationException) complete(null) else complete(null, error)
          }
        })
    } else {
      manager.getCredentialAsync(activity, getRequest!!, cancellation, executor,
        object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
          override fun onResult(result: GetCredentialResponse) {
            val credential = result.credential
            if (credential is PublicKeyCredential) complete(credential.authenticationResponseJson)
            else complete(null, IllegalStateException("Unexpected passkey authentication response"))
          }
          override fun onError(error: GetCredentialException) {
            if (error is GetCredentialCancellationException) complete(null) else complete(null, error)
          }
        })
    }
  }
}
