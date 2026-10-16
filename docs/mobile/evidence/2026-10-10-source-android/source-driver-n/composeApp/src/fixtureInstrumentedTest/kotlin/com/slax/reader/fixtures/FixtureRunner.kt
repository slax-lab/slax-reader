package com.slax.reader.fixtures

import android.app.Application
import android.content.Context
import android.accessibilityservice.AccessibilityServiceInfo
import androidx.test.runner.AndroidJUnitRunner

/** The isolated fixture package never starts SlaxReaderApplication or its production DI graph. */
class FixtureRunner : AndroidJUnitRunner() {
    override fun onStart() {
        // Connect before ActivityScenario launches so active-window events are retained.
        uiAutomation.serviceInfo = uiAutomation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        }
        super.onStart()
    }
    override fun newApplication(loader: ClassLoader, className: String, context: Context): Application {
        check(context.packageName == "com.slax.reader.fixture" || context.packageName.startsWith("com.slax.reader.fixture.")) {
            "Source UI fixtures require a separate application identity"
        }
        return super.newApplication(loader, Application::class.java.name, context)
    }
}
