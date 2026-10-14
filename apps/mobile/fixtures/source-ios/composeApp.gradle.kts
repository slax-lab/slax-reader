plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlinx.atomicfu")
}

// Only closed public source inputs and fixture overlays are evaluated.
kotlin {
    iosSimulatorArm64 {
        compilations.getByName("main").cinterops.create("fixtureFoundation") {
            definitionFile.set(project.file("src/fixtureIosMain/cinterop/fixture-foundation.def"))
            includeDirs("src/fixtureIosMain/cinterop")
        }
        binaries.framework {
            baseName = "SlaxSourceFixture"
            isStatic = false
            linkerOpts("-lsqlite3")
        }
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
        iosMain {
            kotlin.exclude("**/MainViewController.kt", "**/FirebaseHelper.ios.kt", "**/IapHelper.ios.kt", "**/ShareHelper.ios.kt", "**/GoogleSignIn.ios.kt", "**/PreferencesDataStore.ios.kt", "**/WebViewHelper.ios.kt")
            kotlin.srcDir("src/fixtureIosMain/kotlin")
            dependencies { implementation("io.ktor:ktor-client-darwin:3.5.2") }
        }
        commonTest { kotlin.setSrcDirs(emptyList<String>()) }
        iosSimulatorArm64Test { kotlin.setSrcDirs(emptyList<String>()) }
    }
    compilerOptions { freeCompilerArgs.add("-Xname-based-destructuring=only-syntax"); optIn.add("kotlinx.cinterop.ExperimentalForeignApi") }
}
compose.resources { packageOfResClass = "slax_reader_client.composeapp.generated.resources" }
