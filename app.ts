'use strict';

import Homey from 'homey';

module.exports = class ThermaVApp extends Homey.App {

  async onInit() {
    this.log('ThermaVApp has been initialized');
  }
}
