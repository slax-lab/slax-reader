package com.slax.reader.platform

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal object SlaxGoogleSignIn {
  fun request(webClientId: String): GetCredentialRequest {
    require(webClientId.isNotBlank()) { "Google Sign-In client ID has not been configured" }
    val option = GetGoogleIdOption.Builder()
      .setFilterByAuthorizedAccounts(false)
      .setServerClientId(webClientId)
      .setAutoSelectEnabled(true)
      .build()
    return GetCredentialRequest.Builder().addCredentialOption(option).build()
  }

  suspend fun signIn(activity: Activity, webClientId: String): String? = withContext(Dispatchers.Main) {
    val request = request(webClientId)
    try {
      val result = CredentialManager.create(activity).getCredential(activity, request)
      GoogleIdTokenCredential.createFrom(result.credential.data).idToken
    } catch (_: GetCredentialCancellationException) {
      null
    }
  }
}
