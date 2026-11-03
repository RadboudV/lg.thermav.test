import * as Modbus from 'jsmodbus';
import type { RegDef } from './registers';

export interface Measurement {
    value: string;
    scale: string;
    label: string;
}

type Client = InstanceType<typeof Modbus.client.TCP>;
type Kind = 'input' | 'holding' | 'coil' | 'discrete';

interface Block {
    start: number;
    count: number;                       // registers (or bits) to read
    items: Array<[string, RegDef]>;
}

// Modbus limits per request: 125 registers, 2000 bits. Stay well below; some gateways are stricter.
const MAX_REGS_PER_READ = 60;
const MAX_BITS_PER_READ = 200;
// Largest hole between two registers that is still read inside one block. 0 = only touch documented
// addresses (safe: an undocumented address in the middle can make the device answer "illegal data address").
const MAX_GAP = 0;

//*************************************************************************************************************//
// Group the register map into contiguous blocks: one Modbus request per block instead of one per register.
//*************************************************************************************************************//
const planCache = new WeakMap<object, Block[]>();

function buildBlocks(registers: Object, maxLen: number): Block[] {
    const cached = planCache.get(registers);
    if (cached) return cached;

    const entries = (Object.entries(registers) as Array<[string, RegDef]>)
        .sort((a, b) => a[1][0] - b[1][0]);
    const blocks: Block[] = [];
    let cur: Block | null = null;

    for (const entry of entries) {
        const [addr, len] = entry[1];
        const end = addr + len;
        if (cur && addr <= cur.start + cur.count + MAX_GAP && end - cur.start <= maxLen) {
            cur.count = Math.max(cur.count, end - cur.start);
            cur.items.push(entry);
        } else {
            cur = { start: addr, count: len, items: [entry] };
            blocks.push(cur);
        }
    }
    planCache.set(registers, blocks);
    return blocks;
}

//*************************************************************************************************************//
// Decoding. `words` / `bits` cover the whole block; every item picks its own slice out of it.
//*************************************************************************************************************//
function decodeWords(type: string, w: number[]): string | undefined {
    switch (type) {
        case 'UINT16': return String(w[0]);
        case 'INT16':  return String(w[0] > 0x7fff ? w[0] - 0x10000 : w[0]);
        case 'UINT32': return String(w[0] * 65536 + w[1]);                        // high word first
        case 'INT32': { const v = w[0] * 65536 + w[1]; return String(v > 0x7fffffff ? v - 0x100000000 : v); }
        default: return undefined;
    }
}

// Modbus packs bits LSB-first into bytes; don't depend on how the library chooses to expose them.
function unpackBits(buf: Buffer, count: number): number[] {
    const bits: number[] = [];
    for (let i = 0; i < count; i++) bits.push((buf[i >> 3] >> (i & 7)) & 1);
    return bits;
}

function toMeasurement(def: RegDef, value: string): Measurement {
    return { value, scale: String(def[4]), label: def[3] };
}

async function readRaw(kind: Kind, client: Client, start: number, count: number): Promise<number[]> {
    switch (kind) {
        case 'input':    return (await client.readInputRegisters(start, count)).response.body.valuesAsArray as number[];
        case 'holding':  return (await client.readHoldingRegisters(start, count)).response.body.valuesAsArray as number[];
        case 'coil':     return unpackBits((await client.readCoils(start, count)).response.body.valuesAsBuffer, count);
        case 'discrete': return unpackBits((await client.readDiscreteInputs(start, count)).response.body.valuesAsBuffer, count);
    }
}

// Read one block; on failure fall back to single reads so one bad address does not take out its neighbours.
async function readBlock(kind: Kind, client: Client, block: Block, result: Record<string, Measurement>) {
    const isBit = kind === 'coil' || kind === 'discrete';
    let raw: number[] | undefined;
    try {
        raw = await readRaw(kind, client, block.start, block.count);
    } catch (err) {
        // A timeout / closed socket means the link is dead: fall back would only repeat the timeouts.
        if (!isModbusException(err)) throw err;
        console.log(`${kind} block ${block.start}+${block.count} rejected, reading individually`);
    }

    for (const [key, def] of block.items) {
        try {
            const words = raw
                ? raw.slice(def[0] - block.start, def[0] - block.start + def[1])
                : await readRaw(kind, client, def[0], def[1]);
            // Bit registers are always reported as 0/1 whatever type the map says.
            const value = isBit ? String(words[0]) : decodeWords(def[2], words);
            if (value === undefined || words[0] === undefined) {
                console.log(`${key}: cannot decode type ${def[2]}`);
                continue;
            }
            result[key] = toMeasurement(def, value);
        } catch (err) {
            if (!isModbusException(err)) throw err;
            console.log(`${kind} ${key} (${def[3]}) failed: ${(err as any)?.message ?? err}`);
        }
    }
}

// jsmodbus rejects transport problems with { err: 'Timeout' | 'Offline' | 'OutOfSync' | 'ManualCancel' |
// 'crcMismatch', message }. Anything else is treated as a device-level answer (e.g. "illegal data address").
const TRANSPORT_ERRORS = ['Timeout', 'Offline', 'OutOfSync', 'ManualCancel', 'crcMismatch'];
export function isModbusException(err: any): boolean {
    return !(err instanceof Error) && !TRANSPORT_ERRORS.includes(err?.err);
}

async function readAll(kind: Kind, registers: Object, client: Client, maxLen: number) {
    const result: Record<string, Measurement> = {};
    for (const block of buildBlocks(registers, maxLen)) {
        await readBlock(kind, client, block, result);
    }
    return result;
}

//*************************************************************************************************************//
// Public API (unchanged signatures)
//*************************************************************************************************************//
export const checkInputRegister    = (registers: Object, client: Client) => readAll('input',    registers, client, MAX_REGS_PER_READ);
export const checkHoldingRegister  = (registers: Object, client: Client) => readAll('holding',  registers, client, MAX_REGS_PER_READ);
export const checkCoilRegister     = (registers: Object, client: Client) => readAll('coil',     registers, client, MAX_BITS_PER_READ);
export const checkDiscreteRegister = (registers: Object, client: Client) => readAll('discrete', registers, client, MAX_BITS_PER_READ);

//*************************************************************************************************************//
// Writes (kept as-is; they are single-register by nature)
//*************************************************************************************************************//
export async function checkWriteHoldingRegister(registers: Object, client: Client) {
    for (const [key, value] of Object.entries(registers)) {
        try { await client.writeSingleRegister(value[0], value[1]); }
        catch (err) { console.log("checkWriteHoldingRegister: Error with key: " + key); }
    }
    return {} as Record<string, Measurement>;
}

export async function checkWriteCoilRegister(registers: Object, client: Client) {
    for (const [key, value] of Object.entries(registers)) {
        try { await client.writeSingleCoil(value[0], value[1]); }
        catch (err) { console.log("checkWriteCoilRegister: Error with key: " + key); }
    }
    return {} as Record<string, Measurement>;
}
