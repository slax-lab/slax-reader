const {createRunOncePlugin, withAndroidManifest} = require('expo/config-plugins');

const PROVIDER = 'com.slax.reader.platform.SlaxReadingWidgetProvider';

function withSlaxAndroidWidget(config) {
  return withAndroidManifest(config, value => {
    const application = value.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest is missing');
    application.receiver ??= [];
    const existing = application.receiver.find(item => item.$?.['android:name'] === PROVIDER);
    if (existing) return value;
    application.receiver.push({
      $: {
        'android:name': PROVIDER,
        'android:exported': 'true',
        'android:label': 'Slax Reader',
        'android:permission': 'android.permission.BIND_APPWIDGET',
      },
      'intent-filter': [{action: [{$: {'android:name': 'android.appwidget.action.APPWIDGET_UPDATE'}}]}],
      'meta-data': [{$: {'android:name': 'android.appwidget.provider', 'android:resource': '@xml/slax_reading_widget_info'}}],
    });
    return value;
  });
}

module.exports = createRunOncePlugin(withSlaxAndroidWidget, 'with-slax-android-widget', '1.0.0');
