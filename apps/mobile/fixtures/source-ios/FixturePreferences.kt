package com.slax.reader.data.preferences
import org.koin.dsl.module

/** No production App Group is opened by the unique source fixture application. */
internal var fixturePreferences: AppPreferences? = null
actual fun getPreferences(): AppPreferences = checkNotNull(fixturePreferences) {"Fixture preferences must be prepared before composition"}
actual val preferencesPlatformModule = module {single<AppPreferences> {getPreferences()}}
