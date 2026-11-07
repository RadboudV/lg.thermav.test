/**
 * The heat pump derives its water temperatures from an 8-bit sensor value: temperature = (192 - raw) / 3,
 * so the real resolution is 1/3 K. The register reports this rounded to 0.1 K, which adds an avoidable error
 * (noticeable in the COP, which uses the small difference between outlet and inlet temperature).
 * Multiplying by 3, rounding to an integer and dividing by 3 again restores the original sensor step.
 * The result is deliberately not rounded to decimals here.
 */
export function snapToThirds(value: number): number {
  return Math.round(value * 3) / 3;
}
