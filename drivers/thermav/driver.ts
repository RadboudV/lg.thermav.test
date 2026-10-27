import Homey from 'homey';

module.exports = class MyThermaVDriver extends Homey.Driver {

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
// onPairListDevices is empty, because the custom start.html handles pairing.   
   // Example device data, note that `store` is optional
      // {
      //   name: 'My Device',
      //   data: {
      //     id: 'my-device',
      //   },
      //   store: {
      //     address: '127.0.0.1',
      //   },
      // },
    ];
  }

};
