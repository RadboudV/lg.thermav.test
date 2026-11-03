import Homey from 'homey';
import { errorTitle } from '../lib/errorcodes';
import type { Measurement } from '../lib/modbus';


const OPERATING_MODES: Record<string, string> = { '0': 'cool', '1': 'cool', '2': 'off', '3': 'auto', '4': 'heat' };

const title = (en: string, nl: string = en) => ({ en, nl });

// Circuit 2 (second heating/cooling circuit). There is no "installed" register; per the user's finding circuit 2 is in use
// when 'temptarget2' (holding 40006) is not 0. Capabilities are added then and removed again when it returns to 0.
// The operating mode (heat/cool/auto/off) is shared with circuit 1, so circuit 2 has no mode capability of its own.
const CIRCUIT2_TARGET = 'target_temperature.thermostat2';
const CIRCUIT2_ROOM   = 'measure_temperature.thermostat2';
const CIRCUIT2_CAPABILITIES: Record<string, Record<string, unknown>> = {
	// min/max: the default range of target_temperature (4-35) is too small for a water temperature setpoint
	[CIRCUIT2_TARGET]: { title: title('Target Temperature Circuit 2', 'Doeltemperatuur circuit 2'), decimals: 0, step: 1, min: 5, max: 65 },
	[CIRCUIT2_ROOM]:   { title: title('Room Temperature Circuit 2', 'Kamertemperatuur circuit 2'), decimals: 1 },
};

// Capabilities that only exist while DHW (domestic hot water) is enabled (coil 1 'enabledhw' and setting 'settings_enable_dhw').
// They are added, with these options, when DHW is enabled and removed again when it is disabled.
const DHW_CAPABILITIES: Record<string, Record<string, unknown>> = {
	'measure_temperature.dhwtank':   { title: title('DHW Tank Temperature', 'Boilertemperatuur'), decimals: 1 },
	// DHW thermostat: holding register 8 (40009), 0.1 °C units, set in whole degrees
	'target_temperature.dhw':        { title: title('DHW Target Temperature', 'DHW doeltemperatuur'), decimals: 0, step: 1, min: 35, max: 65 },
	'onoff.dhwheating':              { title: title('DHW Heating', 'DHW verwarmen'), setable: false, uiComponent: 'sensor' },
	'onoff.dhwdesinfection':         { title: title('DHW Tank Desinfection', 'DHW tank desinfectie'), setable: false, uiComponent: 'sensor' },
	'onoff.dhwboostheater':          { title: title('DHW Boost Heater', 'DHW booster verwarming'), setable: false, uiComponent: 'sensor' },
	'onoff.dhwemergency':            { title: title('DHW Emergency Operation Available', 'DHW noodbedrijf beschikbaar'), setable: false, uiComponent: 'sensor' },
};

// Flow trigger cards fired when a status changes between two polls. `key` is the register (see lib/registers.ts);
// the state is "on" when active(raw) is true (default: raw === 1). The first poll after the app starts never fires.
interface StatusTrigger { key: string; on: string; off: string; active?: (raw: number) => boolean; tokens?: Record<string, string | number> }
const STATUS_TRIGGERS: StatusTrigger[] = [
	{ key: 'statuscompressor',     on: 'thermav_compressor_started',   off: 'thermav_compressor_stopped' },
	{ key: 'statuswaterpump',      on: 'thermav_waterpump_started',    off: 'thermav_waterpump_stopped' },
	{ key: 'statusextwaterpup',    on: 'thermav_extwaterpump_started', off: 'thermav_extwaterpump_stopped' },
	{ key: 'statusmixpump',        on: 'thermav_mixpump_started',      off: 'thermav_mixpump_stopped' },
	{ key: 'statussolarpump',      on: 'thermav_solarpump_started',    off: 'thermav_solarpump_stopped' },
	{ key: 'statussilentmode',     on: 'thermav_silentmode_turned_on', off: 'thermav_silentmode_turned_off' },
	{ key: 'statuscooling',        on: 'thermav_cooling_started',      off: 'thermav_cooling_stopped' },
	{ key: 'statuswaterflow',      on: 'thermav_waterflow_low',        off: 'thermav_waterflow_restored' },     // 1 = flow too low
	{ key: 'statusemergency',      on: 'thermav_emergency_became_available', off: 'thermav_emergency_became_unavailable' },
	{ key: 'statusbackupheater1',  on: 'thermav_backupheater_on',      off: 'thermav_backupheater_off', tokens: { step: '1' } },
	{ key: 'statusbackupheater2',  on: 'thermav_backupheater_on',      off: 'thermav_backupheater_off', tokens: { step: '2' } },
	{ key: 'enabledhw',            on: 'thermav_dhw_turned_on',        off: 'thermav_dhw_turned_off' },
	{ key: 'enableheatingcooling', on: 'thermav_heatingcooling_turned_on', off: 'thermav_heatingcooling_turned_off' },
	{ key: 'temptarget2',          on: 'thermav_circuit2_became_active', off: 'thermav_circuit2_became_inactive', active: (raw) => raw !== 0 },
];

// Trigger cards fired with the new value as token whenever a value changes between two polls.
const OPERATING_CYCLES: Record<number, string> = { 0: 'standby', 1: 'cooling', 2: 'heating' };
const ENERGY_STATES: Record<number, string> = {
	0: 'Not used', 1: 'Forced off', 2: 'Normal operation', 3: 'On (recommended)', 4: 'On (command)',
	5: 'On (command, step 2)', 6: 'On (recommended, step 1)', 7: 'Energy saving mode', 8: 'Super energy saving mode',
};
const VALUE_TRIGGERS: Array<{ key: string; card: string; tokens: (raw: number) => Record<string, string | number> }> = [
	{ key: 'oduoperationcycle', card: 'thermav_operationcycle_changed', tokens: (raw) => ({ cycle: OPERATING_CYCLES[raw] ?? String(raw) }) },
	{ key: 'energystateinput',  card: 'thermav_energystate_changed',    tokens: (raw) => ({ state: raw, name: ENERGY_STATES[raw] ?? 'Unknown' }) },
];

// Solar collector temperature (input 30007). Only meaningful while DHW is enabled and a sensor is connected:
// an unconnected sensor reads a fixed raw value of 3000 (= 300.0 °C), then the capability is not shown.
const SOLAR_COLLECTOR = 'measure_temperature.solarcollector';
const SOLAR_COLLECTOR_OPTIONS = { title: title('Solar Collector Temperature', 'Zonnecollector temperatuur'), decimals: 1 };
const SOLAR_NO_SENSOR_RAW = 3000;

export class ThermaV extends Homey.Device {

	// Per-device state (was module-level before, which is shared between devices)
	protected enableHeatingCooling = 1;               // coil 0: 0 = heating/cooling disabled
	protected shiftValue2: number | undefined;        // holding register 7 (raw, unsigned 16 bit), circuit 2
	protected snapshot: Record<string, Measurement> | undefined;   // all registers of the last successful poll (for the condition cards)
	protected snapshotTime = 0;                                    // when that poll happened (ms)
	protected dhwEnabled: boolean | undefined;          // coil 1 'enabledhw' as last read from the pump (undefined until read)
	private previousState: Record<string, boolean> = {};   // on/off state per STATUS_TRIGGERS entry at the previous poll
	private previousRaw: Record<string, number> = {};      // raw value per VALUE_TRIGGERS entry at the previous poll
	protected shiftValue: number | undefined;         // holding register 4 (raw, unsigned 16 bit)

protected debug(...args: any[]): void {
    if (this.getSetting('debug_logging')) {
        this.log('[ThermaV]', ...args);
    }
}

// -----------------------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------------------
	private getScaledValue(measurement: Measurement): number {
		return Number(measurement.value) *
			Math.pow(10, Number(measurement.scale));
		}

	private async updateNumericCapability(
		result: Record<string, Measurement>,
		source: string,
		capability: string
	) {
		const item = result[source];

		if (!item || item.value === 'xxx') {
			return;
		}

		if (!this.hasCapability(capability)) {
			await this.addCapability(capability);
		}

		const value =
			Number(item.value) * Math.pow(10, Number(item.scale));

		await this.setCapabilityValue(capability, value);
	}
// Example: await this.updateNumericCapability( result, 'tempwaterinlet', 'measure_temperature.tempwaterinlet' );

	/** Add the capability (with options) if the device does not have it yet. Returns true when added. */
	protected async ensureCapability(capability: string, options?: Record<string, unknown>): Promise<boolean> {
		if (this.hasCapability(capability)) return false;
		await this.addCapability(capability);
		if (options) await this.setCapabilityOptions(capability, options);
		return true;
	}

	/** Set a capability only when the value changed. */
	protected async updateCapability(capability: string, value: number | string | boolean | null) {
		if (this.getCapabilityValue(capability) !== value) {
			await this.setCapabilityValue(capability, value);
		}
	}

	/**
	 * Value of a register from the last successful poll, for the flow condition cards.
	 * Throws (so the flow shows why) when there is no data yet, the data is outdated or that register could not be read.
	 */
	getLastValue(key: string): number {
		if (!this.snapshot) throw new Error('No data from the heat pump yet, try again after the next poll');
		const maxAge = Math.max(Number(this.getSetting('pollinginterval')) || 30, 5) * 3 * 1000;
		if (Date.now() - this.snapshotTime > maxAge) throw new Error('Heat pump data is outdated (no successful poll recently)');
		const m = this.snapshot[key];
		if (!this.isValid(m)) throw new Error(`Register "${key}" could not be read`);
		return Number(m.value);
	}

	private isValid(m?: Measurement): m is Measurement {
		return !!m && m.value !== 'xxx';
	}
// -----------------------------------------------------------------------------------------

	/**
	 * Keep alarm_generic as the error flag and make the device timeline say which error it is.
	 * The timeline text of a boolean capability comes from its insightsTitleTrue / insightsTitleFalse options,
	 * so these are set right before the flag changes. A change from one error to another is shown as
	 * "cleared" followed by the new error.
	 */
	private async processErrorCode(code: number) {
		await this.ensureCapability('alarm_generic');

		// Last code we reported; survives app restarts. -1 = flag was on but the code is unknown.
		let previous = this.getStoreValue('errorCode');
		if (typeof previous !== 'number') previous = this.getCapabilityValue('alarm_generic') ? -1 : 0;
		if (previous === code) {
			if (code === 0 && this.getCapabilityValue('alarm_generic') !== false) await this.setCapabilityValue('alarm_generic', false);
			return;
		}

		const setTitles = (opts: Record<string, unknown>) => this.setCapabilityOptions('alarm_generic', {
			...(this.getCapabilityOptions('alarm_generic') ?? {}),
			...opts,
		});

		if (previous !== 0) {
			const cleared = previous > 0 ? `Error ${previous} cleared: ${errorTitle(previous)}` : 'Error cleared';
			await setTitles({ insightsTitleFalse: title(cleared) });
			await this.setCapabilityValue('alarm_generic', false);
		}
		if (code !== 0) {
			const text = `Error ${code}: ${errorTitle(code)}`;
			this.log(text);
			await setTitles({ insightsTitleTrue: title(text) });
			await this.setCapabilityValue('alarm_generic', true);
		}
		await this.setStoreValue('errorCode', code);

		// Flow trigger cards (tokens: code like "CH23" and the description). Fired after the state is stored,
		// so a poll that fails halfway does not fire the same trigger twice. Error -> other error fires both.
		if (previous !== 0) {
			(this.driver as any).fireTrigger('thermav_fault_cleared', this, {
				code: previous > 0 ? `CH${previous}` : '',
				description: previous > 0 ? errorTitle(previous) : 'Unknown error',
			}).catch(this.error);
		}
		if (code !== 0) {
			(this.driver as any).fireTrigger('thermav_fault_detected', this, { code: `CH${code}`, description: errorTitle(code) }).catch(this.error);
		}
	}


	/**
	 * Circuit 2: active when temptarget2 is not 0. While active the target (thermostat) and room temperature
	 * capabilities exist; when temptarget2 is back to 0 they are removed. A register that could not be read leaves everything as it is.
	 */
	private async processCircuit2(result: Record<string, Measurement>) {
		if (!this.isValid(result.temptarget2)) return;
		const active = Number(result.temptarget2.value) !== 0;

		if (!active) {
			for (const id of Object.keys(CIRCUIT2_CAPABILITIES)) {
				if (this.hasCapability(id)) await this.removeCapability(id).catch(this.error);
			}
			return;
		}

		const room = this.isValid(result.temproomcircuit2) ? this.getScaledValue(result.temproomcircuit2) : undefined;
		// Target: always while active. Room temperature: only when circuit 2 really reports one (a missing room sensor reads 0)
		const wanted = [CIRCUIT2_TARGET, ...(room !== undefined && room !== 0 ? [CIRCUIT2_ROOM] : [])];
		for (const id of wanted) {
			if (!this.hasCapability(id)) {
				await this.addCapability(id);
				await this.setCapabilityOptions(id, CIRCUIT2_CAPABILITIES[id]);
			}
		}

		// Room temperature: when circuit 2 stops reporting one (reads 0) the capability goes away again
		if (this.hasCapability(CIRCUIT2_ROOM) && !wanted.includes(CIRCUIT2_ROOM)) {
			await this.removeCapability(CIRCUIT2_ROOM).catch(this.error);
		}

		await this.setCapabilityIfChanged(CIRCUIT2_TARGET, Math.round(this.getScaledValue(result.temptarget2)));
		if (wanted.includes(CIRCUIT2_ROOM)) await this.setCapabilityIfChanged(CIRCUIT2_ROOM, room);
	}

	/** Set a capability only when the value changed; a rejected value (e.g. out of range) must not fail the poll. */
	private async setCapabilityIfChanged(capability: string, value: number | boolean | undefined) {
		if (value === undefined || !this.hasCapability(capability)) return;
		if (this.getCapabilityValue(capability) === value) return;
		await this.setCapabilityValue(capability, value).catch((err: Error) => this.error('capability', capability, err.message));
	}

	/**
	 * DHW (domestic hot water). Everything here depends on the 'enabledhw' coil:
	 * - the setting 'settings_enable_dhw' follows the coil (it is also what the user changes; onSettings writes the coil)
	 * - while DHW is enabled (coil reads 1 and setting is on) the DHW capabilities are added and updated
	 * - while it is disabled they are removed
	 */
	private async processDhw(result: Record<string, Measurement>) {
		if (this.isValid(result.enabledhw)) {
			this.dhwEnabled = Number(result.enabledhw.value) === 1;
			if (this.getSetting('settings_enable_dhw') !== this.dhwEnabled) {
				await this.setSettings({ settings_enable_dhw: this.dhwEnabled }).catch(this.error);
			}
		}
		if (this.dhwEnabled === undefined) return;      // coil not read yet: leave the capabilities as they are

		if (!(this.dhwEnabled && this.getSetting('settings_enable_dhw') === true)) {
			for (const id of [...Object.keys(DHW_CAPABILITIES), SOLAR_COLLECTOR]) {
				if (this.hasCapability(id)) await this.removeCapability(id).catch(this.error);
			}
			return;
		}

		for (const [id, options] of Object.entries(DHW_CAPABILITIES)) {
			if (!this.hasCapability(id)) {
				await this.addCapability(id);
				await this.setCapabilityOptions(id, options);
			}
		}

		const num  = (m?: Measurement) => this.isValid(m) ? this.getScaledValue(m) : undefined;
		const flag = (m?: Measurement) => this.isValid(m) ? Number(m.value) === 1 : undefined;
		await this.setCapabilityIfChanged('measure_temperature.dhwtank', num(result.tempwaterDHWtank));
		await this.setCapabilityIfChanged('target_temperature.dhw',      num(result.temptargetdhw));
		await this.setCapabilityIfChanged('onoff.dhwheating',            flag(result.statusdhwheating));
		await this.setCapabilityIfChanged('onoff.dhwdesinfection',       flag(result.statusdhwtankdesinfection));
		await this.setCapabilityIfChanged('onoff.dhwboostheater',        flag(result.statusdhwboostheater));
		await this.setCapabilityIfChanged('onoff.dhwemergency',          flag(result.statusdhwemergency));

		// Solar collector temperature: only with a connected sensor (raw 3000 = no sensor). An unreadable register leaves it as it is.
		if (this.isValid(result.tempsolarcollector)) {
			if (Number(result.tempsolarcollector.value) === SOLAR_NO_SENSOR_RAW) {
				if (this.hasCapability(SOLAR_COLLECTOR)) await this.removeCapability(SOLAR_COLLECTOR).catch(this.error);
			} else {
				if (!this.hasCapability(SOLAR_COLLECTOR)) {
					await this.addCapability(SOLAR_COLLECTOR);
					await this.setCapabilityOptions(SOLAR_COLLECTOR, SOLAR_COLLECTOR_OPTIONS);
				}
				await this.setCapabilityIfChanged(SOLAR_COLLECTOR, this.getScaledValue(result.tempsolarcollector));
			}
		}
	}

	/** Fire the flow trigger cards for everything that changed since the previous poll (see STATUS_TRIGGERS / VALUE_TRIGGERS). */
	private fireTriggers(result: Record<string, Measurement>) {
		const driver = this.driver as any;

		for (const t of STATUS_TRIGGERS) {
			const m = result[t.key];
			if (!this.isValid(m)) continue;                       // register not read this poll: keep the previous state
			const raw = Number(m.value);
			const active = t.active ? t.active(raw) : raw === 1;
			const previous = this.previousState[t.key];
			this.previousState[t.key] = active;
			if (previous === undefined || previous === active) continue;   // first poll, or nothing changed
			driver.fireTrigger(active ? t.on : t.off, this, t.tokens ?? {}).catch(this.error);
		}

		for (const t of VALUE_TRIGGERS) {
			const m = result[t.key];
			if (!this.isValid(m)) continue;
			const raw = Number(m.value);
			const previous = this.previousRaw[t.key];
			this.previousRaw[t.key] = raw;
			if (previous === undefined || previous === raw) continue;
			driver.fireTrigger(t.card, this, t.tokens(raw)).catch(this.error);
		}
	}

    async processResult(result: Record<string, Measurement>) {
		if (!result) return;

		// State needed by the thermostat logic (kept per device)
		if (this.isValid(result.enableheatingcooling)) this.enableHeatingCooling = Number(result.enableheatingcooling.value);
		if (this.isValid(result.shiftvalue1)) this.shiftValue = Number(result.shiftvalue1.value);
		if (this.isValid(result.shiftvalue2)) this.shiftValue2 = Number(result.shiftvalue2.value);

// Show result
// disabled logging 
//            for (let k in result) {
//
//                debug.log(k, result[k].value, result[k].scale, result[k].label)
//            }

            if (result['temptarget1'] && result['temptarget1'].value != 'xxx') {
				if (!this.hasCapability('target_temperature.thermostat')) {
					await this.addCapability('target_temperature.thermostat');
				}
                //var temptarget1 = Number(result['temptarget1'].value) * (Math.pow(10, Number(result['temptarget1'].scale)));
				const temptarget1 = this.getScaledValue(result['temptarget1']);
				const current = this.getCapabilityValue('measure_temperature.tempwaterinlet');
				if (current !== temptarget1) {
					await this.setCapabilityValue('target_temperature.thermostat', Math.round(temptarget1));
				}
            }

            if (result['temproomcircuit1'] && result['temproomcircuit1'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.thermostat')) {
					await this.addCapability('measure_temperature.thermostat');
				}
                //var temproomcircuit1 = Number(result['temproomcircuit1'].value) * (Math.pow(10, Number(result['temproomcircuit1'].scale)));
				const temproomcircuit1 = this.getScaledValue(result['temproomcircuit1']);
				const current = this.getCapabilityValue('measure_temperature.thermostat');
				if (current !== temproomcircuit1) {
					await this.setCapabilityValue('measure_temperature.thermostat', temproomcircuit1);
				}
            }
 
            if (result['tempwaterinlet'] && result['tempwaterinlet'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.tempwaterinlet')) {
					await this.addCapability('measure_temperature.tempwaterinlet');
				}
                // var tempwaterinlet = Number(result['tempwaterinlet'].value) * (Math.pow(10, Number(result['tempwaterinlet'].scale)));
				const tempwaterinlet = this.getScaledValue(result['tempwaterinlet']);
				const current = this.getCapabilityValue('measure_temperature.tempwaterinlet');
				if (current !== tempwaterinlet) {
					await this.setCapabilityValue('measure_temperature.tempwaterinlet', tempwaterinlet);
				}
            }

            if (result['tempwateroutlet'] && result['tempwateroutlet'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.tempwateroutlet')) {
					await this.addCapability('measure_temperature.tempwateroutlet');
				}
                //var tempwateroutlet = Number(result['tempwateroutlet'].value) * (Math.pow(10, Number(result['tempwateroutlet'].scale)));
				const tempwateroutlet = this.getScaledValue(result['tempwateroutlet']);
				const current = this.getCapabilityValue('measure_temperature.tempwateroutlet');
				if (current !== tempwateroutlet) {
					await this.setCapabilityValue('measure_temperature.tempwateroutlet', tempwateroutlet);
				}
            }

            if (result['tempoutdoor'] && result['tempoutdoor'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.tempoutdoor')) {
					await this.addCapability('measure_temperature.tempoutdoor');
				}
				// var tempoutdoor = Number(result['tempoutdoor'].value) * (Math.pow(10, Number(result['tempoutdoor'].scale)));
				const tempoutdoor = this.getScaledValue(result['tempoutdoor']);
				const current = this.getCapabilityValue('measure_temperature.tempoutdoor');
				if (current !== tempoutdoor) {
					await this.setCapabilityValue('measure_temperature.tempoutdoor', tempoutdoor);
				}
            }

            if (result['temppipein'] && result['temppipein'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.temppipein')) {
					await this.addCapability('measure_temperature.temppipein');
				}
                // var temppipein = Number(result['temppipein'].value) * (Math.pow(10, Number(result['temppipein'].scale)));
				const temppipein = this.getScaledValue(result['temppipein']);
				const current = this.getCapabilityValue('measure_temperature.temppipein');
				if (current !== temppipein) {
					await this.setCapabilityValue('measure_temperature.temppipein', temppipein);
				}
            }

          if (result['tempsuction'] && result['tempsuction'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.tempsuction')) {
					await this.addCapability('measure_temperature.tempsuction');
				}
                //var tempsuction = Number(result['tempsuction'].value) * (Math.pow(10, Number(result['tempsuction'].scale)));
				const tempsuction = this.getScaledValue(result['tempsuction']);
				const current = this.getCapabilityValue('measure_temperature.tempsuction');
				if (current !== tempsuction) {
					await this.setCapabilityValue('measure_temperature.tempsuction', tempsuction);
				}
            }

// Air Heat Exchanger Temperature
          if (result['temphex'] && result['temphex'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.temphex')) {
					await this.addCapability('measure_temperature.temphex');
					await this.setCapabilityOptions('measure_temperature.temphex', { "title": {
						"en": "Heat Exchanger Temperature",
						"nl": "Temperatuur Warmtewisselaar"
						},
						});
				}
                //var temphex = Number(result['temphex'].value) * (Math.pow(10, Number(result['temphex'].scale)));
				const temphex = this.getScaledValue(result['temphex']);
				const current = this.getCapabilityValue('measure_temperature.temphex');
				if (current !== temphex) {
					await this.setCapabilityValue('measure_temperature.temphex', temphex);
				}
            }

// Waterflowrate
            if (result['waterflowrate'] && result['waterflowrate'].value != 'xxx') {
				if (!this.hasCapability('measure_water.waterflowrate')) {
					await this.addCapability('measure_water.waterflowrate');
				}
                //var waterflowrate = Number(result['waterflowrate'].value) * (Math.pow(10, Number(result['waterflowrate'].scale)));
				var waterflowrate = this.getScaledValue(result['waterflowrate']);
				if (waterflowrate == 5) { waterflowrate = 0 }
				// The minimum value waterflowrate can report is 5, even is there is no water flow at all. The heatpump wiill shutdown before the actual flow reaches 5, so it safe to assume that the flow is 0.
				const current = this.getCapabilityValue('measure_water.waterflowrate');
				if (current !== waterflowrate) {
					await this.setCapabilityValue('measure_water.waterflowrate', waterflowrate);
				}
            }

// Compressor Speed			
            if (result['freqinverter'] && result['freqinverter'].value != 'xxx') {
				if (!this.hasCapability('measure_frequency.freqinverter')) {
					await this.addCapability('measure_frequency.freqinverter');
				}
                // var freqinverter = Number(result['freqinverter'].value) * (Math.pow(10, Number(result['freqinverter'].scale)));
				const freqinverter = this.getScaledValue(result['freqinverter']);
				const current = this.getCapabilityValue('measure_frequency.freqinverter');
				if (current !== freqinverter) {
					await this.setCapabilityValue('measure_frequency.freqinverter', freqinverter);
				}
            }

// if (this.hasCapability('measure_pressure.pressurelow')) {
//					this.removeCapability('measure_pressure.pressurelow');
//				}

// High Side Gas Pressure				
            if (result['pressurehigh'] && result['pressurehigh'].value != 'xxx') {
				if (!this.hasCapability('measure_pressure.pressurehigh')) {
					await this.addCapability('measure_pressure.pressurehigh');
					await this.setCapabilityOptions('measure_pressure.pressurehigh', { "title": {
						"en": "High Side Pressure",
						"nl": "High Side Pressure"
						},
						"units": {
							"en": "bar",
							"nl": "bar"
							},
							"decimals": 2,
						});
				}
                //var pressurehigh = Number(result['pressurehigh'].value) * (Math.pow(10, Number(result['pressurehigh'].scale)));
				const pressurehigh = this.getScaledValue(result['pressurehigh']);
				const current = this.getCapabilityValue('measure_pressure.pressurehigh');
				if (current !== pressurehigh) {
					await this.setCapabilityValue('measure_pressure.pressurehigh', pressurehigh);
				}
            }

// Low Side Gas Pressure
            if (result['pressurelow'] && result['pressurelow'].value != 'xxx') {
				if (!this.hasCapability('measure_pressure.pressurelow')) {
					await this.addCapability('measure_pressure.pressurelow');
					await this.setCapabilityOptions('measure_pressure.pressurelow', { "title": {
						"en": "Low Side Pressure",
						"nl": "Low Side Pressure"
						},
						"units": {
							"en": "bar",
							"nl": "bar"
							},
							"decimals": 2,
						});
				}
                //var pressurelow = Number(result['pressurelow'].value) * (Math.pow(10, Number(result['pressurelow'].scale)));
				const pressurelow = this.getScaledValue(result['pressurelow']);
				const current = this.getCapabilityValue('measure_pressure.pressurelow');
				if (current !== pressurelow) {
					await this.setCapabilityValue('measure_pressure.pressurelow', pressurelow);
				}
            }

// Water Pressure
           if (result['waterpressure'] && result['waterpressure'].value != 'xxx' && Number(result['waterpressure'].value) != 0) {
				if (!this.hasCapability('measure_pressure.waterpressure')) {
					await this.addCapability('measure_pressure.waterpressure');
				}
                //var waterpressure = Number(result['waterpressure'].value) * (Math.pow(10, Number(result['waterpressure'].scale)));
				const waterpressure = this.getScaledValue(result['waterpressure']);
				const current = this.getCapabilityValue('measure_pressure.waterpressure');
				if (current !== waterpressure) {
					await this.setCapabilityValue('measure_pressure.waterpressure', waterpressure);
				}
            }

           if (result['waterpressure'] && (Number(result['waterpressure'].value) == 0)) {
				if (this.hasCapability('measure_pressure.waterpressure')) {
					// await this.removeCapability('measure_pressure.waterpressure');
					await this.setCapabilityValue('measure_pressure.waterpressure', null);
				}
            }

// Discharge Temperature
            if (result['dischargetemp'] && result['dischargetemp'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.dischargetemp')) {
					await this.addCapability('measure_temperature.dischargetemp');
					await this.setCapabilityOptions('measure_temperature.dischargetemp', { "title": {
						"en": "Discharge Temperature",
						"nl": "Discharge Temperature"
						},
						});
				}
                //var dischargetemp = Number(result['dischargetemp'].value) * (Math.pow(10, Number(result['dischargetemp'].scale)));
				const dischargetemp = this.getScaledValue(result['dischargetemp']);
				const current = this.getCapabilityValue('measure_temperature.dischargetemp');
				if (current !== dischargetemp) {
					await this.setCapabilityValue('measure_temperature.dischargetemp', dischargetemp);
				}
            }

// Operational State (Standby, Cooling, Heating)
            if (result['oduoperationcycle'] && result['oduoperationcycle'].value != 'xxx') {
				if (!this.hasCapability('operational_state')) {
					await this.addCapability('operational_state');
					await this.setCapabilityOptions('operational_state', { "title": {
						"en": "Operational state",
						"nl": "Operationele staat"
						},
						"values": [
							{
								"id": "0",
								"title": {
									"en": "Standby",
									"nl": "Standby"
									}
							},
							{
								"id": "1",
								"title": {
									"en": "Cooling",
									"nl": "Koelen"
									}
							},
							{
								"id": "2",
								"title": {
									"en": "Heating",
									"nl": "Verwarmen"
									}
							}
							],
						});
				}

                //var operationmode = Number(result['operationmode'].value);
				var oduoperationcycle = result['oduoperationcycle'].value;
// 				var operationmode =  operationmode_str[result['operationmode'].value] 
				const current = this.getCapabilityValue('operational_state');
				if (current !== oduoperationcycle) {
					await this.setCapabilityValue('operational_state', oduoperationcycle);
				}
            }

		// Thermostat mode
		if (this.isValid(result.operatingmode)) {
			//await this.ensureCapability('thermostat_mode.thermostat');
				if (!this.hasCapability('thermostat_mode.thermostat')) {
					await this.addCapability('thermostat_mode.thermostat');
				}

				const mode = this.enableHeatingCooling === 0
					? 'off'
					: (OPERATING_MODES[result.operatingmode.value] ?? 'off');

				//await this.updateCapability('thermostat_mode.thermostat', mode);
				const current = this.getCapabilityValue('thermostat_mode.thermostat');
				if (current !== mode) {
					await this.setCapabilityValue('thermostat_mode.thermostat', mode);
				}

		}

// Defrost Status
            if (result['statusdefrost'] && result['statusdefrost'].value != 'xxx') {
				if (!this.hasCapability('alarm_cold')) {
					await this.addCapability('alarm_cold');
				}
                //var statusdefrost = false;
				//if ((Number(result['statusdefrost'].value)) == 1) {
				//	statusdefrost = true
				//	}
				const current = this.getCapabilityValue('alarm_cold');
				if (current !== (Number(result.statusdefrost.value) === 1)) {
					await this.setCapabilityValue('alarm_cold', Number(result.statusdefrost.value) === 1);
				}
            }

// Error Code
/*
            if (result['errorcode'] && result['errorcode'].value != 'xxx') {
				if (!this.hasCapability('alarm_generic')) {
					await this.addCapability('alarm_generic');
				}
                var errorcode = false;
				if ((Number(result['errorcode'].value)) != 0) {
					errorcode = true
					}
                await this.setCapabilityValue('alarm_generic', errorcode);
            }
*/

	// Error code: alarm_generic stays the on/off flag, the device timeline shows code + title
		if (this.isValid(result.errorcode)) await this.processErrorCode(Number(result.errorcode.value));


// Silent Mode Status
            if (result['statussilentmode'] && result['statussilentmode'].value != 'xxx') {
//			var statussilentmode = Number(result['statussilentmode'].value);
			const statussilentmode = Number(result['statussilentmode'].value) === 1;
			const current = this.getSetting('settings_enable_silent_mode');

			if (current !== statussilentmode) {
				await this.setSettings({
				settings_enable_silent_mode: statussilentmode
			});
			}
            }

//Cooling Mode
            if (result['statuscooling'] && result['statuscooling'].value != 'xxx') {
//			var statuscooling = Number(result['statuscooling'].value);
			const statuscooling = Number(result['statuscooling'].value) === 1;
			const current = this.getSetting('settings_coolingmode');

			// var statuscooling = Boolean(result['statuscooling'].value);
			
			if (current !== statuscooling) {
				await this.setSettings({
				settings_coolingmode: statuscooling
			});
			}
            }

// Domestic hot water (capabilities only while DHW is enabled)
			await this.processDhw(result);

// Circuit 2 (capabilities only while temptarget2 is not 0)
			await this.processCircuit2(result);

// Flow trigger cards for everything that changed since the previous poll
			this.fireTriggers(result);

    }
}
