/** Expo accelerometer samples are in g on both platforms, matching the normalized source threshold. */
export function createShakeDetector(onShake: () => void, now = () => Date.now()) {
  let lastShake = 0;
  return ({x, y, z}: {x: number; y: number; z: number}) => {
    if (Math.sqrt(x * x + y * y + z * z) <= 2.7) return;
    const stamp = now();
    if (stamp - lastShake > 1000) {lastShake = stamp; onShake();}
  };
}
