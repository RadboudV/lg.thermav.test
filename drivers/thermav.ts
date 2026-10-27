// import Homey, { Device } from 'homey';
import Homey from 'homey';

//export var autoshiftvalue1test = 0 ;

export interface Measurement {
    value: string;
    scale: string;
    label: string;
}

const OPERATING_MODES: Record<string, string> = { '0': 'cool', '1': 'cool', '2': 'off', '3': 'auto', '4': 'heat' };

// var enableheatingcoolingvariable = 0;

export class ThermaV extends Homey.Device {

	// Per-device state (was module-level before, which is shared between devices)
	protected enableHeatingCooling = 1;               // coil 0: 0 = heating/cooling disabled
	protected shiftValue: number | undefined;         // holding register 4 (raw, unsigned 16 bit)

	// Holding Registers (read or write) 40001+x
	holdingregisters: Object = {
		"operatingmode":  [0, 1, 'UINT16', "Operating Mode", 0],
		"controlmethod":  [1, 1, 'UINT16', "Control Method", 0],
		"temptarget1":    [2, 1, 'UINT16', "Target Temperature Circuit 1", -1],
		"temproom1":      [3, 1, 'INT16',  "Room 1 Temperature", 0],
		"shiftvalue1":    [4, 1, 'UINT16', "Shift Value Target Circuit 1", 0],
		"temptarget2":    [5, 1, 'INT16',  "Target Temperature Circuit 2", -1],
		"temproom2":      [6, 1, 'INT16',  "Room 2 Temperature", 0],
		"shiftvalue2":    [7, 1, 'UINT16', "Shift Value Target Circuit 2", 0],
		"temptargetdhw":  [8, 1, 'INT16',  "Domestic Hot Water Temperature Target", 0],
		"energystateinputhr": [9, 1, 'UINT16', "EnergyState Input", 0]
	}

	// Input Registers (only read) (30001+x)
	inputregisters: Object = {
		"errorcode":        [0, 1, 'UINT16', "Error Code", 0],
		"oduoperationcycle":[1, 1, 'UINT16', "ODU Operation Cycle", 0],
		"tempwaterinlet":   [2, 1, 'INT16',  "Water Inlet Temperature", -1],
		"tempwateroutlet":  [3, 1, 'INT16',  "Water Outlet Temperature", -1],
		"tempwaterbackupheater": [4, 1, 'INT16', "Water Outlet Temperature Backup Heater", -1],
		"tempwaterDHWtank": [5, 1, 'INT16',  "DHW Tank Temperature", -1],
		"tempsolarcollector": [6, 1, 'INT16', "Solar Collector Temperature", -1],
		"temproomcircuit1": [7, 1, 'INT16',  "Room 1 Temperature", -1],
		"waterflowrate":    [8, 1, 'UINT16', "Water Flow Rate", -1],
		"waterflowtemp":    [9, 1, 'INT16',  "Water Flow Temperature", -1],
		"temproomcircuit2": [10, 1, 'INT16', "Room 2 Temperature", -1],
		"energystateinput": [11, 1, 'UINT16', "EnergyState Input", 0],
		"tempoutdoor":      [12, 1, 'INT16', "Outdoor Temperature", -1],
		"waterpressure":    [13, 1, 'UINT16', "Water Pressure", 2],
		"temppipein":       [16, 1, 'INT16', "Pipe Inlet Temperature", -1],
		"temppipeout":      [17, 1, 'INT16', "Pipe Outlet Temperature", -1],
		"tempsuction":      [18, 1, 'INT16', "Suction Temperature", -1],
		"dischargetemp":    [19, 1, 'INT16', "Discharge Temperature", -1],
		"temphex":          [20, 1, 'INT16', "Air Heat Exchanger Temperature", -1],
		"unknown2":         [21, 1, 'INT16', "Unknown 2", -1],
		"pressurehigh":     [22, 1, 'UINT16', "High Side Pressure", -2],
		"pressurelow":      [23, 1, 'UINT16', "Low Side Pressure", -2],
		"freqinverter":     [24, 1, 'UINT16', "Inverter Frequency", 0],
		"productgroup":     [9997, 1, 'UINT16', "Product Group", 0],
		"productinfo":      [9998, 1, 'UINT16', "Product Info", 0]
	}

	// Coil Registers (1 bit register read or write)
	coilregisters: Object = {
		"enableheatingcooling": [0, 1, 'UINT16', "Enable Heating/Cooling", 0],
		"enabledhw":            [1, 1, 'UINT16', "Enable Domestic Hot Water", 0],
		"silentmode":           [2, 1, 'UINT16', "Enable Silent Mode", 0],
		"desinfection":         [3, 1, 'UINT16', "Trigger Desinfection", 0],
		"emergencystop":        [4, 1, 'UINT16', "Emergency Stop", 0],
		"emergencyoperation":   [5, 1, 'UINT16', "Emergency Operation", 0]
	}

	// Discrete Input Registers (1 bit register only read) 10001+x
	discreteregisters: Object = {
		"statuswaterflow":   [0, 1, 'UINT16', "Waterflow Status", 0],
		"statuswaterpump":   [1, 1, 'UINT16', "WaterPump Status", 0],
		"statusextwaterpup": [2, 1, 'UINT16', "External Water Pump", 0],
		"statuscompressor":  [3, 1, 'UINT16', "Compressor Status", 0],
		"statusdefrost":     [4, 1, 'UINT16', "Defrost Status", 0],
		"statusdhwheating":  [5, 1, 'UINT16', "DHW Heating Status", 0],
		"statusdhwtankdesinfection": [6, 1, 'UINT16', "DHW Tank Desinfection Status", 0],
		"statussilentmode":  [7, 1, 'UINT16', "SilentMode Status", 0],
		"statuscooling":     [8, 1, 'UINT16', "Cooling Status", 0],
		"statussolarpump":   [9, 1, 'UINT16', "Solarpump Status", 0],
		"statusbackupheater1": [10, 1, 'UINT16', "Backup Heater Step 1 Status", 0],
		"statusbackupheater2": [11, 1, 'UINT16', "Backup Heater Step 2", 0],
		"statusdhwboostheater": [12, 1, 'UINT16', "DHW Boost Heater Status", 0],
		"statuserror":       [13, 1, 'UINT16', "Error Status", 0],
		"statusemergency":   [14, 1, 'UINT16', "Emergency Operation Available Status", 0],
		"statusdhwemergency":[15, 1, 'UINT16', "Emergency DHW Operation Available Status", 0],
		"statusmixpump":     [16, 1, 'UINT16', "MixPump Status", 0]
	};

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

	private isValid(m?: Measurement): m is Measurement {
		return !!m && m.value !== 'xxx';
	}
// -----------------------------------------------------------------------------------------


    async processResult(result: Record<string, Measurement>) {
		if (!result) return;

		// State needed by the thermostat logic (kept per device)
		if (this.isValid(result.enableheatingcooling)) this.enableHeatingCooling = Number(result.enableheatingcooling.value);
		if (this.isValid(result.shiftvalue1)) this.shiftValue = Number(result.shiftvalue1.value);

		
        if (result) {

// Show result
// disabled logging 
//            for (let k in result) {
//
//                console.log(k, result[k].value, result[k].scale, result[k].label)
//            }

            if (result['temptarget1'] && result['temptarget1'].value != 'xxx') {
				if (!this.hasCapability('target_temperature.thermostat')) {
					await this.addCapability('target_temperature.thermostat');
				}
                var temptarget1 = Number(result['temptarget1'].value) * (Math.pow(10, Number(result['temptarget1'].scale)));
				await this.setCapabilityValue('target_temperature.thermostat', Math.round(temptarget1));
            }

            if (result['temproomcircuit1'] && result['temproomcircuit1'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.thermostat')) {
					await this.addCapability('measure_temperature.thermostat');
				}
                var temproomcircuit1 = Number(result['temproomcircuit1'].value) * (Math.pow(10, Number(result['temproomcircuit1'].scale)));
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
                var tempwateroutlet = Number(result['tempwateroutlet'].value) * (Math.pow(10, Number(result['tempwateroutlet'].scale)));
				const current = this.getCapabilityValue('measure_temperature.tempwateroutlet');
				if (current !== tempwateroutlet) {
					await this.setCapabilityValue('measure_temperature.tempwateroutlet', tempwateroutlet);
				}
            }

            if (result['tempoutdoor'] && result['tempoutdoor'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.tempoutdoor')) {
					await this.addCapability('measure_temperature.tempoutdoor');
				}
				var tempoutdoor = Number(result['tempoutdoor'].value) * (Math.pow(10, Number(result['tempoutdoor'].scale)));
				const current = this.getCapabilityValue('measure_temperature.tempoutdoor');
				if (current !== tempoutdoor) {
					await this.setCapabilityValue('measure_temperature.tempoutdoor', tempoutdoor);
				}
            }

            if (result['temppipein'] && result['temppipein'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.temppipein')) {
					await this.addCapability('measure_temperature.temppipein');
				}
                var temppipein = Number(result['temppipein'].value) * (Math.pow(10, Number(result['temppipein'].scale)));
				const current = this.getCapabilityValue('measure_temperature.temppipein');
				if (current !== temppipein) {
					await this.setCapabilityValue('measure_temperature.temppipein', temppipein);
				}
            }

          if (result['tempsuction'] && result['tempsuction'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.tempsuction')) {
					await this.addCapability('measure_temperature.tempsuction');
				}
                var tempsuction = Number(result['tempsuction'].value) * (Math.pow(10, Number(result['tempsuction'].scale)));
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
                var temphex = Number(result['temphex'].value) * (Math.pow(10, Number(result['temphex'].scale)));
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
                var waterflowrate = Number(result['waterflowrate'].value) * (Math.pow(10, Number(result['waterflowrate'].scale)));
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
                var freqinverter = Number(result['freqinverter'].value) * (Math.pow(10, Number(result['freqinverter'].scale)));
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
                var pressurehigh = Number(result['pressurehigh'].value) * (Math.pow(10, Number(result['pressurehigh'].scale)));
                await this.setCapabilityValue('measure_pressure.pressurehigh', pressurehigh);
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
                var pressurelow = Number(result['pressurelow'].value) * (Math.pow(10, Number(result['pressurelow'].scale)));
                await this.setCapabilityValue('measure_pressure.pressurelow', pressurelow);
            }

// Water Pressure
           if (result['waterpressure'] && result['waterpressure'].value != 'xxx' && Number(result['waterpressure'].value) != 0) {
				if (!this.hasCapability('measure_pressure.waterpressure')) {
					await this.addCapability('measure_pressure.waterpressure');
				}
                var waterpressure = Number(result['waterpressure'].value) * (Math.pow(10, Number(result['waterpressure'].scale)));
                await this.setCapabilityValue('measure_pressure.waterpressure', waterpressure);
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
                var dischargetemp = Number(result['dischargetemp'].value) * (Math.pow(10, Number(result['dischargetemp'].scale)));
                await this.setCapabilityValue('measure_temperature.dischargetemp', dischargetemp);
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
			await this.setCapabilityValue('thermostat_mode.thermostat', mode);

		}

// Defrost Status
            if (result['statusdefrost'] && result['statusdefrost'].value != 'xxx') {
				if (!this.hasCapability('alarm_cold')) {
					await this.addCapability('alarm_cold');
				}
                var statusdefrost = false;
				if ((Number(result['statusdefrost'].value)) == 1) {
					statusdefrost = true
					}
                await this.setCapabilityValue('alarm_cold', statusdefrost);
            }

// Error Code
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

        }
    }
}
