import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('source_preparer', Path(__file__).with_name('prepare-source.py'))
preparer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparer)


class SourcePreparerSafetyTest(unittest.TestCase):
    def test_secret_names_and_traversal_are_rejected_before_reading(self):
        for path in ['.env', '.env.local', '.dev.vars', 'credentials/client.kt', 'GoogleService-Info.plist',
                     'public/private-key.kt', '../outside.kt', '/tmp/source.kt']:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    preparer.safe_relative(path, ['*'])

    def test_closed_whitelist_rejects_other_config_and_accepts_source(self):
        self.assertEqual(preparer.safe_relative('composeApp/src/commonMain/kotlin/com/example/UI.kt',
                                              ['composeApp/src/commonMain/kotlin/**/*.kt']),
                         Path('composeApp/src/commonMain/kotlin/com/example/UI.kt'))
        for path in ['build.gradle.kts', 'local.properties', 'composeApp/src/commonMain/kotlin/config.json']:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    preparer.safe_relative(path, ['composeApp/src/commonMain/kotlin/**/*.kt'])


if __name__ == '__main__':
    unittest.main()
