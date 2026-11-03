import Homey from 'homey';

module.exports = class MyThermaVDriver extends Homey.Driver {

  // Device trigger cards, fired by the device (this.driver) when the heat pump reports a change
  silentModeOnTrigger!: Homey.FlowCardTriggerDevice;
  silentModeOffTrigger!: Homey.FlowCardTriggerDevice;
  solarPumpStartedTrigger!: Homey.FlowCardTriggerDevice;
  solarPumpStoppedTrigger!: Homey.FlowCardTriggerDevice;
  faultDetectedTrigger!: Homey.FlowCardTriggerDevice;
  faultClearedTrigger!: Homey.FlowCardTriggerDevice;

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('LG Therma V Driver has been initialized');
    // Flow cards are registered once per driver (not per device) and receive the chosen device as args.device.
    // Registering them inside Device.onInit would let the last device overwrite the listener of all others.
    const action = (id: string, run: (device: any, args: any) => Promise<void>) =>
      this.homey.flow.getActionCard(id).registerRunListener(async (args) => run(args.device, args));

    action('thermav_setsilentmodeon',    (d) => d.setSilentMode(true));
    action('thermav_setsilentmodeoff',   (d) => d.setSilentMode(false));
    action('thermav_setsilentmodeonoff', (d, args) => d.setSilentMode(args.enabled === 'true'));

    this.silentModeOnTrigger  = this.homey.flow.getDeviceTriggerCard('thermav_silentmode_turned_on');
    this.silentModeOffTrigger = this.homey.flow.getDeviceTriggerCard('thermav_silentmode_turned_off');
    this.solarPumpStartedTrigger = this.homey.flow.getDeviceTriggerCard('thermav_solarpump_started');
    this.solarPumpStoppedTrigger = this.homey.flow.getDeviceTriggerCard('thermav_solarpump_stopped');
    this.faultDetectedTrigger = this.homey.flow.getDeviceTriggerCard('thermav_fault_detected');
    this.faultClearedTrigger  = this.homey.flow.getDeviceTriggerCard('thermav_fault_cleared');

    // Condition ("and ..." column): true while the heat pump reports silent mode on (kept in this setting by the poll and by setSilentMode)
    this.homey.flow.getConditionCard('thermav_silentmodeenabled')
      .registerRunListener(async (args) => args.device.getSetting('settings_enable_silent_mode') === true);

    action('thermav_setenergystate', (d, args) => d.setEnergyState(Number(args.state)));

    // Condition cards: they read the register values of the last successful poll (device.getLastValue throws a readable
    // error when there is no recent data). Cards that are inverted by the user ("is not ...") are handled by Homey.
    const condition = (id: string, test: (d: any, args: any) => boolean) =>
      this.homey.flow.getConditionCard(id).registerRunListener(async (args) => test(args.device, args));

    condition('thermav_compressor_running',      (d) => d.getLastValue('statuscompressor') === 1);
    condition('thermav_operationcycle_is',       (d, a) => d.getLastValue('oduoperationcycle') === Number(a.cycle));
    condition('thermav_heatingcooling_enabled',  (d) => d.getLastValue('enableheatingcooling') === 1);
    condition('thermav_dhw_enabled',             (d) => d.getLastValue('enabledhw') === 1);
    condition('thermav_circuit2_inuse',          (d) => d.getLastValue('temptarget2') !== 0);
    condition('thermav_backupheater_active',     (d, a) => d.getLastValue(a.step === '2' ? 'statusbackupheater2' : 'statusbackupheater1') === 1);
    condition('thermav_waterpump_running',       (d) => d.getLastValue('statuswaterpump') === 1);
    condition('thermav_extwaterpump_running',    (d) => d.getLastValue('statusextwaterpup') === 1);
    condition('thermav_mixpump_running',         (d) => d.getLastValue('statusmixpump') === 1);
    condition('thermav_solarpump_running',       (d) => d.getLastValue('statussolarpump') === 1);
    condition('thermav_cooling_active',          (d) => d.getLastValue('statuscooling') === 1);
    condition('thermav_emergency_available',     (d) => d.getLastValue('statusemergency') === 1);
    condition('thermav_errorcode_is',            (d, a) => d.getLastValue('errorcode') === Number(a.code));
    condition('thermav_energystate_is',          (d, a) => d.getLastValue('energystateinput') === Number(a.state));
    condition('thermav_controlmethod_is',        (d, a) => d.getLastValue('controlmethod') === Number(a.method));

    // Temperature setpoints. The device methods throw a readable error when the target does not apply
    // (DHW not enabled / circuit 2 not in use); the cards for DHW and circuit 2 are also only offered for devices that have that capability.
    action('thermav_settemperature',         (d, args) => d.setTargetTemperature(Number(args.temperature)));
    action('thermav_setdhwtemperature',      (d, args) => d.setDhwTargetTemperature(Number(args.temperature)));
    action('thermav_settemperaturecircuit2', (d, args) => d.setTargetTemperature2(Number(args.temperature)));

    action('thermav_turnheatpumpoff',    (d) => d.setThermostatModeFromFlow('off'));
    action('thermav_turnheatpumponauto', (d) => d.setThermostatModeFromFlow('auto'));
    action('thermav_turnheatpumponcool', (d) => d.setThermostatModeFromFlow('cool'));
    action('thermav_turnheatpumponheat', (d) => d.setThermostatModeFromFlow('heat'));
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
   /**
   * Devices are added through the custom pair view (pair/start.html), so there is nothing to list.
   */
  async onPairListDevices() {
    return [
		// onPairListDevices is empty, because the custom pair/start.html handles pairing.   
    ];
  }

};
