plugins {
    id("com.android.application") version "8.12.0"
    kotlin("android") version "2.4.10"
}
android {
    namespace = "com.slax.reader"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.slax.reader"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "legacy-fixture"
    }
    // Use the new app's generated public debug test identity; never use release signing material.
    signingConfigs.getByName("debug") {
        storeFile = file(requireNotNull(findProperty("expoMobileDir")) { "Provide -PexpoMobileDir for the generated app public debug identity" }.toString() + "/android/app/debug.keystore")
    }
    buildTypes.getByName("debug") { signingConfig = signingConfigs.getByName("debug") }
}
dependencies {
    implementation("com.powersync:core:1.14.1")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
}
kotlin { jvmToolchain(17) }
