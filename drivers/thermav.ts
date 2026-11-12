import Homey from 'homey';
import { errorTitle } from '../lib/errorcodes';
import type { Measurement } from '../lib/modbus';
import { SENSORS } from '../lib/sensors';


const OPERATING_MODES: Record<string, string> = { '0': 'cool', '1': 'cool', '2': 'off', '3': 'auto', '4': 'heat' };

const NO_ERROR_TEXT = 'No error';

// Thermostat range of circuit 1 per control method (holding register 1): room air control or water temperature control
const TARGET_RANGE_AIR = { min: 16, max: 30 };
const TARGET_RANGE_WATER = { min: 5, max: 65 };

const title = (en: string, nl: string = en) => ({ en, nl });

// Circuit 2 (second heating/cooling circuit). There is no "installed" register; per the user's finding circuit 2 is in use
// when 'temptarget2' (holding 40006) is not 0. Capabilities are added then and removed again when it returns to 0.
// The operating mode (heat/cool/auto/off) is shared with circuit 1, so circuit 2 has no mode capability of its own.
const CIRCUIT2_TARGET = 'target_temperature.circuit2';
const CIRCUIT2_ROOM   = 'measure_temperature.circuit2';
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
	private defrostActive: boolean | null = null;         // defrost status at the previous poll (null = unknown, e.g. first poll)
	private defrostResetTimer?: NodeJS.Timeout;           // fires at local midnight
	protected shiftValue: number | undefined;         // holding register 4 (raw, unsigned 16 bit)
	private appliedTargetRange: string | undefined;   // range currently set on target_temperature ('min-max'), see applyTargetTemperatureRange

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

		if (!item) {
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
		return !!m;
	}
// -----------------------------------------------------------------------------------------

	/**
	 * Homey resolves the timeline text of a boolean capability (insightsTitleTrue/False) when the timeline is shown,
	 * not when the entry is written: changing the texts per error rewrites every earlier entry. So alarm_generic only
	 * gets FIXED texts (applied at startup), and the code with its description is written where it is stored with the entry:
	 *  - the text capability 'thermav_error' (insights log: value changes are kept with their value)
	 *  - a notification per error / clear (stored text, shown in the Homey timeline/notifications under this app)
	 *  - the fault flow triggers (tokens code + description)
	 */
	protected async applyAlarmTitles() {
		try {
			await this.setCapabilityOptions('alarm_generic', {
				title: title('Error', 'Storing'),
				insightsTitleTrue: title('Error active', 'Storing actief'),
				insightsTitleFalse: title('Error cleared', 'Storing opgelost'),
			});
		} catch (err) {
			this.error('Could not set the alarm_generic texts:', err);
		}
	}

	/**
	 * One Homey notification; failing to create it must never block the error handling.
	 * Notifications need no permission in app.json (an entry such as homey:manager:notifications is invalid and breaks the build).
	 */
	private async notify(excerpt: string) {
		try {
			await this.homey.notifications.createNotification({ excerpt });
		} catch (err) {
			this.error('Could not create notification:', err);
		}
	}

	/** Text shown for a code, e.g. "CH14: Problem in flow switch" (-1 = flag was on, code unknown). */
	private errorText(code: number): string {
		return code > 0 ? `CH${code}: ${errorTitle(code)}` : 'Error (code unknown)';
	}

	private async processErrorCode(code: number) {
		await this.ensureCapability('alarm_generic');
		await this.ensureCapability('thermav_error');

		// Last code we reported; survives app restarts. -1 = flag was on but the code is unknown.
		let previous = this.getStoreValue('errorCode');
		if (typeof previous !== 'number') previous = this.getCapabilityValue('alarm_generic') ? -1 : 0;
		if (previous === code) {
			if (code === 0 && this.getCapabilityValue('alarm_generic') !== false) await this.setCapabilityValue('alarm_generic', false);
			if (code === 0 && this.getCapabilityValue('thermav_error') === null) await this.setCapabilityValue('thermav_error', NO_ERROR_TEXT).catch(this.error);
			return;
		}

		const name = this.getName();
		if (previous !== 0) {
			await this.setCapabilityValue('alarm_generic', false);
			await this.notify(`${name}: error cleared - ${this.errorText(previous)}`);
		}
		if (code !== 0) {
			this.log(`Error ${this.errorText(code)}`);
			await this.setCapabilityValue('alarm_generic', true);
			await this.notify(`${name}: error ${this.errorText(code)}`);
		}
		await this.setCapabilityValue('thermav_error', code !== 0 ? this.errorText(code) : NO_ERROR_TEXT).catch(this.error);
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


	// ---- defrost counter ---------------------------------------------------------------------
	// Counts the start of every defrost cycle (statusdefrost goes from 0 to 1) in the capability defrosts_today.
	// The count and its day are kept in the device store (keys 'defrostCount' and 'defrostDay') so they survive an app restart.
	// The counter is reset at local midnight (timer, plus a day check on every poll as fallback). The first poll after an
	// app start never counts: a defrost that is already running at that moment is missed.

	/** Date and time of day in the timezone configured on the Homey (one place for all local-time logic). */
	private localTime(date = new Date()) {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone: this.homey.clock.getTimezone(),
			year: 'numeric', month: '2-digit', day: '2-digit',
			hour: 'numeric', minute: 'numeric', second: 'numeric',
			hourCycle: 'h23',   // hours 0-23 (never 24)
		}).formatToParts(date);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
		return {
			day: `${get('year')}-${get('month')}-${get('day')}`,   // YYYY-MM-DD, used as the key for "today"
			secondsOfDay: Number(get('hour')) * 3600 + Number(get('minute')) * 60 + Number(get('second')),
		};
	}

	/** Milliseconds until the next local midnight (the poll-time day check covers DST edge cases). */
	private msUntilMidnight(): number {
		return Math.max(1000, (86400 - this.localTime().secondsOfDay) * 1000 + 500);
	}

	/** Starts the midnight timer and makes sure the capability exists and holds today's count. Call from onInit. */
	protected async startDefrostCounter() {
		if (!this.hasCapability('defrosts_today')) await this.addCapability('defrosts_today');
		await this.rolloverDefrostDay();
		this.scheduleDefrostReset();
	}

	protected stopDefrostCounter() {
		if (this.defrostResetTimer) this.homey.clearTimeout(this.defrostResetTimer);
		this.defrostResetTimer = undefined;
	}

	private scheduleDefrostReset() {
		this.stopDefrostCounter();
		this.defrostResetTimer = this.homey.setTimeout(() => {
			this.rolloverDefrostDay().catch(this.error).finally(() => this.scheduleDefrostReset());
		}, this.msUntilMidnight());
	}

	/** Resets the counter when the stored day is not today; also publishes the stored count after a restart. */
	private async rolloverDefrostDay() {
		const today = this.localTime().day;
		if (this.getStoreValue('defrostDay') !== today) {
			await this.setStoreValue('defrostDay', today);
			await this.setStoreValue('defrostCount', 0);
		}
		const count = Number(this.getStoreValue('defrostCount')) || 0;
		if (this.getCapabilityValue('defrosts_today') !== count) {
			await this.setCapabilityValue('defrosts_today', count).catch(this.error);
		}
	}

	/** Called every poll with the current defrost status; counts a rising edge (not defrosting -> defrosting). */
	private async countDefrost(defrosting: boolean) {
		await this.rolloverDefrostDay();
		if (this.defrostActive === false && defrosting) {
			const count = (Number(this.getStoreValue('defrostCount')) || 0) + 1;
			await this.setStoreValue('defrostCount', count);
			await this.setCapabilityValue('defrosts_today', count).catch(this.error);
			this.log('Defrost started, defrosts today:', count);
		}
		this.defrostActive = defrosting;
	}

	/** Copies every plain sensor of lib/sensors.ts from the poll result to its capability (added on first use). */
	private async processSensors(result: Record<string, Measurement>) {
		for (const sensor of SENSORS) {
			const measurement = result[sensor.register];
			if (!measurement) continue;                       // register was not read in this poll

			let value = this.getScaledValue(measurement);
			if (sensor.transform) value = sensor.transform(value);

			if (!this.hasCapability(sensor.capability)) {
				await this.addCapability(sensor.capability);
				if (sensor.options) await this.setCapabilityOptions(sensor.capability, sensor.options);
			}

			const currentValue = this.getCapabilityValue(sensor.capability);
			if (currentValue !== value) {
				await this.setCapabilityValue(sensor.capability, value).catch(this.error);
			}
		}
	}

	/**
	 * Runs one processing step. A step that fails (for example a capability that rejects a value) is logged and must not
	 * stop the other steps (error code, DHW, triggers ...) or make the whole poll count as a lost connection.
	 */
	private async runStep(name: string, step: () => Promise<void> | void) {
		try {
			await step();
		} catch (err) {
			this.error('processResult step failed:', name, (err as Error)?.message ?? err);
		}
	}

	/**
	 * The thermostat range depends on the control method (holding register 1): with room air control (2) the setpoint is
	 * 16-30 degrees, with water outlet / inlet control (0, 1) it goes up to 65 degrees. The capability options are only
	 * written when the range changes (and once after every start).
	 */
	private async applyTargetTemperatureRange(result: Record<string, Measurement>) {
		if (!this.isValid(result.controlmethod)) return;
		const roomAirControl = Number(result.controlmethod.value) === 2;
		const range = roomAirControl ? TARGET_RANGE_AIR : TARGET_RANGE_WATER;
		const key = `${range.min}-${range.max}`;
		if (this.appliedTargetRange === key) return;
		await this.setCapabilityOptions('target_temperature', { decimals: 0, step: 1, ...range });
		this.appliedTargetRange = key;
		this.debug('Thermostat range set to', key, roomAirControl ? '(room air control)' : '(water control)');
	}

	private async processTargetTemperature(result: Record<string, Measurement>) {
		if (!result['temptarget1']) return;
		if (!this.hasCapability('target_temperature')) {
			await this.addCapability('target_temperature');
		}
		await this.applyTargetTemperatureRange(result);

		// Stay inside the range the capability accepts: a value outside it would be rejected by Homey
		const range = this.appliedTargetRange === `${TARGET_RANGE_AIR.min}-${TARGET_RANGE_AIR.max}` ? TARGET_RANGE_AIR : TARGET_RANGE_WATER;
		const temptarget1 = Math.min(range.max, Math.max(range.min, Math.round(this.getScaledValue(result['temptarget1']))));
		if (this.getCapabilityValue('target_temperature') !== temptarget1) {
			await this.setCapabilityValue('target_temperature', temptarget1);
		}
	}

	private async processWaterPressure(result: Record<string, Measurement>) {
		if (!result['waterpressure']) return;
		if (Number(result['waterpressure'].value) !== 0) {
			if (!this.hasCapability('measure_pressure.waterpressure')) {
				await this.addCapability('measure_pressure.waterpressure');
			}
			const waterpressure = this.getScaledValue(result['waterpressure']);
			if (this.getCapabilityValue('measure_pressure.waterpressure') !== waterpressure) {
				await this.setCapabilityValue('measure_pressure.waterpressure', waterpressure);
			}
		} else if (this.hasCapability('measure_pressure.waterpressure')
			&& this.getCapabilityValue('measure_pressure.waterpressure') !== null) {
			// 0 = no sensor / no reading
			await this.setCapabilityValue('measure_pressure.waterpressure', null);
		}
	}

	private async processOperationalState(result: Record<string, Measurement>) {
// Operational State (Standby, Cooling, Heating)
            if (result['oduoperationcycle']) {
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
	}

	private async processThermostatMode(result: Record<string, Measurement>) {
		// Thermostat mode
		if (this.isValid(result.operatingmode)) {
			//await this.ensureCapability('thermostat_mode');
				if (!this.hasCapability('thermostat_mode')) {
					await this.addCapability('thermostat_mode');
				}

				const mode = this.enableHeatingCooling === 0
					? 'off'
					: (OPERATING_MODES[result.operatingmode.value] ?? 'off');

				//await this.updateCapability('thermostat_mode', mode);
				const current = this.getCapabilityValue('thermostat_mode');
				if (current !== mode) {
					await this.setCapabilityValue('thermostat_mode', mode);
				}

		}
	}

	private async processDefrostStatus(result: Record<string, Measurement>) {
// Defrost Status
            if (result['statusdefrost']) {
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
		// Defrosts today: count every start of a defrost cycle, reset at local midnight
		if (this.isValid(result.statusdefrost)) await this.countDefrost(Number(result.statusdefrost.value) === 1);
	}

	private async processSilentModeStatus(result: Record<string, Measurement>) {
// Silent Mode Status
            if (result['statussilentmode']) {
//			var statussilentmode = Number(result['statussilentmode'].value);
			const statussilentmode = Number(result['statussilentmode'].value) === 1;
			const current = this.getSetting('settings_enable_silent_mode');

			if (current !== statussilentmode) {
				await this.setSettings({
				settings_enable_silent_mode: statussilentmode
			});
			}
            }
	}

	private async processCoolingModeStatus(result: Record<string, Measurement>) {
//Cooling Mode
            if (result['statuscooling']) {
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
	}

	async processResult(result: Record<string, Measurement>) {
		if (!result) return;

		// State needed by the thermostat logic (kept per device)
		if (this.isValid(result.enableheatingcooling)) this.enableHeatingCooling = Number(result.enableheatingcooling.value);
		if (this.isValid(result.shiftvalue1)) this.shiftValue = Number(result.shiftvalue1.value);
		if (this.isValid(result.shiftvalue2)) this.shiftValue2 = Number(result.shiftvalue2.value);

		// Error code first, so nothing else that goes wrong in this poll can hide an error of the heat pump.
		// alarm_generic stays the on/off flag; the code with its description goes to thermav_error, a notification and the fault triggers.
		if (this.isValid(result.errorcode)) await this.runStep('errorcode', () => this.processErrorCode(Number(result.errorcode.value)));

		await this.runStep('target temperature', () => this.processTargetTemperature(result));
		await this.runStep('sensors', () => this.processSensors(result));       // plain sensors, see lib/sensors.ts
		await this.runStep('water pressure', () => this.processWaterPressure(result));
		await this.runStep('operational state', () => this.processOperationalState(result));
		await this.runStep('thermostat mode', () => this.processThermostatMode(result));
		await this.runStep('defrost', () => this.processDefrostStatus(result));
		await this.runStep('silent mode', () => this.processSilentModeStatus(result));
		await this.runStep('cooling mode', () => this.processCoolingModeStatus(result));
		await this.runStep('DHW', () => this.processDhw(result));               // capabilities only while DHW is enabled
		await this.runStep('circuit 2', () => this.processCircuit2(result));    // capabilities only while temptarget2 is not 0
		await this.runStep('triggers', () => this.fireTriggers(result));        // everything that changed since the previous poll
	}
}
