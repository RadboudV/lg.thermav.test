import * as Modbus from 'jsmodbus';
import net from 'net';

import { checkInputRegister } from '../response';
import { checkHoldingRegister } from '../response';
import { checkCoilRegister } from '../response';
import { checkDiscreteRegister } from '../response';

import { checkWriteHoldingRegister } from '../response';
import { checkWriteCoilRegister } from '../response';


import { ThermaV } from '../thermav';

import Homey from 'homey';

// Set default retry / polling interval >= timeout of reading all modbus registers!
const DEFAULT_RETRY_INTERVAL = 30;
const DEFAULT_RECONNECT_INTERVAL = 600;
// After a write, ignore register values from polls for this long (heat pump needs time to apply the change)
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

type WriteType = 'settemperature' | 'settemperatureshift' | 'setthermostatmode' | 'setsilentmode' | 'setonoff';

//module.exports = class thermavDevice extends Homey.Device {
class MyThermaVDevice extends ThermaV {
	timer!: NodeJS.Timer;


  private socket: net.Socket | null = null;
  private client: InstanceType<typeof Modbus.client.TCP> | null = null;
  private connecting: Promise<void> | null = null;
  private busy = false;            // one Modbus transaction sequence at a time (poll OR write)
  private failures = 0;
  private lastWrite = 0;           // timestamp (ms) of the last successful write to the heat pump
  private available: boolean | null = null;   // last availability state reported to Homey (null = not reported yet)

  // ---- availability --------------------------------------------------------

  // Call after every successful poll/write. Only talks to Homey when the state changes.
  private markSuccess() {
    this.failures = 0;
    if (this.available !== true) {
      this.available = true;
      this.setAvailable().catch(this.error);
      this.log('Heat pump reachable, device set available');
    }
  }

  // Call after every failed poll/write. Marks the device unavailable after UNAVAILABLE_AFTER_FAILURES in a row.
  private markFailure(reason: string) {
    this.failures++;
    if (this.failures >= UNAVAILABLE_AFTER_FAILURES && this.available !== false) {
      this.available = false;
      this.setUnavailable(`Heat pump not reachable (${reason})`).catch(this.error);
      this.log('Heat pump not reachable, device set unavailable:', reason);
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
 
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('ThermaV device has been initialized:', this.getName(), 'Device name id:', this.getData().id);
 
	let settings = this.getSettings();

    if (settings.pollinginterval === undefined) {
      this.setSettings({ pollinginterval: DEFAULT_RETRY_INTERVAL });
      settings.pollinginterval = DEFAULT_RETRY_INTERVAL;
	}

// Register capability listeners
// ThermostatMode
    this.registerCapabilityListener('target_temperature.thermostat', (value: number) => this.setTargetTemperature(value));
// Target Temperature
    this.registerCapabilityListener('thermostat_mode.thermostat', (value: string) => this.setThermostatMode(value));

    this.timer = this.homey.setInterval(() => {
      // poll device state from HeatPump
      this.pollHeatpump();
    }, settings.pollinginterval * 1000);

    this.pollHeatpump(); // Single Poll (after the interval default is applied and the timer is set)


// Flow Cards ar registered inside driver.ts
//
// End Flow Cards Actions

}

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('ThermaV device has been added');
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
  
    this.log("ThermaV settings where changed");

//Silent Mode
    if (changedKeys.includes('settings_enable_silent_mode')) {
	  this.log('ThermaV settings "settings_enable_silent_mode" were changed. Changed settings from', oldSettings.settings_enable_silent_mode, 'to', newSettings.settings_enable_silent_mode);
	  
	  this.homey.clearInterval(this.timer);
	  
	  this.updateHeatpumpv2('setsilentmode', Number(newSettings.settings_enable_silent_mode), this);
	  
      this.timer = this.homey.setInterval(() => {
      // poll device state from HeatPump
      this.pollHeatpump();
      }, Number(newSettings.pollinginterval) * 1000); // Gaat dat goed newsettings(maar is eigenlijk voor andere geupdate waarde)

    }

// Connection settings changed: the persistent socket still points at the old host/port/unit id.
// Drop it and poll again so the device becomes (un)available based on the new settings.
    if (['address', 'port', 'id'].some((k) => changedKeys.includes(k))) {
	  this.log('Connection settings changed, reconnecting');
	  this.dropConnection();
	  this.failures = 0;
	  this.available = null;
	  // onSettings runs before the new values are stored, so poll a moment later
	  this.homey.setTimeout(() => this.pollHeatpump(), 1000);
    }

//Trigger Desinfection
    if (changedKeys.includes('settings_trigger_desinfection')) {
	  this.log('ThermaV settings "settings_trigger_desinfection" were changed. Changed settings from', oldSettings.settings_trigger_desinfection, 'to', newSettings.settings_trigger_desinfection);
    }

//Polling Interval has changed, clear current timer and set and start new timer
    if (changedKeys.indexOf('pollinginterval') > -1) {
      this.log('Changing the "pollinginterval" settings from', oldSettings.pollinginterval, 'to', newSettings.pollinginterval);

      this.homey.clearInterval(this.timer);
      this.timer = this.homey.setInterval(() => {
        // poll device state from HeatPump
        this.pollHeatpump();
      }, Number(newSettings.pollinginterval) * 1000);
    }
	
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
 async onRenamed(name: string) {
    this.log('ThermaV device was renamed');
  }

//********************************************************
// onDeleted is called when the user deleted the device.
//******************************************************** 
  async onDeleted() {
    this.log('ThermaV device has been deleted');
    this.homey.clearInterval(this.timer);
	this.dropConnection();
  }
//********************************************************


//********************************************************
// onUninit.
//********************************************************
  async onUninit() {
    this.log('ThermaV device has been Un initialized.');
    this.homey.clearInterval(this.timer);
	this.dropConnection();
  }
//********************************************************

  // ---- actions (used by capability listeners and by the flow cards in driver.ts) ------

  /** Thermostat setpoint. In 'auto' mode the pump works with a shift value instead of an absolute target. */
  async setTargetTemperature(value: number) {
    if (this.getCapabilityValue('thermostat_mode.thermostat') === 'auto') {
      if (this.shiftValue === undefined) throw new Error('Shift value not known yet, try again after the next poll');
      const direction = Math.sign(value - Number(this.getCapabilityValue('target_temperature.thermostat')));
      if (direction === 0) return;
      const current = this.shiftValue > 32767 ? this.shiftValue - 65536 : this.shiftValue;   // unsigned -> signed
      const next = Math.min(SHIFT_MAX, Math.max(SHIFT_MIN, current + direction));
      if (next === current) {
        this.log('Shift value already at its limit:', current);
        return;
      }
      this.log('Set shift value:', current, '->', next);
      await this.writeHeatpump('settemperatureshift', next & 0xFFFF);        // signed -> unsigned
      this.shiftValue = next & 0xFFFF;
      return;
    }
    this.log('Set temperature:', value);
    await this.writeHeatpump('settemperature', Math.round(value * 10));
  }

  async setThermostatMode(mode: string) {
    this.log('Set thermostat mode:', mode);
    if (mode === 'off') {
      await this.writeHeatpump('setonoff', 0);
      return;
    }
    if (!(mode in MODE_REGISTER)) throw new Error(`Unknown thermostat mode: ${mode}`);
    if (this.getCapabilityValue('thermostat_mode.thermostat') === 'off') await this.writeHeatpump('setonoff', 1);
    await this.writeHeatpump('setthermostatmode', MODE_REGISTER[mode]);
  }

 /** Flow cards: behave exactly like the user choosing the mode in the Homey app. */
  async setThermostatModeFromFlow(mode: string) {
    await this.triggerCapabilityListener('thermostat_mode.thermostat', mode);
    // triggerCapabilityListener only runs the listener, it does not update the displayed value
    await this.setCapabilityValue('thermostat_mode.thermostat', mode);
  }

  async setSilentMode(enabled: boolean) {
    await this.writeHeatpump('setsilentmode', enabled ? 1 : 0);
    await this.setSettings({ settings_enable_silent_mode: enabled });   // does not call onSettings
  }


//********************************************************
  /**
   * Poll the heatpump
   */
  async pollHeatpump() {
	
	this.log("pollHeatpump");
	if (this.busy) return;                 // previous poll/write still running -> skip
	this.busy = true;

   try {
      await this.connect();                // no-op when already connected
      const client = this.client!;

      const finalRes = {
        ...(await checkInputRegister(this.inputregisters, client)),
        ...(await checkHoldingRegister(this.holdingregisters, client)),
        ...(await checkCoilRegister(this.coilregisters, client)),
        ...(await checkDiscreteRegister(this.discreteregisters, client)),
      };
      // NOTE: the check*Register helpers currently swallow per-register errors.
      // If *every* register failed, treat it as a dead link:
      if (Object.keys(finalRes).length === 0) throw new Error('no registers could be read');
 
      this.markSuccess();
      if (this.getSetting('modbusstatus') !== 'Connected') {
        this.setSettings({ modbusstatus: 'Connected' }).catch(this.error);   // only write when the value changes
      }
      // Right after a write the heat pump may still report the old value -> skip processing to avoid "jumping" values
      if (Date.now() - this.lastWrite >= WRITE_SETTLE_MS) {
        await this.processResult(finalRes);
      } else {
        this.log('pollHeatpump: skipping processResult, write settling');
      }

      // Heat output. A register that could not be read must not fail the poll: treat it as "no output".
      const val = (m?: { value: string; scale: string }) =>
        (m && m.value !== 'xxx') ? Number(m.value) * Math.pow(10, Number(m.scale)) : NaN;

      let producedheat = 0;
      let producedcold = 0;

      const flowRate = val(finalRes.waterflowrate);
      const tempOut = val(finalRes.tempwateroutlet);
      const tempIn = val(finalRes.tempwaterinlet);

      if (val(finalRes.statuswaterflow) == 1 && val(finalRes.statuscompressor) == 1
          && Number.isFinite(flowRate) && Number.isFinite(tempOut) && Number.isFinite(tempIn)) {
        // Filter out negative values; returns the maximum of values (all above 0)
        const heatOutput = Math.round(flowRate * 60 * (tempOut - tempIn) * 1.16227);
        producedheat = Math.max(0, heatOutput);
        producedcold = Math.min(0, heatOutput);
      }
 
	if (!this.hasCapability('measure_power.generatedheat')) {
      await this.addCapability('measure_power.generatedheat').catch(this.error);;
    }

   if (!this.hasCapability('meter_power.totalgeneratedheat')) {
	  await this.addCapability('meter_power.totalgeneratedheat').catch(this.error);;
	  await this.setCapabilityOptions('meter_power.totalgeneratedheat', { "title": {
						"en": "Total Heat Produced",
						"nl": "Totale warmteopbrengst"
						},
						"uiComponent": null
						});
    }
	
//	var producedheat = 0;
      this.setCapabilityValue('measure_power.generatedheat', producedheat);
	  var totalproducedheat = ((this.getCapabilityValue('meter_power.totalgeneratedheat')) + (((producedheat * this.getSettings().pollinginterval)/3600)/1000));
	  this.setCapabilityValue('meter_power.totalgeneratedheat', totalproducedheat); 
	  // this.setCapabilityValue('meter_power.totalgeneratedheat', 0);


   if (!this.hasCapability('measure_power.generatedcold')) {
      await this.addCapability('measure_power.generatedcold').catch(this.error);;
    }
//	var producedcold = 0;
      this.setCapabilityValue('measure_power.generatedcold', producedcold);
	  
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
// Update Heatpump settings
//*****************************************************************************************************
async updateHeatpumpv2(type: string, value: number, device: Homey.Device) {
	this.log("updateHeatpumpv2");
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
      }
      this.lastWrite = Date.now();
      this.markSuccess();                  // a successful write proves the heat pump is reachable
    } catch (err) {
      // Not counted as an availability failure: a Modbus exception (e.g. rejected value) is not a connection
      // problem. The poll loop decides when the device is unavailable.
	  const message = (err as any)?.message ?? String(err);
      this.error('write failed', type, (err as Error).message);
      this.dropConnection();
	  throw new Error(`Writing to the heat pump failed: ${message}`);
    } finally {
      this.busy = false;
    }
  }
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