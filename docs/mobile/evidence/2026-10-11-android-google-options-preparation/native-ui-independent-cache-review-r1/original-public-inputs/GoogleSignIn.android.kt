package com.slax.reader.domain.auth

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import app.slax.reader.SlaxConfig
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.lang.ref.WeakReference

actual class GoogleSignInProvider {
    companion object {
        private var activityRef: WeakReference<ComponentActivity>? = null

        fun setActivity(activity: ComponentActivity) {
            activityRef = WeakReference(activity)
        }
    }

    actual suspend fun signIn(): Result<GoogleSignInResult> {
        val activity = activityRef?.get()
            ?: return Result.failure(Exception("Activity not available"))

        val credentialManager = CredentialManager.create(activity)

        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(SlaxConfig.GOOGLE_AUTH_SERVER_ID)
            .setAutoSelectEnabled(true)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        return try {
            val result = credentialManager.getCredential(activity, request)
            val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(result.credential.data)
            Result.success(
                GoogleSignInResult(
                    idToken = googleIdTokenCredential.idToken,
                    email = googleIdTokenCredential.id,
                    displayName = googleIdTokenCredential.displayName
                )
            )
        } catch (e: GetCredentialCancellationException) {
            Result.failure(Exception("Sign in canceled"))
        } catch (e: GoogleIdTokenParsingException) {
            Result.failure(Exception("Failed to parse Google ID token: ${e.message}"))
        } catch (e: GetCredentialException) {
            Result.failure(Exception("Sign in failed: ${e.message}"))
        }
    }
}

@Composable
actual fun rememberGoogleSignInProvider(): GoogleSignInProvider {
    val context = LocalContext.current
    return remember {
        GoogleSignInProvider().also {
            if (context is ComponentActivity) {
                GoogleSignInProvider.setActivity(context)
            }
        }
    }
}
