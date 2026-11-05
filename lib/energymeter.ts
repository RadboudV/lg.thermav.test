/**
 * Reads the active power (W) from a P1/energy meter with a local HTTP API
 * (HomeWizard style: GET http://<address>/api/v1/data, JSON with "active_power_w").
 */

const ADDRESS_PATTERN = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;   // host or IPv4, optional port; no scheme, no path

export const ENERGY_METER_TIMEOUT_MS = 3000;

/** True when the setting looks like a host name / IP address (optionally with :port). */
export function isValidMeterAddress(address: string): boolean {
  return ADDRESS_PATTERN.test(address);
}

/**
 * Returns the active power in watts (negative when exporting), or throws when the meter
 * cannot be reached or the response does not contain a numeric "active_power_w".
 */
export async function readActivePower(address: string, timeoutMs = ENERGY_METER_TIMEOUT_MS): Promise<number> {
  if (!isValidMeterAddress(address)) throw new Error(`Invalid energy meter address: ${address}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${address}/api/v1/data`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Energy meter returned HTTP ${response.status}`);
    const data = (await response.json()) as { active_power_w?: unknown };
    const power = Number(data.active_power_w);
    if (data.active_power_w === undefined || data.active_power_w === null || !Number.isFinite(power)) {
      throw new Error('Energy meter response has no numeric active_power_w');
    }
    return power;
  } finally {
    clearTimeout(timer);
  }
}
