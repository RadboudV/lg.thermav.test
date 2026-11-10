/**
 * Smoothing of the COP: a moving average over the last N polls of the two COP inputs
 * (produced heat/cold in W and electric power in W). COP = sum(heat) / sum(power) over the window.
 * Averaging both inputs (instead of averaging the COP of every poll) keeps the ratio consistent and gives
 * polls with a high power more weight, like a real energy ratio.
 *
 * The window is emptied when the compressor is not running (so values from before and after a stop are not mixed)
 * and after a gap in the polls (failed poll, restart).
 */
export class CopAverage {
  private samples: Array<{ heat: number; power: number }> = [];
  private lastSampleTime = 0;

  constructor(
    private readonly windowSize = 5,
    private readonly maxGapMs = 300_000,
  ) {}

  /** Empties the window (compressor stopped, meter unavailable, smoothing switched off). */
  clear() {
    this.samples = [];
    this.lastSampleTime = 0;
  }

  /** Adds the values of one poll; the window is emptied first when the previous sample is too old. */
  add(heatW: number, powerW: number, now = Date.now()) {
    if (this.lastSampleTime && now - this.lastSampleTime > this.maxGapMs) this.samples = [];
    this.lastSampleTime = now;
    this.samples.push({ heat: heatW, power: powerW });
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  /** COP over the window, rounded to 2 decimals. 0 when there is no usable power. */
  cop(): number {
    const heat = this.samples.reduce((sum, sample) => sum + sample.heat, 0);
    const power = this.samples.reduce((sum, sample) => sum + sample.power, 0);
    return power > 0 ? Math.round((heat / power) * 100) / 100 : 0;
  }
}
