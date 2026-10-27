'use strict';

import Homey from 'homey';

module.exports = class ThermaVApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('ThermaVApp has been initialized');
  }

}
