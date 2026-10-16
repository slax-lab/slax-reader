#!/usr/bin/env python3
"""Check native cache flags against installed public Xcode specifications, without tools."""
import ast
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[6]
SPEC=Path('/Applications/Xcode.app/Contents/SharedFrameworks/XCBuild.framework/Versions/A/PlugIns/XCBBuildService.bundle/Contents/PlugIns/XCBSpecifications.ideplugin/Contents/Resources')
class CacheGuard(unittest.TestCase):
    def test_swift_and_clang_caching_disabled_with_owned_swift_module_cache(self):
        source=(ROOT/'apps/mobile/fixtures/source-ios/control/build-native-scroll.py').read_text()
        tree=ast.parse(source)
        calls=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='run' and any(isinstance(arg,ast.Constant) and arg.value=='build-native-scroll-control-only' for arg in node.args)]
        self.assertEqual(len(calls),1)
        constants=[node.value for node in ast.walk(calls[0].args[0]) if isinstance(node,ast.Constant) and isinstance(node.value,str)]
        for flag in ['CLANG_ENABLE_COMPILE_CACHE=NO','SWIFT_ENABLE_COMPILE_CACHE=NO','COMPILATION_CACHE_ENABLE_CACHING=NO']:
            self.assertEqual(constants.count(flag),1)
        swift=(SPEC/'Swift.xcspec').read_text();core=(SPEC/'CoreBuildSystem.xcspec').read_text()
        self.assertIn('Name = "SWIFT_ENABLE_COMPILE_CACHE";',swift)
        self.assertIn('DefaultValue = "$(COMPILATION_CACHE_ENABLE_CACHING)";',swift)
        self.assertIn('Name = "COMPILATION_CACHE_ENABLE_CACHING";',core)
        self.assertIn('Name = "CLANG_MODULE_CACHE_PATH";\n                Type = Path;\n                CommandLineFlag = "-module-cache-path";',swift)
        self.assertIn("'CLANG_MODULE_CACHE_PATH=' + str(derived / 'ModuleCache.noindex')",source)
        self.assertNotIn('SWIFT_MODULE_CACHE_PATH=',source)
if __name__=='__main__':unittest.main(verbosity=2)
