/**
 * Automatic silent mode: decides when the silent mode of the heat pump should be switched on or off.
 *
 *  OFF  - while the heat pump is defrosting
 *  OFF  - when the suction temperature has been below 1 degree for 300 seconds, or the heat exchanger temperature has
 *         been below 1 degree for 300 seconds
 *  ON   - the inverse of the previous rule: both temperatures have been at or above 1 degree for 300 seconds
 *  ON   - when the heat pump is switched to heating while the outdoor temperature is above 7 degrees
 *
 * The class only decides; the caller compares the decision with the current state and writes it to the heat pump.
 */

export const LOW_TEMPERATURE_LIMIT = 1;        // degrees C: below this the heat exchanger / suction side is (nearly) freezing
export const HOLD_SECONDS = 300;               // how long a temperature condition must hold before it counts
export const OUTDOOR_ON_LIMIT = 7;             // degrees C: above this, switching to heating turns silent mode on

export interface AutoSilentInput {
  defrosting: boolean;
  suctionTemperature?: number;                 // undefined = register could not be read
  heatExchangerTemperature?: number;
  outdoorTemperature?: number;
  heating: boolean;                            // heat pump is on and in heating mode
}

export interface AutoSilentDecision {
  enable: boolean;
  reason: string;                              // readable text for the notification
}

export class AutoSilent {
  private suctionLowSince: number | undefined;
  private heatExchangerLowSince: number | undefined;
  private bothOkSince: number | undefined;
  private previousHeating: boolean | undefined;   // undefined = first evaluation (a switch to heating needs a known previous state)

  /** Forget everything (automatic silent mode switched off). */
  reset() {
    this.suctionLowSince = undefined;
    this.heatExchangerLowSince = undefined;
    this.bothOkSince = undefined;
    this.previousHeating = undefined;
  }

  /** Evaluate one poll. Returns the wanted state, or null when none of the rules applies (keep the current state). */
  evaluate(input: AutoSilentInput, now = Date.now()): AutoSilentDecision | null {
    const switchedToHeating = this.previousHeating === false && input.heating;
    this.previousHeating = input.heating;

    if (input.defrosting) {
      this.suctionLowSince = undefined;
      this.heatExchangerLowSince = undefined;
      this.bothOkSince = undefined;
      return { enable: false, reason: 'the heat pump is defrosting' };
    }

    const suctionLow = input.suctionTemperature !== undefined && input.suctionTemperature < LOW_TEMPERATURE_LIMIT;
    const heatExchangerLow = input.heatExchangerTemperature !== undefined && input.heatExchangerTemperature < LOW_TEMPERATURE_LIMIT;
    const bothKnownAndOk = input.suctionTemperature !== undefined && input.heatExchangerTemperature !== undefined
      && !suctionLow && !heatExchangerLow;

    this.suctionLowSince = suctionLow ? (this.suctionLowSince ?? now) : undefined;
    this.heatExchangerLowSince = heatExchangerLow ? (this.heatExchangerLowSince ?? now) : undefined;
    this.bothOkSince = bothKnownAndOk ? (this.bothOkSince ?? now) : undefined;

    const heldLongEnough = (since: number | undefined) => since !== undefined && (now - since) / 1000 >= HOLD_SECONDS;

    if (heldLongEnough(this.suctionLowSince)) {
      return { enable: false, reason: `the suction temperature was below ${LOW_TEMPERATURE_LIMIT} °C for ${HOLD_SECONDS} seconds` };
    }
    if (heldLongEnough(this.heatExchangerLowSince)) {
      return { enable: false, reason: `the heat exchanger temperature was below ${LOW_TEMPERATURE_LIMIT} °C for ${HOLD_SECONDS} seconds` };
    }
    if (switchedToHeating && input.outdoorTemperature !== undefined && input.outdoorTemperature > OUTDOOR_ON_LIMIT) {
      return { enable: true, reason: `the heat pump was switched to heating and the outdoor temperature is above ${OUTDOOR_ON_LIMIT} °C` };
    }
    if (heldLongEnough(this.bothOkSince)) {
      return { enable: true, reason: `the suction and heat exchanger temperatures were at or above ${LOW_TEMPERATURE_LIMIT} °C for ${HOLD_SECONDS} seconds` };
    }
    return null;
  }
}
