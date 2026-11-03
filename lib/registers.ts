// LG Therma V Modbus register map (from the LG installation manual, "Modbus gateway memory map").
// Every entry: name: [address, length, type, label, scale]
//   address  zero based Modbus address (manual number minus 10001 / 30001 / 40001, coils minus 1)
//   type     UINT16 | INT16 | UINT32 | INT32 (bit registers are always read as 0/1)
//   scale    power of ten applied to the value (-1 = 0.1 units)

export type RegDef = [address: number, length: number, type: string, label: string, scale: number];

// Holding Registers (read or write) 40001+x
export const holdingregisters: Record<string, RegDef> = {
	"operatingmode":  [0, 1, 'UINT16', "Operating Mode", 0], // 0 : Cooling / 4 : Heating / 3 : Auto
	"controlmethod":  [1, 1, 'UINT16', "Control Method", 0], // 0 : Water outlet temp. control, 1 : Water inlet temp. control, 2 : Room air control
	"temptarget1":    [2, 1, 'UINT16', "Target Temperature Circuit 1", -1],
	"temproom1":      [3, 1, 'INT16',  "Room 1 Temperature", 0],
	"shiftvalue1":    [4, 1, 'UINT16', "Shift Value Target Circuit 1", 0],
	"temptarget2":    [5, 1, 'INT16',  "Target Temperature Circuit 2", -1],
	"temproom2":      [6, 1, 'INT16',  "Room 2 Temperature", 0],
	"shiftvalue2":    [7, 1, 'UINT16', "Shift Value Target Circuit 2", 0],
	"temptargetdhw":  [8, 1, 'INT16',  "Domestic Hot Water Temperature Target", -1],
	"energystateinputhr": [9, 1, 'UINT16', "EnergyState Input", 0]
	// 0 : Not Use, 1 : Forced off (equal to TB_SG1=close / TB_SG2=open), 2 : Normal operation (equal to TB_SG1=open / TB_SG2=open), 3 : On-recommendation (equal to TB_SG1=open / TB_SG2=close),
	// 4 : On-command (equal to TB_SG1=close / TB_SG2=close), 5 : On-command step 2 (++ Energy Consumption compared to Normal), 6 : On-recommendation Step 1 (+ Energy Consumption compared to Normal),
	// 7 : Energy Saving mode (- Energy Consumption compared to Normal), 8 : Super Energy saving mode (-- Energy Consumption compared to Normal)
};

// Input Registers (only read) (30001+x)
export const inputregisters: Record<string, RegDef> = {
	"errorcode":        [0, 1, 'UINT16', "Error Code", 0],
	"oduoperationcycle":[1, 1, 'UINT16', "ODU Operation Cycle", 0], // 0 : Standby(OFF) / 1 : Cooling / 2 : Heating
	"tempwaterinlet":   [2, 1, 'INT16',  "Water Inlet Temperature", -1],
	"tempwateroutlet":  [3, 1, 'INT16',  "Water Outlet Temperature", -1],
	"tempwaterbackupheater": [4, 1, 'INT16', "Water Outlet Temperature Backup Heater", -1],
	"tempwaterDHWtank": [5, 1, 'INT16',  "DHW Tank Temperature", -1],
	"tempsolarcollector": [6, 1, 'INT16', "Solar Collector Temperature", -1],
	"temproomcircuit1": [7, 1, 'INT16',  "Room 1 Temperature", -1],
	"waterflowrate":    [8, 1, 'UINT16', "Water Flow Rate", -1],
	"waterflowtemp":    [9, 1, 'INT16',  "Water Flow Temperature", -1],
	"temproomcircuit2": [10, 1, 'INT16', "Room 2 Temperature", -1],
	"energystateinput": [11, 1, 'UINT16', "EnergyState Input", 0], // 0 : Energy state 0; 1: Energy state 1…
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
//		"productgroup":     [9997, 1, 'UINT16', "Product Group", 0],
//		"productinfo":      [9998, 1, 'UINT16', "Product Info", 0]
};

// Coil Registers (1 bit register read or write)
export const coilregisters: Record<string, RegDef> = {
	"enableheatingcooling": [0, 1, 'UINT16', "Enable Heating/Cooling", 0], // 0 : Operation OFF / 1 : Operation ON
	"enabledhw":            [1, 1, 'UINT16', "Enable Domestic Hot Water", 0], // 0 : Operation OFF / 1 : Operation ON
	"silentmode":           [2, 1, 'UINT16', "Enable Silent Mode", 0], // 0 : Silent mode OFF / 1 : Silent mode ON
	"desinfection":         [3, 1, 'UINT16', "Trigger Desinfection", 0], // 0 : Keep status / 1 : Operation start
	"emergencystop":        [4, 1, 'UINT16', "Emergency Stop", 0], // 0 : Normal operation / 1 : Emergency stop
	"emergencyoperation":   [5, 1, 'UINT16', "Emergency Operation", 0] // 0 : Keep status / 1 : Operation Start
};

// Discrete Input Registers (1 bit register only read) 10001+x
export const discreteregisters: Record<string, RegDef> = {
	"statuswaterflow":   [0, 1, 'UINT16', "Waterflow Status", 0], // 0 : Flow rate ok / 1 : Flow rate too low
	"statuswaterpump":   [1, 1, 'UINT16', "WaterPump Status", 0], // 0 : Water Pump OFF / 1 : Water Pump ON
	"statusextwaterpup": [2, 1, 'UINT16', "External Water Pump", 0], // 0 : Water Pump OFF / 1 : Water Pump ON
	"statuscompressor":  [3, 1, 'UINT16', "Compressor Status", 0], // 0 : Compressor OFF / 1 : Compressor ON
	"statusdefrost":     [4, 1, 'UINT16', "Defrost Status", 0], // 0 : Defrost OFF / 1 : Defrost ON
	"statusdhwheating":  [5, 1, 'UINT16', "DHW Heating Status", 0], // 0 : DHW inactive / 1 : DHW active
	"statusdhwtankdesinfection": [6, 1, 'UINT16', "DHW Tank Desinfection Status", 0], // 0 : Disinfection inactive / 1 : Disinfection active
	"statussilentmode":  [7, 1, 'UINT16', "SilentMode Status", 0], // 0 : Silent mode inactive / 1 : Silent mode active
	"statuscooling":     [8, 1, 'UINT16', "Cooling Status", 0], // 0 : No cooling / 1 : Cooling operation
	"statussolarpump":   [9, 1, 'UINT16', "Solarpump Status", 0], // 0 : Solar pump OFF / 1: Solar pump ON
	"statusbackupheater1": [10, 1, 'UINT16', "Backup Heater Step 1 Status", 0], // 0 : OFF / 1 : ON
	"statusbackupheater2": [11, 1, 'UINT16', "Backup Heater Step 2", 0], // 0 : OFF / 1 : ON
	"statusdhwboostheater": [12, 1, 'UINT16', "DHW Boost Heater Status", 0], // 0 : OFF / 1 : ON
	"statuserror":       [13, 1, 'UINT16', "Error Status", 0], // 0 : no error / 1 : error state
	"statusemergency":   [14, 1, 'UINT16', "Emergency Operation Available Status", 0], // 0 : Unavailable / 1 : Available
	"statusdhwemergency":[15, 1, 'UINT16', "Emergency DHW Operation Available Status", 0], // 0 : Unavailable / 1 : Available
	"statusmixpump":     [16, 1, 'UINT16', "MixPump Status", 0] // 0 : Mix pump OFF / 1 : Mix pump ON
};
