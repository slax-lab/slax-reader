plugins { kotlin("multiplatform") version "2.4.10" }
kotlin {
    iosSimulatorArm64 {
        binaries.framework {
            baseName = "SlaxLegacyFixture"
            isStatic = true
            linkerOpts("-lsqlite3")
        }
    }
    sourceSets.commonMain.dependencies {
        implementation("com.powersync:core:1.14.1")
        implementation("androidx.datastore:datastore-preferences-core:1.2.1")
        implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
        implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    }
}
