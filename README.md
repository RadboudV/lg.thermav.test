# LG Therma V (Modbus)

Homey app for LG Therma V R32 heat pumps, connected through a Modbus RTU-to-TCP converter.

## Features
- Reads input, holding, coil and discrete registers in blocks (a handful of requests per poll).
- Thermostat (setpoint / mode), silent mode, water temperatures, flow, pressures, compressor speed,
  calculated heat output and a total heat meter.
- Flow cards to switch the heat pump off / on (auto, heat, cool) and to set silent mode.

## Setup
Add the device and enter the IP address and port of the Modbus converter and the Modbus ID of the heat pump
(default 1). The polling interval can be changed in the device settings.

## Development
```
npm install
npm run build
homey app run
```
