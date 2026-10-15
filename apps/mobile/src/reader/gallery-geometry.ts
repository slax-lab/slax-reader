export function imageFit(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  'worklet';
  if (!(width > 0 && height > 0 && viewportWidth > 0 && viewportHeight > 0)) return {width: viewportWidth, height: viewportHeight};
  const ratio = Math.min(viewportWidth / width, viewportHeight / height);
  return {width: width * ratio, height: height * ratio};
}
export function galleryPage(index: number, displacement: number, velocity: number, width: number, count: number) {
  'worklet';
  const travel = displacement + velocity * 0.18;
  const delta = Math.abs(displacement) > width * 0.25 || Math.abs(travel) > width * 0.4 ? (travel > 0 ? -1 : 1) : 0;
  return Math.max(0, Math.min(count - 1, index + delta));
}
