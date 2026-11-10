# LG Therma V (Modbus)

Homey app for LG Therma V R32 heat pumps, connected through a Modbus RTU-to-TCP converter.

## Features
- Reads input, holding, coil and discrete registers in blocks (a handful of requests per poll).
- **Product detection**: the connected product (for example "AWHP Monobloc") is read once when the app starts and shown in the
  device settings. It is detected again after the IP address, port or Modbus ID has been changed.
- **Thermostat** (setpoint / mode), silent mode, water inlet / outlet temperatures (1/3 K resolution), flow, pressures,
  compressor speed, calculated heat output and total heat / cold meters.
- **Domestic hot water (DHW)**: enable it with the setting "Enable Domestic Hot Water". Then the tank temperature, a DHW
  thermostat (35 to 65 °C), the DHW status indicators and "Trigger Desinfection" are available. Disabling the setting removes
  these capabilities again. The solar collector temperature is only shown with DHW enabled and a connected sensor.
- **Circuit 2**: used when the heat pump reports a target temperature for circuit 2 (not 0). Its thermostat and room
  temperature are then added, and removed again when it goes back to 0. The operating mode is shared with circuit 1.
- **Energy meter and COP** (optional): enter the IP address of an energy meter that measures the heat pump
  (`http://<address>/api/v1/data`, field `active_power_w`). This adds *Electric power* and *COP*. The COP (heat or cold produced
  divided by electric power) is only calculated while the compressor runs, otherwise it is 0. By default it is smoothed (setting *Smooth COP*): average heat output divided by average electric power of the last 5 polls. A meter for the whole house
  gives a wrong COP.
- **Defrosts today**: counts the defrost cycles of the current day and resets at midnight.
- **Errors**: the error flag (`alarm_generic`), the text capability *Current error* (for example "CH14: Problem in flow switch")
  and a Homey notification for every error and every clear.

## Flow cards
- **Triggers** for status changes (compressor, defrost, pumps, heaters, silent mode, circuit 2, DHW, solar pump, ...), operation
  cycle, energy state and faults (with the error code and description as tokens).
- **Conditions** for the same states, for the silent mode and for the error code.
- **Actions** to switch the heat pump off / on (auto, heat, cool), set silent mode, set the temperature, the DHW temperature, the
  circuit 2 temperature and the energy state.

The action *Set energy state* only has effect when the energy state input of the heat pump is set to "Use Modbus"
(installer menu, ESS use type).

## Setup
Add the device and enter the IP address and port of the Modbus converter and the Modbus ID of the heat pump
(default 1). The polling interval can be changed in the device settings.

## Development
```
npm install
npm run build
homey app run
```
