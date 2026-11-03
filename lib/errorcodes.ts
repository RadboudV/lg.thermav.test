// LG Therma V error codes (service manual, "Troubleshooting for Error Code").
// Add new codes here; unknown codes are still reported, as "Unknown error".
export const ERROR_CODES: Record<number, string> = {
  1: 'Problem in remote room air sensor',
  2: 'Problem in refrigerant (inlet side) sensor',
  3: 'Bad communication between remote controller and unit',
  5: 'Bad communication between Main PCB (Heater) and Main PCB (Inverter)',
  6: 'Problem in refrigerant (outlet side) sensor',
  8: 'Problem in water tank sensor',
  9: 'PCB program (EEPROM) fault',
  10: 'BLDC water pump lock',
  13: 'Problem in solar pipe sensor',
  14: 'Problem in flow switch',
  15: 'Water pipe overheated',
  16: 'Problems in sensors',
  17: 'Problem in water-inlet sensor',
  18: 'Problem in water-outlet sensor',
  19: 'Problem in electric heater outlet sensor',
  20: 'Thermal fuse is damaged',
  21: 'DC peak (IPM fault)',
  22: 'Max. C/T input over current',
  23: 'DC link high / low voltage',
  24: 'Low/high pressure switch perception error',
  26: 'DC compressor position error',
  27: 'AC input instant over current error',
  29: 'Inverter compressor over current',
  32: 'High temperature in discharge pipe of the inverter compressor',
  35: 'Low pressure error',
  41: 'Problem in D-pipe temperature sensor',
  43: 'Problem in high pressure sensor',
  44: 'Problem in outdoor air temperature sensor',
  45: 'Problem in condenser middle pipe temperature sensor',
  46: 'Problem in suction pipe temperature sensor',
  52: 'PCB communication error',
  53: 'Bad communication between Main PCB (Heater) and Main PCB (Inverter)',   // assumed: listed next to 5 in the manual
  54: 'Open and reverse phase error',
  60: 'PCB (Inverter) & Main EEPROM check sum error',
  61: 'High temperature in condenser pipe',
  62: 'Heat sink temperature high error',
  65: 'Problem in heat sink temperature sensor',
  67: 'Fan lock error',
  114: 'Problem in vapor injection inlet temperature sensor',
  115: 'Problem in vapor injection outlet temperature sensor',
};

export function errorTitle(code: number): string {
  return ERROR_CODES[code] ?? 'Unknown error';
}
