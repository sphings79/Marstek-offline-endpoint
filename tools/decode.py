#!/usr/bin/env python3
"""
Decode the telemetry a Marstek Venus uploads, from the JSONL this endpoint writes.

The device posts one field, `d`, holding a URL-encoded query string of roughly
seventy short keys. Only the keys confirmed against a second source are given a
meaning here — everything else is printed raw, under "unmapped", rather than
guessed at. If you confirm one, please open a pull request.
Most keys now have a meaning: confirmed against Home Assistant (ha) or read from the firmware
code (fw), see the comment behind each entry and keydefs.cjs. A few stay unmapped: hd and the
positions of ms that the firmware sets to a constant.

Usage:
    tools/decode.py                      # newest entry of today's log
    tools/decode.py --all                # every POST in the newest file
    tools/decode.py --file data/requests-2026-08-25.jsonl
    tools/decode.py --raw                # also print keys we have no meaning for
"""

import argparse
import glob
import json
import os
import sys
from urllib.parse import parse_qsl, unquote

# key -> (label, unit, scale)
#
# Confirmed by comparing an upload against the same device read over Modbus at
# the same moment (Home Assistant), or against values the device reports
# elsewhere. Scale is what the raw integer must be multiplied by.
KNOWN = {
    "di": ("Device ID", "", None),
    "sn": ("Serial / MAC", "", None),
    "ip": ("Device IP", "", None),
    "dt": ("Device clock", "", None),
    "wm": ("Work mode byte", "", None),        # 10 = 0x0A = RS485 control active
    "sc": ("State of charge", "%", 1),
    "pb": ("Battery power", "W", 1),
    "bv": ("Battery voltage", "V", 0.01),
    "bi": ("Battery current", "A", 0.1),
    "go": ("AC / grid power", "W", 1),
    "gv": ("Grid voltage", "V", 0.1),
    "gf": ("Grid frequency", "Hz", 0.1),
    "mc": ("Max charge power", "W", 1),
    "md": ("Max discharge power", "W", 1),
    "t1": ("Temperature 1 (internal)", "°C", 0.1),
    "t2": ("Temperature 2 (MOS)", "°C", 0.1),
    "dn": ("Control firmware", "", None),
    "bm": ("BMS firmware", "", None),
    "iv": ("Inverter firmware", "", None),
    "mv": ("MPPT firmware", "", None),
    # --- generated from keydefs.cjs (evidence: ha = checked against Home Assistant, fw = read from the firmware code, VNSD control 151) ---
    "gp": ('Off-grid power', 'W', None),  # fw
    "pw": ('Inverter power command', 'W', None),  # fw
    "p_pow": ('Power clamp power', 'W', None),  # fw
    "to": ('Charge energy, total', 'kWh', 0.01),  # ha
    "td": ('Discharge energy, total', 'kWh', 0.01),  # ha
    "em": ('Charge energy, this month', 'kWh', 0.01),  # ha
    "gm": ('Discharge energy, this month', 'kWh', 0.01),  # ha
    "ed": ('Charge energy, today', 'kWh', 0.01),  # ha
    "gd": ('Discharge energy, today', 'kWh', 0.01),  # ha
    "bp": ('Stored energy', 'kWh', 0.01),  # ha
    "ci": ('BMS charge current limit', 'A', 0.1),  # ha
    "ri": ('BMS discharge current limit', 'A', 0.1),  # ha
    "ds": ('Discharge cut-off SoC', '', None),  # fw
    "soh": ('Pack 1 state of health', '%', None),  # fw
    "ct": ('Meter data valid', '', None),  # fw
    "mt": ('Meter data fresh', '', None),  # fw
    "ty": ('Meter source type', '', None),  # fw
    "cy": ('Meter source type (again)', '', None),  # fw
    "ph": ('Active MPPT channel', '', None),  # fw
    "cw": ('MPPT operation mode', '', None),  # fw
    "sv": ('Work mode', '', None),  # fw
    "gt": ('Inverter state', '', None),  # fw
    "bs": ('Power flow state', '', None),  # fw
    "bu": ('EPS reserve enable', '', None),  # fw
    "gy": ('Reserved (gy)', '', None),  # fw
    "t3": ('Reserved (t3)', '', None),  # fw
    "bl": ('BLE SDV enable', '', None),  # fw
    "as": ('Economy (TOU) task state', '', None),  # fw
    "p_sta": ('Power clamp state', '', None),  # fw
    "ival": ('Upload interval', 'min', None),  # fw
    "eb": ('Pack 1 error bits (hex)', '', None),  # fw
    "e1": ('Error codes 1+2 (64 bit) (hex)', '', None),  # fw
    "ea": ('Error code bitmask (hex)', '', None),  # fw
    "et": ('Warning code bitmask (hex)', '', None),  # fw
    "me": ('MPPT error (hex)', '', None),  # fw
    "ma": ('MPPT warning (hex)', '', None),  # fw
    "bt": ('Bluetooth status (raw code)', '', None),  # ha
    "ws": ('Wi-Fi RSSI', '', None),  # fw
    "mq": ('Cloud link active', '', None),  # fw
    "up": ('API connection state', '', None),  # fw
    "ap": ('Local API enabled', '', None),  # fw
    "nt": ('Ethernet link active', '', None),  # fw
    "no": ('Upload number', '', None),  # fw
}

# Comma-separated lists whose element meaning is confirmed, but not the layout.
KNOWN_LISTS = {}

# Lists with one meaning per position: key -> {index: (label, unit, scale)}. Generated from keydefs.cjs.
KNOWN_POSITIONS = {
    "bkd": {
        0: ('Grid import, today', 'Wh', None),
        1: ('Grid import, this month', 'Wh', None),
        2: ('Grid import, total', 'Wh', None),
    },
    "bke": {
        0: ('Grid export, today', 'Wh', None),
        1: ('Grid export, this month', 'Wh', None),
        2: ('Grid export, total', 'Wh', None),
    },
    "bt_p": {
        0: ('Pack 1 charge power', 'W', None),
        1: ('Pack 1 discharge power', 'W', None),
    },
    "ce": {
        0: ('MPPT income value A1', '', None),
        1: ('MPPT income value A2', '', None),
        2: ('MPPT income value B1', '', None),
        3: ('MPPT income value B2', '', None),
    },
    "cp": {
        0: ('CT power, phase 1', 'W', None),
        1: ('CT power, phase 2', 'W', None),
        2: ('CT power, phase 3', 'W', None),
        3: ('CT power, total', 'W', None),
    },
    "fu": {
        0: ('Surplus feed-in enable', '', None),
        1: ('Surplus feed-in enabled', '', None),
    },
    "im": {
        0: ('MQTT session active', '', None),
        1: ('CH395 MQTT init status', '', None),
        2: ('Local API UDP enabled', '', None),
        3: ('CH395 UDP last receive length', '', None),
        4: ('CH395 chip version', '', None),
        5: ('BMS lock flag', '', None),
        6: ('Inverter power command (again)', 'W', None),
        7: ('Inverter setpoint send count', '', None),
        8: ('MPPT voltage', 'V', 0.1),
        9: ('MPPT power', 'W', None),
        10: ('MPPT send count', '', None),
    },
    "ms": {
        0: ('MQTT connected', '', None),
        1: ('MQTT VID session state', '', None),
        4: ('MQTT XID valid', '', None),
    },
    "pv": {
        0: ('PV1 voltage', '', None),
        1: ('PV1 current', '', None),
        2: ('PV1 power', 'W', None),
        3: ('PV1 present', '', None),
        4: ('PV2 voltage', '', None),
        5: ('PV2 current', '', None),
        6: ('PV2 power', 'W', None),
        7: ('PV2 present', '', None),
        8: ('PV3 voltage', '', None),
        9: ('PV3 current', '', None),
        10: ('PV3 power', 'W', None),
        11: ('PV3 present', '', None),
        12: ('PV4 voltage', '', None),
        13: ('PV4 current', '', None),
        14: ('PV4 power', 'W', None),
        15: ('PV4 present', '', None),
        16: ('PV energy, today', 'Wh', 10),
        17: ('PV energy, this month', 'Wh', 10),
    },
    "sk": {
        0: ('Working battery pack index', '', None),
        1: ('Force charge flag', '', None),
        2: ('BMS pack count', '', None),
        3: ('BMS packs online (mask)', '', None),
        4: ('Pack 1 error word (hex)', '', None),
        5: ('Pack 2 error word (hex)', '', None),
        6: ('Pack 3 error word (hex)', '', None),
        7: ('Pack 4 error word (hex)', '', None),
        8: ('Pack 5 error word (hex)', '', None),
        9: ('Pack 6 error word (hex)', '', None),
        10: ('Pack 1 BMS firmware', '', None),
        11: ('Pack 2 BMS firmware', '', None),
        12: ('Pack 3 BMS firmware', '', None),
        13: ('Pack 4 BMS firmware', '', None),
        14: ('Pack 5 BMS firmware', '', None),
        15: ('Pack 6 BMS firmware', '', None),
    },
    "tc": {
        0: ('Pack 1 NTC temperature 1', '°C', 0.1),
        1: ('Pack 1 NTC temperature 2', '°C', 0.1),
        2: ('Pack 1 NTC temperature 3', '°C', 0.1),
        3: ('Pack 1 NTC temperature 4', '°C', 0.1),
    },
    "vc": {
        0: ('Pack 1 max cell index', '', None),
        1: ('Pack 1 min cell index', '', None),
        2: ('Pack 1 max cell voltage', 'V', 0.001),
        3: ('Pack 1 min cell voltage', 'V', 0.001),
        4: ('Pack 2 max cell index', '', None),
        5: ('Pack 2 min cell index', '', None),
        6: ('Pack 2 max cell voltage', 'V', 0.001),
        7: ('Pack 2 min cell voltage', 'V', 0.001),
        8: ('Pack 3 max cell index', '', None),
        9: ('Pack 3 min cell index', '', None),
        10: ('Pack 3 max cell voltage', 'V', 0.001),
        11: ('Pack 3 min cell voltage', 'V', 0.001),
        12: ('Pack 4 max cell index', '', None),
        13: ('Pack 4 min cell index', '', None),
        14: ('Pack 4 max cell voltage', 'V', 0.001),
        15: ('Pack 4 min cell voltage', 'V', 0.001),
        16: ('Pack 5 max cell index', '', None),
        17: ('Pack 5 min cell index', '', None),
        18: ('Pack 5 max cell voltage', 'V', 0.001),
        19: ('Pack 5 min cell voltage', 'V', 0.001),
        20: ('Pack 6 max cell index', '', None),
        21: ('Pack 6 min cell index', '', None),
        22: ('Pack 6 max cell voltage', 'V', 0.001),
        23: ('Pack 6 min cell voltage', 'V', 0.001),
    },
}

REDACT = {"di", "sn", "ip"}


def decode(blob: str) -> dict:
    return dict(parse_qsl(unquote(blob), keep_blank_values=True))


def show(fields: dict, raw: bool, redact: bool) -> None:
    used = set()

    for key, (label, unit, scale) in KNOWN.items():
        if key not in fields:
            continue
        used.add(key)
        value = fields[key]
        if redact and key in REDACT:
            value = "<redacted>"
        elif scale is not None:
            try:
                num = int(value) * scale
                value = f"{num:g} {unit}".strip()
            except ValueError:
                pass
        elif unit:
            value = f"{value} {unit}"
        print(f"  {label:<28} {key:<5} {value}")

    for key, (label, unit, scale) in KNOWN_LISTS.items():
        if key not in fields:
            continue
        used.add(key)
        try:
            vals = [f"{int(v) * scale:g}" for v in fields[key].split(",")]
            print(f"  {label:<28} {key:<5} {', '.join(vals)} {unit}")
        except ValueError:
            print(f"  {label:<28} {key:<5} {fields[key]}")

    for key, positions in KNOWN_POSITIONS.items():
        if key not in fields:
            continue
        parts = fields[key].split(",")
        for idx, (label, unit, scale) in sorted(positions.items()):
            if idx >= len(parts):
                continue
            if key == "vc" and parts[idx] == "0" and idx % 4 >= 2:
                continue  # a pack that is not there reports zero voltages
            try:
                value = f"{int(parts[idx]) * scale:g} {unit}".strip() if scale is not None else parts[idx]
            except ValueError:
                value = parts[idx]
            print(f"  {label:<28} {key}[{idx}]".ljust(40) + f" {value}")

    unmapped = {k: v for k, v in fields.items() if k not in used}
    print(f"\n  unmapped ({len(unmapped)} keys)")
    if raw:
        for k, v in sorted(unmapped.items()):
            print(f"    {k:<6} {v}")
    else:
        print(f"    {' '.join(sorted(unmapped))}")
        print("    (--raw shows their values)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="JSONL file to read (default: newest in ./data)")
    ap.add_argument("--all", action="store_true", help="every POST, not just the newest")
    ap.add_argument("--raw", action="store_true", help="show values of unmapped keys")
    ap.add_argument("--no-redact", action="store_true",
                    help="print device ID, serial and IP instead of <redacted>")
    args = ap.parse_args()

    path = args.file
    if not path:
        here = os.path.dirname(os.path.abspath(__file__))
        candidates = sorted(glob.glob(os.path.join(here, "..", "data", "requests-*.jsonl")) or glob.glob(os.path.join(os.getcwd(), "data", "requests-*.jsonl")))
        if not candidates:
            print("no data/requests-*.jsonl found — pass --file", file=sys.stderr)
            return 1
        path = candidates[-1]

    posts = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            body = rec.get("body")
            if rec.get("method") == "POST" and isinstance(body, dict) and "d" in body:
                posts.append(rec)

    if not posts:
        print(f"no telemetry uploads in {path}", file=sys.stderr)
        return 1

    for rec in posts if args.all else posts[-1:]:
        print(f"\n{rec['ts']}  {rec.get('host', '')}{rec.get('url', '')}")
        show(decode(rec["body"]["d"]), args.raw, not args.no_redact)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
