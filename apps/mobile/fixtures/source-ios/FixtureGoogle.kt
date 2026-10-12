package com.slax.reader.domain.auth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/** LoginScreen receives the explicit scenario provider callback; the native Google SDK cannot run. */
actual class GoogleSignInProvider {
    actual suspend fun signIn(): Result<GoogleSignInResult> = Result.failure(IllegalStateException("An explicit synthetic provider is required"))
}
@Composable actual fun rememberGoogleSignInProvider(): GoogleSignInProvider = remember {GoogleSignInProvider()}
