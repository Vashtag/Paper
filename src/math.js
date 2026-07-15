export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function seededNoise(value) {
  const noise = Math.sin(value * 12.9898) * 43758.5453;
  return noise - Math.floor(noise);
}
