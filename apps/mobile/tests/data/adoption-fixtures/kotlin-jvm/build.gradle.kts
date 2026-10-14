plugins {
    kotlin("jvm") version "2.4.10"
    application
}
dependencies {
    implementation("com.powersync:core:1.14.1")
    implementation("androidx.datastore:datastore-preferences-core:1.2.1")
    implementation("androidx.datastore:datastore-core-okio:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
}
kotlin { jvmToolchain(21) }
application { mainClass.set("FixtureKt") }
