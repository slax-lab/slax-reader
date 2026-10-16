export function imageFit(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  'worklet';
  if (!(width > 0 && height > 0 && viewportWidth > 0 && viewportHeight > 0)) return {width: viewportWidth, height: viewportHeight};
  const ratio = Math.min(viewportWidth / width, viewportHeight / height);
  return {width: width * ratio, height: height * ratio};
}
