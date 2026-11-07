import { snapToThirds } from './temperature';

/** The heat pump reports this as the minimum water flow, even when there is no flow at all. */
export const MIN_FLOW_RATE = 5;

/**
 * A plain sensor: one register that is copied to one capability.
 * Sensors that need their own logic (thermostat, operating mode, alarms, DHW, circuit 2, solar, water pressure ...)
 * are not part of this table.
 */
export interface SensorDefinition {
  register: string;                              // key in the register map (lib/registers.ts)
  capability: string;                            // Homey capability id
  options?: Record<string, unknown>;             // capability options, applied when the capability is added at runtime
  transform?: (value: number) => number;         // optional conversion of the scaled register value
}

export const SENSORS: SensorDefinition[] = [
  { register: 'temproomcircuit1', capability: 'measure_temperature' },

  // Water temperatures: the sensor resolution is 1/3 K, undo the 0.1 K rounding of the register
  { register: 'tempwaterinlet',  capability: 'measure_temperature.tempwaterinlet',  transform: snapToThirds },
  { register: 'tempwateroutlet', capability: 'measure_temperature.tempwateroutlet', transform: snapToThirds },

  { register: 'tempoutdoor',  capability: 'measure_temperature.tempoutdoor' },
  { register: 'temppipein',   capability: 'measure_temperature.temppipein' },
  { register: 'tempsuction',  capability: 'measure_temperature.tempsuction' },
  {
    register: 'temphex',
    capability: 'measure_temperature.temphex',
    options: { title: { en: 'Heat Exchanger Temperature', nl: 'Temperatuur Warmtewisselaar' } },
  },

  {
    register: 'waterflowrate',
    capability: 'measure_water.waterflowrate',
    // The heat pump shuts down before the real flow reaches the reported minimum, so a reading at the minimum means 0
    transform: (flowRate) => (flowRate === MIN_FLOW_RATE ? 0 : flowRate),
  },
  { register: 'freqinverter', capability: 'measure_frequency.freqinverter' },

  {
    register: 'pressurehigh',
    capability: 'measure_pressure.pressurehigh',
    options: {
      title: { en: 'High Side Pressure', nl: 'High Side Pressure' },
      units: { en: 'bar', nl: 'bar' },
      decimals: 2,
    },
  },
  {
    register: 'pressurelow',
    capability: 'measure_pressure.pressurelow',
    options: {
      title: { en: 'Low Side Pressure', nl: 'Low Side Pressure' },
      units: { en: 'bar', nl: 'bar' },
      decimals: 2,
    },
  },
  {
    register: 'dischargetemp',
    capability: 'measure_temperature.dischargetemp',
    options: { title: { en: 'Discharge Temperature', nl: 'Discharge Temperature' } },
  },
];
