import * as Modbus from 'jsmodbus';
import net from 'net';

import {
  checkInputRegister,
  checkHoldingRegister,
  checkCoilRegister,
  checkDiscreteRegister,
  isModbusException,
} from '../../lib/modbus';
import { holdingregisters, inputregisters, coilregisters, discreteregisters } from '../../lib/registers';

import { ThermaV } from '../thermav';


// Set default polling interval (seconds) >= time needed to read all modbus registers!
const DEFAULT_POLLING_INTERVAL = 30;
// After a write, ignore register values from polls for this long (heat pump needs time to apply the change)
const MAX_METER_GAP_S = 300;          // longest gap (s) that is still counted in the energy meters
const WRITE_SETTLE_MS = 5000;
// Mark the device unavailable after this many failed polls/writes in a row
const UNAVAILABLE_AFTER_FAILURES = 3;
// Give up connecting to an unreachable heat pump after this long (otherwise the OS can take minutes)
const CONNECT_TIMEOUT_MS = 10000;
// Give up waiting for a running poll before a write (ms)
const WRITE_WAIT_MS = 30000;
// Shift value (holding register 4) is a signed 16 bit number stored unsigned; the heat pump accepts -5..+5
const SHIFT_MIN = -5;
const SHIFT_MAX = 5;
// Thermostat mode -> value of holding register 0
const MODE_REGISTER: Record<string, number> = { cool: 0, heat: 4, auto: 3 };

// Product identification (input registers, read once per app start, not on every poll).
// Manual numbering 39998 / 39999 = 30001 + address 9997 / 9998.
const PRODUCT_GROUP_ADDRESS = 9997;   // 39998 Productgroep: 0x8X (0x80, 0x83, 0x88, 0x89) -> AWHP connected
const PRODUCT_INFO_ADDRESS = 9998;    // 39999 Productinfo: only meaningful when an AWHP is connected
// 39999 Productinfo: the type is one nibble of the register. Measured on a Monobloc AWHP: 0x1310,
// so the type (3 = Monobloc) is bits 8-11. The other nibbles are not documented and only shown as raw hex.
const productType = (info: number) => (info >> 8) & 0x0F;
const PRODUCT_INFO_NAMES: Record<number, string> = {
  0: 'Split',
  3: 'Monobloc',
  4: 'High temp.',
  5: 'Medium temp.',
  6: 'System boiler',
};

// Capabilities that were renamed. Devices that were added with the old ids are migrated once in onInit:
// the new capability is added, the value is copied and the old one is removed. [old id, new id, options of the new capability]
// (Flows built on the old capabilities have to be re-created, the flow cards belong to the capability id.)
const RENAMED_CAPABILITIES: Array<[string, string, Record<string, unknown> | undefined]> = [
  ['thermostat_mode.thermostat',    'thermostat_mode',    undefined],
  ['target_temperature.thermostat', 'target_temperature', { decimals: 0, step: 1 }],
  ['measure_temperature.thermostat', 'measure_temperature', undefined],
];
// Circuit 2 capabilities come and go with temptarget2: the old ids are only removed, processCircuit2 adds the new ones (with their options).
const REMOVED_CAPABILITIES = ['target_temperature.thermostat2', 'measure_temperature.thermostat2'];

type WriteType = 'settemperature' | 'settemperatureshift' | 'setthermostatmode' | 'setsilentmode' | 'setonoff' | 'setenabledhw' | 'settriggerdesinfection' | 'setdhwtemperature' | 'settemperature2' | 'settemperatureshift2' | 'setenergystate';

//module.exports = class thermavDevice extends Homey.Device {
class MyThermaVDevice extends ThermaV {
  private pollTimer?: NodeJS.Timeout;   // type returned by homey.setInterval (NodeJS.Timer is deprecated in newer @types/node)

  private socket: net.Socket | null = null;
  private client: InstanceType<typeof Modbus.client.TCP> | null = null;
  private connecting: Promise<void> | null = null;
  private busy = false;            // one Modbus transaction sequence at a time (poll OR write)
  private failures = 0;
  private lastMeterTime = 0;       // timestamp (ms) of the previous meter update (0 = none yet)
  private lastWrite = 0;           // timestamp (ms) of the last successful write to the heat pump
  private productDetected = false;   // product registers are read once (until that succeeds), not on every poll
  protected isAwhp: boolean | null = null;   // null = not detected yet
  protected productInfo: number | null = null;
  private available: boolean | null = null;   // last availability state reported to Homey (null = not reported yet)

  // ---- availability --------------------------------------------------------

  // Call after every successful poll/write. Only talks to Homey when the state changes.
  private markSuccess() {
    this.failures = 0;
    if (this.available !== true) {
      this.available = true;
      this.setAvailable().catch(this.error);
      this.debug('Heat pump reachable, device set available');
    }
  }

  // Call after every failed poll/write. Marks the device unavailable after UNAVAILABLE_AFTER_FAILURES in a row.
  private markFailure(reason: string) {
    this.failures++;
    if (this.failures >= UNAVAILABLE_AFTER_FAILURES && this.available !== false) {
      this.available = false;
      this.setUnavailable(`Heat pump not reachable (${reason})`).catch(this.error);
      this.debug('Heat pump not reachable, device set unavailable:', reason);
    }
  }


  // ---- connection handling -------------------------------------------------

  private isConnected(): boolean {
    return !!this.socket && !this.socket.destroyed && !this.socket.connecting
      && this.socket.readyState === 'open';
  }
 
  private connect(): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    if (this.connecting) return this.connecting;          // someone is already connecting
 
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const client = new Modbus.client.TCP(socket, Number(this.getSetting('id')), 5000);
 
      const onFail = (err: Error) => { this.dropConnection(); reject(err); };
 
      socket.setKeepAlive(true, 10_000);   // detect half-dead links
      socket.setNoDelay(true);
      socket.once('error', onFail);
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('timeout', () => onFail(new Error('connect timeout')));
      socket.on('close', () => { this.socket = null; this.client = null; });
      socket.on('error', (err) => this.error('socket error', err.message)); // never leave unhandled
 
      socket.connect({ host: this.getSetting('address'), port: Number(this.getSetting('port')) }, () => {
        socket.removeListener('error', onFail);
        socket.removeAllListeners('timeout');
        socket.setTimeout(0);              // connected: request timeouts are handled by jsmodbus
        this.socket = socket;
        this.client = client;
        resolve();
      });
    }).finally(() => { this.connecting = null; });
 
    return this.connecting;
  }
 
  private dropConnection() {
    if (this.socket) { this.socket.removeAllListeners('close'); this.socket.destroy(); }
    this.socket = null;
    this.client = null;
  }
 
   // ---- product detection (once) ----------------------------------------------

  /**
   * Read the product registers and show the result under the device settings (setting 'detectedmodel').
   * Called from the first successful poll. A dead link throws, so the next poll tries again;
   * a Modbus exception (register not supported) is final for this app run.
   * Must run while this.busy is held and the connection is up.
   */
  private async detectProduct(client: InstanceType<typeof Modbus.client.TCP>) {
    let label: string;
    try {
      const group = (await client.readInputRegisters(PRODUCT_GROUP_ADDRESS, 1)).response.body.valuesAsArray[0] as number;
      const isAwhp = (group & 0xF0) === 0x80;            // low byte 0x8x
      let info: number | null = null;
      if (isAwhp) {
        info = (await client.readInputRegisters(PRODUCT_INFO_ADDRESS, 1)).response.body.valuesAsArray[0] as number;
      }
      this.isAwhp = isAwhp;
      this.productInfo = info;
      const hex = (v: number) => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
      label = isAwhp
        ? `AWHP ${PRODUCT_INFO_NAMES[productType(info!)] ?? `unknown type ${productType(info!)}`} (group ${hex(group)}, info ${hex(info!)})`
        : `No AWHP (group ${hex(group)})`;
    } catch (err) {
      if (!isModbusException(err)) throw err;            // link problem: retry on the next poll
      this.isAwhp = null;
      this.productInfo = null;
      label = 'Not supported by this heat pump';
      this.debug('Product registers rejected:', (err as any)?.message ?? err);
    }
    this.productDetected = true;
    this.log('Detected product:', label);
    if (this.getSetting('detectedmodel') !== label) {
      await this.setSettings({ detectedmodel: label }).catch(this.error);
    }
  }

   // ---- polling timer ---------------------------------------------------------

  private startPolling(intervalSeconds: number) {
    this.stopPolling();
    this.pollTimer = this.homey.setInterval(() => { this.pollHeatpump(); }, intervalSeconds * 1000);
  }

  private stopPolling() {
    if (this.pollTimer) this.homey.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  /** One-off rename of capability ids on devices that were added with the old ids (see RENAMED_CAPABILITIES). */
  private async migrateCapabilities() {
    for (const [oldId, newId, options] of RENAMED_CAPABILITIES) {
      if (!this.hasCapability(oldId)) continue;
      try {
        if (!this.hasCapability(newId)) {
          const value = this.getCapabilityValue(oldId);
          await this.addCapability(newId);
          if (options) await this.setCapabilityOptions(newId, options);
          if (value !== null && value !== undefined) await this.setCapabilityValue(newId, value).catch(this.error);
        }
        await this.removeCapability(oldId);
        this.log('Capability renamed:', oldId, '->', newId);
      } catch (err) {
        // one failing rename must not stop onInit; it is retried on the next start
        this.error('Capability rename failed:', oldId, '->', newId, err);
      }
    }
    for (const oldId of REMOVED_CAPABILITIES) {
      if (this.hasCapability(oldId)) await this.removeCapability(oldId).catch(this.error);
    }
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.debug('ThermaV device has been initialized:', this.getName(), 'Device name id:', this.getData().id);

    await this.migrateCapabilities();
 
	let interval = Number(this.getSetting('pollinginterval'));
	
    if (!interval) {
      interval = DEFAULT_POLLING_INTERVAL;
      await this.setSettings({ pollinginterval: interval });
    }

// Register capability listeners
// ThermostatMode
    this.registerCapabilityListener('target_temperature', (value: number) => this.setTargetTemperature(value));
// Target Temperature
    this.registerCapabilityListener('thermostat_mode', (value: string) => this.setThermostatMode(value));
// Circuit 2 target temperature (the capability only exists while circuit 2 is active)
    this.registerCapabilityListener('target_temperature.circuit2', (value: number) => this.setTargetTemperature2(value));
// DHW target temperature (the capability only exists while DHW is enabled)
    this.registerCapabilityListener('target_temperature.dhw', (value: number) => this.setDhwTargetTemperature(value));

	this.startPolling(interval);
    this.pollHeatpump();   // first poll right away
	
// Flow Cards ar registered inside driver.ts
//
// End Flow Cards Actions

}

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.debug('ThermaV device has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
  
    this.debug("ThermaV settings where changed");

// Silent mode toggled by the user in the settings page (a setSettings() call from code does not end up here)
    if (changedKeys.includes('settings_enable_silent_mode')) {
      await this.writeHeatpump('setsilentmode', newSettings.settings_enable_silent_mode ? 1 : 0);
    }

// Connection settings changed: the persistent socket still points at the old host/port/unit id.
// Drop it and poll again so the device becomes (un)available based on the new settings.
    if (['address', 'port', 'id'].some((k) => changedKeys.includes(k))) {
	  this.debug('Connection settings changed, reconnecting');
	  this.dropConnection();
	  this.failures = 0;
	  this.available = null;
	  this.productDetected = false;   // another heat pump may be behind the new address: detect the product again
	  this.isAwhp = null;
	  this.productInfo = null;
	  // onSettings runs before the new values are stored, so poll a moment later
	  this.homey.setTimeout(() => this.pollHeatpump(), 1000);
    }

// Desinfection is part of DHW: refuse it (before anything is written) when DHW is not enabled
    const wantsDesinfection = changedKeys.includes('settings_trigger_desinfection') && Boolean(newSettings.settings_trigger_desinfection);
    if (wantsDesinfection && !newSettings.settings_enable_dhw) {
      throw new Error('Trigger Desinfection only works when "Enable DHW" is on.');
    }

// Enable DHW toggled by the user: write the coil. The DHW capabilities follow on the next poll.
    if (changedKeys.includes('settings_enable_dhw')) {
      this.debug('Enable DHW changed from', oldSettings.settings_enable_dhw, 'to', newSettings.settings_enable_dhw);
      await this.writeHeatpump('setenabledhw', newSettings.settings_enable_dhw ? 1 : 0);
    }

//Trigger Desinfection (only a trigger: the checkbox is switched back off right after the write)
    if (wantsDesinfection) {
      await this.writeHeatpump('settriggerdesinfection', 1);
      this.homey.setTimeout(() => this.setSettings({ settings_trigger_desinfection: false }).catch(this.error), 1000);
    }

//Polling Interval has changed, clear current timer and set and start new timer
    if (changedKeys.includes('pollinginterval')) {
      this.debug('Polling interval changed from', oldSettings.pollinginterval, 'to', newSettings.pollinginterval);
      this.startPolling(Number(newSettings.pollinginterval));
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
 async onRenamed(name: string) {
    this.debug('ThermaV device was renamed to', name);
  }

//********************************************************
// onDeleted is called when the user deleted the device.
//******************************************************** 
  async onDeleted() {
    this.debug('ThermaV device has been deleted');
    this.stopPolling();
	this.dropConnection();
  }
//********************************************************


//********************************************************
// onUninit.
//********************************************************
  async onUninit() {
    this.debug('ThermaV device has been Un initialized.');
    this.stopPolling();
	this.dropConnection();
  }
//********************************************************


//**************************************************************************************
// ---- actions (used by capability listeners and by the flow cards in driver.ts) ------
//**************************************************************************************

  /** Thermostat setpoint. In 'auto' mode the pump works with a shift value instead of an absolute target. */
  async setTargetTemperature(value: number) {
    if (this.getCapabilityValue('thermostat_mode') === 'auto') {
      if (this.shiftValue === undefined) throw new Error('Shift value not known yet, try again after the next poll');
      const delta = Math.round(value - Number(this.getCapabilityValue('target_temperature')));   // 1 step from the app, more from a flow card
      if (delta === 0) return;
      const current = this.shiftValue > 32767 ? this.shiftValue - 65536 : this.shiftValue;   // unsigned -> signed
      const next = Math.min(SHIFT_MAX, Math.max(SHIFT_MIN, current + delta));
      if (next === current) {
        this.debug('Shift value already at its limit:', current);
        return;
      }
      this.debug('Set shift value:', current, '->', next);
      await this.writeHeatpump('settemperatureshift', next & 0xFFFF);        // signed -> unsigned
      this.shiftValue = next & 0xFFFF;
      return;
    }
    this.debug('Set temperature:', value);
    await this.writeHeatpump('settemperature', Math.round(value * 10));
  }

  /**
   * Circuit 2 setpoint (holding 40006), or in 'auto' mode the shift value (holding 40008), exactly like circuit 1.
   * The operating mode is shared by both circuits.
   */
  async setTargetTemperature2(value: number) {
    // The circuit 2 capability only exists while temptarget2 is not 0
    if (!this.hasCapability('target_temperature.circuit2')) throw new Error('Circuit 2 is not in use');
    if (this.getCapabilityValue('thermostat_mode') === 'auto') {
      if (this.shiftValue2 === undefined) throw new Error('Shift value circuit 2 not known yet, try again after the next poll');
      const delta = Math.round(value - Number(this.getCapabilityValue('target_temperature.circuit2')));
      if (delta === 0) return;
      const current = this.shiftValue2 > 32767 ? this.shiftValue2 - 65536 : this.shiftValue2;   // unsigned -> signed
      const next = Math.min(SHIFT_MAX, Math.max(SHIFT_MIN, current + delta));
      if (next === current) {
        this.debug('Shift value circuit 2 already at its limit:', current);
        return;
      }
      this.debug('Set shift value circuit 2:', current, '->', next);
      await this.writeHeatpump('settemperatureshift2', next & 0xFFFF);        // signed -> unsigned
      this.shiftValue2 = next & 0xFFFF;
      return;
    }
    this.debug('Set temperature circuit 2:', value);
    await this.writeHeatpump('settemperature2', Math.round(value * 10));
  }

  /** Energy state input (holding 40010): 0 not used ... 8 super energy saving mode. */
  async setEnergyState(state: number) {
    if (!Number.isInteger(state) || state < 0 || state > 8) throw new Error(`Energy state must be 0-8 (got ${state})`);
    this.debug('Set energy state:', state);
    await this.writeHeatpump('setenergystate', state);
  }

  /** DHW setpoint: holding register 8 in 0.1 °C units. Only possible while DHW is enabled. */
  async setDhwTargetTemperature(value: number) {
    if (this.dhwEnabled !== true) throw new Error('Enable DHW first to set the DHW target temperature');
    this.debug('Set DHW target temperature:', value);
    await this.writeHeatpump('setdhwtemperature', Math.round(value * 10));
  }

  async setThermostatMode(mode: string) {
    this.debug('Set thermostat mode:', mode);
    if (mode === 'off') {
      await this.writeHeatpump('setonoff', 0);
      return;
    }
    if (!(mode in MODE_REGISTER)) throw new Error(`Unknown thermostat mode: ${mode}`);
    if (this.getCapabilityValue('thermostat_mode') === 'off') await this.writeHeatpump('setonoff', 1);
    await this.writeHeatpump('setthermostatmode', MODE_REGISTER[mode]);
  }

 /** Flow cards: behave exactly like the user choosing the mode in the Homey app. */
  async setThermostatModeFromFlow(mode: string) {
    await this.triggerCapabilityListener('thermostat_mode', mode);
    // triggerCapabilityListener only runs the listener, it does not update the displayed value
    await this.setCapabilityValue('thermostat_mode', mode);
  }

  async setSilentMode(enabled: boolean) {
    await this.writeHeatpump('setsilentmode', enabled ? 1 : 0);
    await this.setSettings({ settings_enable_silent_mode: enabled });   // does not call onSettings
  }


//**************************************************************************************
  /**
   * Poll the heatpump
   */
//**************************************************************************************
  async pollHeatpump() {
	
	this.debug("pollHeatpump");
	if (this.busy) return;                 // previous poll/write still running -> skip
	this.busy = true;

   try {
      await this.connect();                // no-op when already connected
      const client = this.client!;

      if (!this.productDetected) await this.detectProduct(client);   // once per start

      const finalRes = {
        ...(await checkInputRegister(inputregisters, client)),
        ...(await checkHoldingRegister(holdingregisters, client)),
        ...(await checkCoilRegister(coilregisters, client)),
        ...(await checkDiscreteRegister(discreteregisters, client)),
      };
      // NOTE: the check*Register helpers currently swallow per-register errors.
      // If *every* register failed, treat it as a dead link:
      if (Object.keys(finalRes).length === 0) throw new Error('no registers could be read');
 
      this.markSuccess();
      this.snapshot = finalRes;              // condition cards read from this
      this.snapshotTime = Date.now();
      if (this.getSetting('modbusstatus') !== 'Connected') {
        this.setSettings({ modbusstatus: 'Connected' }).catch(this.error);   // only write when the value changes
      }
      // Right after a write the heat pump may still report the old value -> skip processing to avoid "jumping" values
      if (Date.now() - this.lastWrite >= WRITE_SETTLE_MS) {
        await this.processResult(finalRes);
      } else {
        this.debug('pollHeatpump: skipping processResult, write settling');
      }

      // Heat output. A register that could not be read must not fail the poll: treat it as "no output".
      const val = (m?: { value: string; scale: string }) =>
        (m && m.value !== 'xxx') ? Number(m.value) * Math.pow(10, Number(m.scale)) : NaN;

      let producedheat = 0;
      let producedcold = 0;

      const flowRate = val(finalRes.waterflowrate);
      const tempOut = val(finalRes.tempwateroutlet);
      const tempIn = val(finalRes.tempwaterinlet);
	  const compressorOn = val(finalRes.statuscompressor) === 1;

//      if (val(finalRes.waterflowrate) > 5 && val(finalRes.statuscompressor) == 1
//          && Number.isFinite(flowRate) && Number.isFinite(tempOut) && Number.isFinite(tempIn)) {
//        const heatOutput = Math.round(flowRate * 60 * (tempOut - tempIn) * 1.16227);
//        producedheat = Math.max(0, heatOutput);
//        producedcold = Math.min(0, heatOutput);
//      }

      if (flowRate > 5 && compressorOn
          && Number.isFinite(flowRate) && Number.isFinite(tempOut) && Number.isFinite(tempIn)) {
        const energyOutput = Math.round(flowRate * 60 * (tempOut - tempIn) * 1.16227);
        producedheat = Math.max(0, energyOutput);
        producedcold = Math.max(0, -energyOutput); // Store the cooling energy produced as positive value
      }

      await this.setCapabilityValue('measure_power.generatedheat', producedheat).catch(this.error);
      await this.setCapabilityValue('measure_power.generatedcold', producedcold).catch(this.error);

	  // Meters: integrate the output over the real time since the previous poll (not the configured interval),
	  // capped so a long gap (app restart, connection loss) does not add a large bogus amount.
	  const now = Date.now();
	  const elapsedSeconds = this.lastMeterTime ? Math.min((now - this.lastMeterTime) / 1000, MAX_METER_GAP_S) : 0;
	  this.lastMeterTime = now;

	  const totalproducedheat = (Number(this.getCapabilityValue('meter_power.totalgeneratedheat')) || 0) + ((producedheat * elapsedSeconds) / 3600) / 1000;
	  await this.setCapabilityValue('meter_power.totalgeneratedheat', totalproducedheat).catch(this.error);

	  const totalproducedcold = (Number(this.getCapabilityValue('meter_power.totalgeneratedcold')) || 0) + ((producedcold * elapsedSeconds) / 3600) / 1000;
	  await this.setCapabilityValue('meter_power.totalgeneratedcold', totalproducedcold).catch(this.error);

	  
    } catch (err) {
      this.error('poll failed', (err as Error).message);
      this.dropConnection();               // next poll reconnects from scratch
      if (this.getSetting('modbusstatus') !== 'Error') {
        this.setSettings({ modbusstatus: 'Error' }).catch(this.error);
      }
      this.markFailure((err as Error).message);
    } finally {
      this.busy = false;
    }
  }

//*****************************************************************************************************
// Write Heatpump
//*****************************************************************************************************
 /**
   * Write one value to the heat pump. Throws when the write fails, so the caller (capability listener,
   * flow card, settings page) shows the error to the user.
   */
  async writeHeatpump(type: WriteType, value: number) {
    // wait for a running poll to finish instead of clearing/restarting the timer
    const deadline = Date.now() + WRITE_WAIT_MS;
    while (this.busy) {
      if (Date.now() > deadline) throw new Error('Heat pump is busy, try again');
      await new Promise((r) => this.homey.setTimeout(r, 100));
    }
    this.busy = true;
    try {
      await this.connect();
      const c = this.client!;
      switch (type) {
        case 'settemperature':      await c.writeSingleRegister(2, value); break;
        case 'settemperatureshift': await c.writeSingleRegister(4, value); break;
        case 'setthermostatmode':   await c.writeSingleRegister(0, value); break;
        case 'setsilentmode':       await c.writeSingleCoil(2, Boolean(value)); break;
        case 'setonoff':            await c.writeSingleCoil(0, Boolean(value)); break;
        case 'setenergystate':      await c.writeSingleRegister(9, value); break;
        case 'setdhwtemperature':   await c.writeSingleRegister(8, value); break;
        case 'settemperature2':      await c.writeSingleRegister(5, value); break;
        case 'settemperatureshift2': await c.writeSingleRegister(7, value); break;
        case 'setenabledhw':        await c.writeSingleCoil(1, Boolean(value)); break;
        case 'settriggerdesinfection': await c.writeSingleCoil(3, Boolean(value)); break;
      }
      this.lastWrite = Date.now();
      this.markSuccess();                  // a successful write proves the heat pump is reachable
    } catch (err) {
      // Not counted as an availability failure: a Modbus exception (e.g. rejected value) is not a connection
      // problem. The poll loop decides when the device is unavailable.
      const message = (err as any)?.message ?? String(err);
      this.error('write failed', type, message);
      this.dropConnection();
      throw new Error(`Writing to the heat pump failed: ${message}`);
    } finally {
      this.busy = false;
    }
  }
//*****************************************************************************************************

}
module.exports = MyThermaVDevice;
