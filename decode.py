#!/usr/bin/env python3
"""
Decode the telemetry a Marstek Venus uploads, from the JSONL this endpoint writes.

The device posts one field, `d`, holding a URL-encoded query string of roughly
seventy short keys. Only the keys confirmed against a second source are given a
meaning here — everything else is printed raw, under "unmapped", rather than
guessed at. If you confirm one, please open a pull request.

Usage:
    ./decode.py                      # newest entry of today's log
    ./decode.py --all                # every POST in the newest file
    ./decode.py --file data/requests-2026-08-25.jsonl
    ./decode.py --raw                # also print keys we have no meaning for
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
}

# Comma-separated lists whose element meaning is confirmed, but not the layout.
KNOWN_LISTS = {
    "tc": ("Cell temperatures", "°C", 0.1),
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
        candidates = sorted(glob.glob(os.path.join(here, "data", "requests-*.jsonl")))
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
