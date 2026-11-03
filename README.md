# LG Therma V (Modbus)

Homey app for LG Therma V R32 heat pumps, connected through a Waveshare Modbus RTU-to-TCP converter.

## Features
- Reads input, holding, coil and discrete registers in blocks (a handful of requests per poll).
- Thermostat (setpoint / mode), silent mode, water temperatures, flow, pressures, compressor speed,
  calculated energy heat and cold output and a total generated energy meter for heat and cold.
- Flow cards to switch the heat pump off / on (auto, heat, cool) and to set silent mode.
- All the triggers you can think of.

## Setup
Add the device and enter the IP address and port of the Modbus converter and the Modbus ID of the heat pump
(default modbus ID 1, and port 502 for the modbus converter).
The polling interval (default 30 seconds) can be changed in the device settings.

## Development
```
homey app validate
npm run build
npm install
homey app run
```
## Product Detection
The information on the productgroup and productinfo is very limited (model detection). Feedback welcome.
