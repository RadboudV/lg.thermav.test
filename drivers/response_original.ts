import * as Modbus from 'jsmodbus';

export interface Measurement {
    value: string;
    scale: string;
    label: string;
}

//*************************************************************************************************************//
export async function checkInputRegister(registers: Object, client: InstanceType<typeof Modbus.client.TCP>) {
    let result: Record<string, Measurement> = {};

    for (const [key, value] of Object.entries(registers)) {
        try {

            const res = client.readInputRegisters(value[0], value[1])
            const actualRes = await res;
			
            // const metrics = actualRes.metrics;
            // const request = actualRes.request;
            const response = actualRes.response;
            const measurement: Measurement = {
                value: 'xxx',
                scale: value[4],
                label: value[3],
            };
            let resultValue: string = 'xxx';
            switch (value[2]) {
                case 'UINT16':
                    resultValue = response.body.valuesAsArray[0].toString();
                    // console.log(key);
                    break;
                case 'UINT32':
                    resultValue = (response.body.valuesAsArray[0] * 65536 + response.body.valuesAsArray[1]).toString();
                    // console.log(key);
                    break;
				case 'INT16':
                    resultValue = response.body.valuesAsBuffer.readInt16BE().toString();
                    break;
                default:
                    console.log(key + ": type not found " + value[2]);
                    break;
            }
            if (resultValue && resultValue !== undefined) {
                measurement.value = resultValue;
            }
            result[key] = measurement;

        } catch (err) {
            console.log("checkInputRegister: Error with key: " + key + ". Description: " + value[3]);
            // console.log(err);
        }
    }

    // console.log('checkInputRegister result');
    return result;
}
//*************************************************************************************************************//

//*************************************************************************************************************//
export async function checkHoldingRegister(registers: Object, client: InstanceType<typeof Modbus.client.TCP>) {
    let result: Record<string, Measurement> = {};

    for (const [key, value] of Object.entries(registers)) {
        try {

            const res = client.readHoldingRegisters(value[0], value[1])
            const actualRes = await res;
			
            // const metrics = actualRes.metrics;
            // const request = actualRes.request;
            const response = actualRes.response;
            const measurement: Measurement = {
                value: 'xxx',
                scale: value[4],
                label: value[3],
            };
            let resultValue: string = 'xxx';
            switch (value[2]) {
                case 'UINT16':
                    resultValue = response.body.valuesAsArray[0].toString();
                    // console.log(key);
                    break;
                case 'UINT32':
                    resultValue = (response.body.valuesAsArray[0] * 65536 + response.body.valuesAsArray[1]).toString();
                    // console.log(key);
                    break;
				case 'INT16':
                    resultValue = response.body.valuesAsBuffer.readInt16BE().toString();
                    break;
                default:
                    console.log(key + ": type not found " + value[2]);
                    break;
            }
            if (resultValue && resultValue !== undefined) {
                measurement.value = resultValue;
            }
            result[key] = measurement;

        } catch (err) {
            console.log("checkHoldingRegister: Error with key: " + key + ". Description: " + value[3]);
            // console.log(err);
        }
    }

    // console.log('checkHoldingRegister result');
    return result;
}
//*************************************************************************************************************//

//*************************************************************************************************************//
export async function checkCoilRegister(registers: Object, client: InstanceType<typeof Modbus.client.TCP>) {
    let result: Record<string, Measurement> = {};

    for (const [key, value] of Object.entries(registers)) {
        try {

            const res = client.readCoils(value[0], value[1])
            const actualRes = await res;
			
            // const metrics = actualRes.metrics;
            // const request = actualRes.request;
            const response = actualRes.response;
            const measurement: Measurement = {
                value: 'xxx',
                scale: value[4],
                label: value[3],
            };
            let resultValue: string = 'xxx';
            switch (value[2]) {
                case 'UINT16':
                    resultValue = response.body.valuesAsArray[0].toString();
                    // console.log(key);
                    break;
//                case 'UINT32':
//                    resultValue = (response.body.valuesAsArray[0]  << 16 | response.body.valuesAsArray[1]).toString();
                    // console.log(key);
                    break;
                default:
                    console.log(key + ": type not found " + value[2]);
                    break;
            }
            if (resultValue && resultValue !== undefined) {
                measurement.value = resultValue;
            }
            result[key] = measurement;

        } catch (err) {
            console.log("checkCoilRegister: Error with key: " + key + ". Description: " + value[3]);
            //console.log(err);
        }
    }

    // console.log('checkCoilRegister result');
    return result;
}
//*************************************************************************************************************//

//*************************************************************************************************************//
export async function checkDiscreteRegister(registers: Object, client: InstanceType<typeof Modbus.client.TCP>) {
    let result: Record<string, Measurement> = {};

    for (const [key, value] of Object.entries(registers)) {
        try {

            const res = client.readDiscreteInputs(value[0], value[1])
            const actualRes = await res;
			
            // const metrics = actualRes.metrics;
            // const request = actualRes.request;
            const response = actualRes.response;
            const measurement: Measurement = {
                value: 'xxx',
                scale: value[4],
                label: value[3],
            };
            let resultValue: string = 'xxx';
            switch (value[2]) {
                case 'UINT16':
                    resultValue = response.body.valuesAsArray[0].toString();
                    // console.log(key);
                    break;
//                case 'UINT32':
//                    resultValue = (response.body.valuesAsArray[0]  << 16 | response.body.valuesAsArray[1]).toString();
                    // console.log(key);
                    break;
                default:
                    console.log(key + ": type not found " + value[2]);
                    break;
            }
            if (resultValue && resultValue !== undefined) {
                measurement.value = resultValue;
            }
            result[key] = measurement;

        } catch (err) {
            console.log("checkDiscreteRegister: Error with key: " + key + ". Description: " + value[3]);
            // console.log(err);
        }
    }

    // console.log('checkDiscreteRegister result');
    return result;
}
//*************************************************************************************************************//

//*************************************************************************************************************//
export async function checkWriteHoldingRegister(registers: Object, client: InstanceType<typeof Modbus.client.TCP>) {
    let result: Record<string, Measurement> = {};

    for (const [key, value] of Object.entries(registers)) {
        try {

            const res = client.writeSingleRegister(value[0], value[1])
            const actualRes = await res;
					
            //const response = actualRes.response;
            
        } catch (err) {
            //console.log("checkWriteHoldingRegister: Error with key: " + key + " Response: " + response);
			console.log("checkWriteHoldingRegister: Error with key: " + key);
            // console.log(err);
        }
    }
    // console.log('checkWriteHoldingRegister result');
    return result;
}

export async function checkWriteCoilRegister(registers: Object, client: InstanceType<typeof Modbus.client.TCP>) {
    let result: Record<string, Measurement> = {};

    for (const [key, value] of Object.entries(registers)) {
        try {

            const res = client.writeSingleCoil(value[0], value[1])
            const actualRes = await res;
			
			//const response = actualRes.response;
            
        } catch (err) {
            //console.log("checkCoilRegister: Error with key: " + key + " Response: " + response);
			console.log("checkCoilRegister: Error with key: " + key);
            // console.log(err);
        }
    }

    // console.log('checkWriteCoilRegister result');
    return result;
}
//*************************************************************************************************************//