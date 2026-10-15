'use strict';
/**
 * What the keys of the telemetry upload mean. Two kinds of evidence, kept apart in `evidence`:
 *   ha  compared against Home Assistant (Modbus) on three Venus D running control firmware 151:
 *       exact counters, exact steps (see tools/decode.py)
 *   fw  read from the firmware code (VNSD Control 151): the upload is one sprintf; every argument
 *       is a copy of a named live variable. That gives the meaning, not always the unit.
 * Where the firmware gave a meaning but no unit, scale is 1 and the unit is empty: a later edit
 * in the interface fixes it without touching the stored values.
 * Keys sent only by some firmware versions (compared across the decompiled control firmwares):
 *   p_sta, p_pow   control 151 only (v150 does not send them)
 *   pv, sk, mv, me, ma, fu   not sent by VNSE3 (the E3 has no such MPPT/pack block)
 *
 * [key, name, unit, scale, category, fmt, evidence, description]
 */
const H = (key, name, unit, scale, cat, description = '') => [key, name, unit, scale, cat, 'dec', 'ha', description];
const F = (key, name, unit, scale, cat, description = '', fmt = 'dec') => [key, name, unit, scale, cat, fmt, 'fw', description];

const packs = [0, 1, 2, 3, 4, 5];
const SEED = [
  // --- firmware ---
  H('dn', 'Control firmware', '', 1, 'firmware', 'Control (EMS) firmware version, e.g. 151.'),
  H('bm', 'BMS firmware', '', 1, 'firmware'),
  H('iv', 'Inverter firmware', '', 1, 'firmware', 'Inverter (VNS) software version.'),
  H('mv', 'MPPT firmware', '', 1, 'firmware', 'Not sent by VNSE3.'),
  ...packs.map((n) => F(`sk[${10 + n}]`, `Pack ${n + 1} BMS firmware`, '', 1, 'firmware', 'Per-pack BMS version.')),
  // --- power ---
  H('pb', 'Battery power', 'W', 1, 'power', 'Battery voltage times current; negative means discharging.'),
  H('go', 'AC / grid power', 'W', 1, 'power'),
  F('gp', 'Off-grid power', 'W', 1, 'power', 'Off-grid (backup output) sample power.'),
  H('mc', 'Max charge power', 'W', 1, 'power'),
  H('md', 'Max discharge power', 'W', 1, 'power'),
  F('pw', 'Inverter power command', 'W', 1, 'power', 'Power the control asks the inverter for.'),
  F('im[6]', 'Inverter power command (again)', 'W', 1, 'power', 'Same value as pw.'),
  F('im[9]', 'MPPT power', 'W', 1, 'power'),
  F('bt_p[0]', 'Pack 1 charge power', 'W', 1, 'power'),
  F('bt_p[1]', 'Pack 1 discharge power', 'W', 1, 'power'),
  F('cp[0]', 'CT power, phase 1', 'W', 1, 'power', 'Current-transformer (meter) power per phase.'),
  F('cp[1]', 'CT power, phase 2', 'W', 1, 'power'),
  F('cp[2]', 'CT power, phase 3', 'W', 1, 'power'),
  F('cp[3]', 'CT power, total', 'W', 1, 'power'),
  F('p_pow', 'Power clamp power', 'W', 1, 'power', 'Sent from control 151 on.'),
  // --- energy ---
  H('to', 'Charge energy, total', 'kWh', 0.01, 'energy'),
  H('td', 'Discharge energy, total', 'kWh', 0.01, 'energy'),
  H('em', 'Charge energy, this month', 'kWh', 0.01, 'energy'),
  H('gm', 'Discharge energy, this month', 'kWh', 0.01, 'energy'),
  H('ed', 'Charge energy, today', 'kWh', 0.01, 'energy'),
  H('gd', 'Discharge energy, today', 'kWh', 0.01, 'energy'),
  H('bp', 'Stored energy', 'kWh', 0.01, 'energy', 'State of charge times the pack energy.'),
  F('bkd[0]', 'Grid import, today', 'Wh', 1, 'energy', 'Energy bought from the grid (meter), day.'),
  F('bkd[1]', 'Grid import, this month', 'Wh', 1, 'energy'),
  F('bkd[2]', 'Grid import, total', 'Wh', 1, 'energy'),
  F('bke', 'Grid import, this month (control 147)', 'Wh', 1, 'energy', 'Control 147 sends a single monthly grid import value here; later versions send bke[0..2] (export day, month, total).'),
  F('bke[0]', 'Grid export, today', 'Wh', 1, 'energy', 'Energy sold to the grid (meter), day.'),
  F('bke[1]', 'Grid export, this month', 'Wh', 1, 'energy'),
  F('bke[2]', 'Grid export, total', 'Wh', 1, 'energy'),
  F('pv[16]', 'PV energy, today', 'Wh', 10, 'energy', 'Raw unit is 10 Wh. Not sent by VNSE3.'),
  F('pv[17]', 'PV energy, this month', 'Wh', 10, 'energy', 'Raw unit is 10 Wh. Not sent by VNSE3.'),
  // --- battery (state of charge, voltage, current) and BMS (limits, packs, cells) ---
  H('sc', 'State of charge', '%', 1, 'battery'),
  H('bv', 'Battery voltage', 'V', 0.01, 'battery'),
  H('bi', 'Battery current', 'A', 0.1, 'battery'),
  H('ci', 'BMS charge current limit', 'A', 0.1, 'bms'),
  H('ri', 'BMS discharge current limit', 'A', 0.1, 'bms'),
  F('ds', 'Discharge cut-off SoC', '%', 1, 'battery', 'Discharge cut-off state of charge (12 on a device with the default depth of discharge of 88 %).'),
  F('soh', 'Pack 1 state of health', '%', 1, 'bms', 'Often 0: the BMS does not report it.'),
  F('sk[0]', 'Working battery pack index', '', 1, 'bms'),
  F('sk[1]', 'Force charge flag', '', 1, 'bms'),
  H('sk[2]', 'BMS pack count', '', 1, 'bms'),
  H('sk[3]', 'BMS packs online (mask)', '', 1, 'bms'),
  ...packs.flatMap((n) => [
    F(`vc[${4 * n}]`, `Pack ${n + 1} max cell index`, '', 1, 'bms', 'Which cell has the highest voltage.'),
    F(`vc[${4 * n + 1}]`, `Pack ${n + 1} min cell index`, '', 1, 'bms', 'Which cell has the lowest voltage.'),
    H(`vc[${4 * n + 2}]`, `Pack ${n + 1} max cell voltage`, 'V', 0.001, 'bms'),
    H(`vc[${4 * n + 3}]`, `Pack ${n + 1} min cell voltage`, 'V', 0.001, 'bms'),
  ]),
  // --- temperature ---
  H('t1', 'Temperature 1 (internal)', '°C', 0.1, 'temperature'),
  H('t2', 'Temperature 2 (MOS)', '°C', 0.1, 'temperature'),
  ...[0, 1, 2, 3].map((i) => H(`tc[${i}]`, `Pack 1 NTC temperature ${i + 1}`, '°C', 0.1, 'temperature', 'Cell temperature sensors of pack 1.')),
  // --- grid and meter ---
  H('gv', 'Grid voltage', 'V', 0.1, 'grid'),
  H('gf', 'Grid frequency', 'Hz', 0.1, 'grid'),
  F('ct', 'Meter data valid', '', 1, 'grid'),
  F('mt', 'Meter data fresh', '', 1, 'grid'),
  F('ty', 'Meter source type', '', 1, 'grid'),
  F('cy', 'Meter source type (again)', '', 1, 'grid'),
  F('fu[0]', 'Surplus feed-in enable', '', 1, 'grid', 'Not sent by VNSE3.'),
  F('fu[1]', 'Surplus feed-in enabled', '', 1, 'grid', 'Not sent by VNSE3.'),
  // --- solar / MPPT ---
  ...[0, 1, 2, 3].flatMap((i) => [
    F(`pv[${4 * i}]`, `PV${i + 1} voltage`, 'V', 0.1, 'pv', 'In 0.1 V (an idle input reads 99, that is 9.9 V; the firmware calls an input present above 14 V). Not sent by VNSE3.'),
    F(`pv[${4 * i + 1}]`, `PV${i + 1} current`, 'A', 0.1, 'pv', 'Unit and scale from the Modbus register of the same variable (mppt current, 0.1 A); no PV production in the logs yet. Not sent by VNSE3.'),
    F(`pv[${4 * i + 2}]`, `PV${i + 1} power`, 'W', 0.1, 'pv', 'In 0.1 W like the Modbus register of the same variable (mppt power); the firmware sends 0 while the raw value is below 101, that is below 10.1 W. No PV production in the logs yet. Not sent by VNSE3.'),
    F(`pv[${4 * i + 3}]`, `PV${i + 1} present`, '', 1, 'pv', '1 when the voltage is above the firmware threshold. Not sent by VNSE3.'),
  ]),
  ...['A1', 'A2', 'B1', 'B2'].map((n, i) => F(`ce[${i}]`, `MPPT income value ${n}`, '', 1, 'pv', 'Raw value.')),
  F('ph', 'Active MPPT channel', '', 1, 'pv'),
  F('cw', 'MPPT operation mode', '', 1, 'pv'),
  F('im[8]', 'MPPT voltage', 'V', 0.1, 'pv', 'Named g_mpptVoltage_0p1V in the firmware.'),
  F('im[10]', 'MPPT send count', '', 1, 'pv'),
  // --- status and mode ---
  H('wm', 'Work mode byte', '', 1, 'status', '10 means RS485 control active.'),
  F('sv', 'Work mode', '', 1, 'status'),
  F('gt', 'Inverter state', '', 1, 'status'),
  F('bs', 'Power flow state', '', 1, 'status', 'Charging, discharging or idle.'),
  F('bu', 'EPS reserve enable', '', 1, 'status', 'Backup (EPS) reserve switched on.'),
  F('gy', 'Reserved (gy)', '', 1, 'status', 'Always 0 in the firmware.'),
  F('t3', 'Reserved (t3)', '', 1, 'status', 'Always 0 in the firmware.'),
  F('bl', 'BLE SDV enable', '', 1, 'status'),
  F('as', 'Economy (TOU) task state', '', 1, 'status'),
  F('p_sta', 'Power clamp state', '', 1, 'status', 'Sent from control 151 on.'),
  F('ival', 'Upload interval', 'min', 1, 'status', 'Fixed 5 in the format string.'),
  // --- errors ---
  F('eb', 'Pack 1 error bits', '', 1, 'errors', 'Hex, error words 1 and 2 of pack 1.', 'hex'),
  F('e1', 'Error codes 1+2 (64 bit)', '', 1, 'errors', 'Hex.', 'hex'),
  F('ea', 'Error code bitmask', '', 1, 'errors', 'Hex.', 'hex'),
  F('et', 'Warning code bitmask', '', 1, 'errors', 'Hex.', 'hex'),
  F('me', 'MPPT error', '', 1, 'errors', 'Hex. Not sent by VNSE3.', 'hex'),
  F('ma', 'MPPT warning', '', 1, 'errors', 'Hex. Not sent by VNSE3.', 'hex'),
  ...packs.map((n) => F(`sk[${4 + n}]`, `Pack ${n + 1} error word`, '', 1, 'errors', 'Hex, error words 1 and 2.', 'hex')),
  // --- connection ---
  H('bt', 'Bluetooth status (raw code)', '', 1, 'network', 'BLE connection state.'),
  F('ws', 'Wi-Fi RSSI', '', 1, 'network'),
  F('mq', 'Cloud link active', '', 1, 'network', 'Constant 1 in the firmware from control 149 on; control 147 sends the live MQTT-ready flag.'),
  F('up', 'API connection state', '', 1, 'network'),
  F('ap', 'Local API enabled', '', 1, 'network'),
  F('nt', 'Ethernet link active', '', 1, 'network', '1 when the CH395 Ethernet link is up.'),
  F('ms[0]', 'MQTT connected', '', 1, 'network'),
  F('ms[1]', 'MQTT VID session state', '', 1, 'network'),
  F('ms[4]', 'MQTT XID valid', '', 1, 'network'),
  F('im[0]', 'MQTT session active', '', 1, 'network'),
  F('im[1]', 'CH395 MQTT init status', '', 1, 'network'),
  F('im[2]', 'Local API UDP enabled', '', 1, 'network'),
  F('im[3]', 'CH395 UDP last receive length', '', 1, 'network'),
  F('im[4]', 'CH395 chip version', '', 1, 'network'),
  F('im[5]', 'BMS lock flag', '', 1, 'network', 'Named g_pgn1804InfoLockFlag in the firmware.'),
  F('im[7]', 'Inverter setpoint send count', '', 1, 'network'),
  // --- the device itself ---
  H('ip', 'Device IP', '', 1, 'system'),
  H('dt', 'Device clock', '', 1, 'system'),
  F('no', 'Upload number', '', 1, 'system'),
];

const CATEGORIES = ['firmware', 'power', 'energy', 'battery', 'bms', 'temperature', 'grid', 'pv', 'status', 'errors', 'network', 'system', 'other'];
const HEX = new Set(SEED.filter((r) => r[5] === 'hex').map((r) => r[0]));

/**
 * Where the code of another model or firmware feeds a key from a different variable (compared across the ten decompiled
 * control firmwares: VNSA 150/1509/151, VNSD 147/149/1492/150/151, VNSE3 150/151). All other keys read the same variable
 * with the same conversion everywhere, so the general rows apply to them.
 * [key, model, fw, name, unit, scale, category, fmt, evidence, description]
 */
const MODEL_SEED = [
  // VNSE3 sends the voltage of 16 cells of pack 1 instead of the max/min statistics of six packs
  ...Array.from({ length: 16 }, (_, i) => [`vc[${i}]`, 'VNSE3', '*', `Pack 1 cell ${i + 1} voltage`, 'V', 0.001, 'bms', 'dec', 'fw', 'Single cell voltage; the unit is assumed to be mV like the other cell voltages.']),
];

/**
 * Keys that a Modbus register of the device serves with the same value (compared by RAM address with the descriptor table
 * of control 151; the A model's table agrees). Home Assistant gets these over Modbus already, so the MQTT mode "add" leaves
 * them out even where their meaning was read from the firmware code and not compared with Home Assistant. Not in the list:
 * keys that merely share a variable with a register but carry another value (PV present, Wi-Fi RSSI, BLE state, BMS lock flag).
 */
const MODBUS = new Set([
  'sk[0]', 'gp', 'gt', 'bu', 'eb', 'e1', 'me', 'ma',
  ...[4, 5, 6, 7, 8, 9].map((i) => `sk[${i}]`), // pack error words
  ...[10, 11, 12, 13, 14, 15].map((i) => `sk[${i}]`), // pack BMS versions
  ...[0, 1, 2, 3].flatMap((i) => [`pv[${4 * i}]`, `pv[${4 * i + 1}]`, `pv[${4 * i + 2}]`]), // MPPT voltage, current, power
]);

module.exports = { SEED, MODEL_SEED, MODBUS, CATEGORIES, HEX };
