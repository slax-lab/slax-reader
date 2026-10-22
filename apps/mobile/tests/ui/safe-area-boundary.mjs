/** Native-only boundary. Individual tests can supply measured insets/frame/components explicitly. */
export function safeAreaBoundary(boundaries) {
  const supplied = boundaries['react-native-safe-area-context'] ?? {};
  const native = boundaries['react-native'] ?? {};
  const primitive = native.View ?? (props => props.children);
  return {
    SafeAreaProvider: primitive,
    SafeAreaView: primitive,
    ...supplied,
    useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0, ...supplied.useSafeAreaInsets?.()}),
    useSafeAreaFrame: supplied.useSafeAreaFrame ?? (() => ({x: 0, y: 0, width: 390, height: 844, ...native.useWindowDimensions?.()})),
  };
}
