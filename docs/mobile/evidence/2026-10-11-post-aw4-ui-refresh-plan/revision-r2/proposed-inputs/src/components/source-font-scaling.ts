// Pinned Compose UI 1.11.2 FontScaleConverterFactory curves. Keep the Android
// native SourceLine and ordinary Text paths on the same system font-scale policy.
const sizes = [8, 10, 12, 14, 18, 20, 24, 30, 100];
const tables: [number, number[]][] = [
  [1, sizes],
  [1.15, [9.2, 11.5, 13.8, 16.4, 19.8, 21.8, 25.2, 30, 100]],
  [1.3, [10.4, 13, 15.6, 18.8, 21.6, 23.6, 26.4, 30, 100]],
  [1.5, [12, 15, 18, 22, 24, 26, 28, 30, 100]],
  [1.8, [14.4, 18, 21.6, 24.4, 27.6, 30.8, 32.8, 34.8, 100]],
  [2, [16, 20, 24, 26, 30, 34, 36, 38, 100]],
];

export function sourceSpToDp(sp: number, fontScale: number): number {
  if (!Number.isFinite(sp) || !Number.isFinite(fontScale) || fontScale <= 0) throw new Error('Invalid source font scaling');
  if (fontScale < 1.03) return sp * fontScale;
  // Android receives a float configuration value and multiplies it as a float.
  const keyForScale = (scale: number) => Math.trunc(Math.fround(Math.fround(scale) * 100));
  const key = keyForScale(fontScale);
  let values = tables.find(([scale]) => keyForScale(scale) === key)?.[1];
  if (!values) {
    if (fontScale > 2) return sp * fontScale;
    const upper = tables.findIndex(([scale]) => keyForScale(scale) > key);
    const [lowerScale, lower] = tables[upper - 1], [upperScale, higher] = tables[upper];
    const amount = Math.max(0, Math.min(1, (fontScale - lowerScale) / (upperScale - lowerScale)));
    values = sizes.map((_value, index) => lower[index] + amount * (higher[index] - lower[index]));
  }
  const positive = Math.abs(sp), upper = sizes.findIndex(size => size >= positive);
  if (upper < 0) return sp * values[values.length - 1] / sizes[sizes.length - 1];
  if (upper === 0) return sp * values[0] / sizes[0];
  const amount = (positive - sizes[upper - 1]) / (sizes[upper] - sizes[upper - 1]);
  return Math.sign(sp) * (values[upper - 1] + amount * (values[upper] - values[upper - 1]));
}

export function sourceTextDimensions(style: {fontSize?: number; lineHeight?: number; letterSpacing?: number}, fontScale: number, allowFontScaling = true, maxFontSizeMultiplier?: number | null) {
  const scale = allowFontScaling ? fontScale : 1;
  const convert = (sp: number) => {
    const dp = sourceSpToDp(sp, scale);
    if (!allowFontScaling || !maxFontSizeMultiplier || maxFontSizeMultiplier < 1) return dp;
    return Math.sign(sp) * Math.min(Math.abs(dp), Math.abs(sp) * maxFontSizeMultiplier);
  };
  const fontSize = style.fontSize === undefined ? undefined : convert(style.fontSize);
  const lineHeight = style.lineHeight === undefined ? undefined
    : scale > 1.05 && fontSize !== undefined && style.fontSize! > 0
      // Compose resolves a nonlinearly scaled SP line height relative to the
      // actual font size, instead of independently scaling the line-height SP.
      ? style.lineHeight / style.fontSize! * fontSize
      : convert(style.lineHeight);
  return {...(fontSize === undefined ? {} : {fontSize}), ...(lineHeight === undefined ? {} : {lineHeight}),
    ...(style.letterSpacing === undefined ? {} : {letterSpacing: convert(style.letterSpacing)})};
}
