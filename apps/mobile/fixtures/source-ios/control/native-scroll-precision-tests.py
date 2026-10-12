"""Evaluate the actual Swift projection expression with IEEE Float32 operations.

No Swift compiler, native process or device is invoked. These arithmetic guards
do not establish the applied Compose density or actual native scroll acceptance.
"""
import ast
import hashlib
from pathlib import Path
import re
import struct
import unittest

ROOT = Path(__file__).resolve().parents[5]
SWIFT = ROOT / 'apps/mobile/fixtures/source-ios/main.swift'
R2 = ROOT / 'docs/mobile/evidence/2026-10-11-source-ios-native240-plan/public-observer-driver-r2/source-inputs/apps/mobile/fixtures/source-ios/main.swift'
ORIGINAL = ROOT / 'docs/mobile/evidence/2026-10-11-source-ios-native240-plan/original-public-inputs/composeApp/src/iosMain/kotlin/com/slax/reader/utils/WebviewHelper.ios.kt'


def f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


def actual_projection(offset, inset, density):
    text = SWIFT.read_text()
    match = re.search(r'private func sourceCallbackFloat32Position\([^\n]+\) -> Float \{(.*?)\n    \}', text, re.S)
    if match is None:
        raise AssertionError('The actual optional observer projection is required')
    scope = {'offsetPoints': offset, 'insetPoints': inset, 'density': density}

    def expression(node):
        if isinstance(node, ast.Name) and node.id in scope:
            return scope[node.id]
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            if node.func.id == 'Float' and len(node.args) == 1:
                return f32(expression(node.args[0]))
            if node.func.id == 'max' and len(node.args) == 2:
                return max(expression(node.args[0]), expression(node.args[1]))
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Add):
                return f32(expression(node.left) + expression(node.right))
            if isinstance(node.op, ast.Mult):
                return f32(expression(node.left) * expression(node.right))
        raise AssertionError('Unreviewed arithmetic or mutation entered the actual projection')

    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith('//'):
            continue
        if line.startswith('let '):
            assignment = re.fullmatch(r'let ([A-Za-z]+) = (.+)', line)
            if assignment is None:
                raise AssertionError('Only local Float32 expressions are allowed')
            scope[assignment[1]] = expression(ast.parse(assignment[2], mode='eval').body)
        elif line.startswith('return '):
            return expression(ast.parse(line[7:], mode='eval').body)
        else:
            raise AssertionError('An unexpected statement entered the actual projection')
    raise AssertionError('Actual projection has no return value')


class NativeSourcePrecision(unittest.TestCase):
    def test_original_pinned_conversion_and_last_clamp_contract(self):
        data = ORIGINAL.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), '598bb5285371bb9321b0c9568a038a1cce04a44a7a00803238522cb7c80eccd5')
        text = data.decode()
        expected = ['val offsetPoints = scrollView.contentOffset.useContents { y }.toFloat()',
            'val insetPoints = scrollView.contentInset.useContents { top }.toFloat()',
            'val adjustedOffsetPoints = offsetPoints + insetPoints',
            'val offsetPx = max(adjustedOffsetPoints * densityScaleState.value, 0f)']
        indices = [text.index(line) for line in expected]
        self.assertEqual(indices, sorted(indices))

    def test_separate_float_conversions_preserve_source_boundary(self):
        offset, inset = -304.6666666666667, 384.6666564941406
        raw = max(0, offset + inset) * 3
        self.assertEqual(raw, 239.99996948242182)
        self.assertEqual(actual_projection(offset, inset, 3), 240.0)
        self.assertNotEqual(f32(f32(offset + inset) * 3), actual_projection(offset, inset, 3))

    def test_clamp_remains_after_addition_and_multiplication(self):
        self.assertEqual(actual_projection(-385, 384.6666564941406, 3), 0)
        self.assertEqual(actual_projection(-384.6666666666667, 384.6666564941406, 3), 0)
        self.assertEqual(actual_projection(1, 2, 1.01), 3.0299999713897705)

    def test_raw_geometry_and_default_twenty_sample_path_are_unchanged(self):
        current, prior = SWIFT.read_text(), R2.read_text()
        for name, end in [('observePreparedGeometry', '    private func readerGeometries'),
            ('readerGeometries', '    private func fail')]:
            start = '    private func ' + name
            self.assertEqual(current[current.index(start):current.index(end)], prior[prior.index(start):prior.index(end)])
        self.assertIn('"positionPixels": max(0, scroll.contentOffset.y + scroll.contentInset.top) * sourceWindow.screen.scale', current)
        self.assertIn('"sourceCallbackFloat32PositionPixels": Double(sourceCallbackFloat32Position(', current)
        self.assertIn('not a captured Kotlin callback or acceptance', current)


if __name__ == '__main__':
    unittest.main(verbosity=2)
