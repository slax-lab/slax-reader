import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlinx.atomicfu")
}

// Public source versions are pinned here. No production build scripts are evaluated.
kotlin {
    androidTarget {
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        instrumentedTestVariant.sourceSetTree.set(org.jetbrains.kotlin.gradle.plugin.KotlinSourceSetTree.test)
    }
    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.compose.runtime:runtime:1.11.1")
            implementation("org.jetbrains.compose.foundation:foundation:1.11.1")
            implementation("org.jetbrains.compose.material3:material3:1.9.0")
            implementation("org.jetbrains.compose.ui:ui:1.11.1")
            implementation("org.jetbrains.compose.components:components-resources:1.11.1")
            implementation("org.jetbrains.compose.ui:ui-tooling-preview:1.11.1")
            implementation("org.jetbrains.androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
            implementation("org.jetbrains.androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
            implementation("org.jetbrains.androidx.navigation:navigation-compose:2.9.2")
            implementation("androidx.datastore:datastore-preferences:1.2.1")
            api("com.powersync:core:1.14.1")
            implementation("io.insert-koin:koin-core:4.2.2")
            implementation("io.insert-koin:koin-compose:4.2.2")
            implementation("io.insert-koin:koin-compose-viewmodel:4.2.2")
            implementation("io.ktor:ktor-client-core:3.5.2")
            implementation("io.ktor:ktor-client-content-negotiation:3.5.2")
            implementation("io.ktor:ktor-serialization-kotlinx-json:3.5.2")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.8.0")
            implementation("io.github.panpf.sketch4:sketch-compose:4.4.0")
            implementation("io.github.panpf.sketch4:sketch-http:4.4.0")
            implementation("io.github.panpf.sketch4:sketch-animated-gif:4.4.0")
            implementation("io.github.panpf.sketch4:sketch-svg:4.4.0")
            implementation("io.github.panpf.sketch4:sketch-compose-resources:4.4.0")
            implementation("io.github.panpf.sketch4:sketch-extensions-compose-resources:4.4.0")
            implementation("com.squareup.okio:okio:3.18.1")
            implementation("org.jetbrains.kotlinx:atomicfu:0.33.0")
            implementation("dev.jordond.connectivity:connectivity-core:2.4.1")
            implementation("dev.jordond.connectivity:connectivity-device:2.4.1")
            implementation("dev.jordond.connectivity:connectivity-compose-device:2.4.1")
            implementation("com.mikepenz:multiplatform-markdown-renderer-m3:0.41.0")
            implementation("com.fleeksoft.ksoup:ksoup:0.2.6")
        }
        androidMain {
            kotlin.exclude("**/FirebaseHelper.android.kt")
            kotlin.exclude("**/WebviewHelper.android.kt")
            kotlin.srcDir("src/fixtureMain/kotlin")
            dependencies {
                implementation("org.jetbrains.compose.ui:ui-tooling-preview:1.11.1")
                implementation("androidx.activity:activity-compose:1.13.0")
                implementation("io.ktor:ktor-client-okhttp:3.5.2")
                implementation("io.insert-koin:koin-android:4.2.2")
                implementation("androidx.browser:browser:1.10.0")
                implementation("io.github.panpf.sketch4:sketch-animated-gif-koral:4.4.0")
                implementation("com.google.firebase:firebase-analytics-ktx:22.5.0")
                implementation("com.google.firebase:firebase-crashlytics-ktx:19.4.4")
                implementation("androidx.credentials:credentials:1.6.0")
                implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
                implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")
            }
        }
        // Keep the pinned legacy tests as provenance, outside this capture harness.
        commonTest { kotlin.setSrcDirs(emptyList<String>()) }
        androidInstrumentedTest {
            kotlin.setSrcDirs(listOf("src/fixtureInstrumentedTest/kotlin"))
            dependencies {
                implementation("androidx.compose.ui:ui-test-junit4-android:1.11.2")
                implementation("androidx.test:runner:1.7.0")
                implementation("androidx.test:core:1.7.0")
                implementation("junit:junit:4.13.2")
            }
        }
    }
    compilerOptions { freeCompilerArgs.add("-Xname-based-destructuring=only-syntax") }
}
compose.resources {
    packageOfResClass = "slax_reader_client.composeapp.generated.resources"
}
android {
    namespace = "com.slax.reader"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.slax.reader.fixture"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "fixture"
        testInstrumentationRunner = "com.slax.reader.fixtures.FixtureRunner"
    }
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes { getByName("debug") { isMinifyEnabled = false } }
}
dependencies {
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.11.2")
}
