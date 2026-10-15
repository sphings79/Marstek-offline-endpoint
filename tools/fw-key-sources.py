#!/usr/bin/env python3
"""
Which live variable feeds each key of the cloud upload, per decompiled Control firmware, and how the versions differ.

The upload is one sprintf in Cloud_UploadTelemetryData. The decompiler shows only its first arguments, so the rest is
read from the assembler listing and joined to the code that fills the telemetry record (struct builder for scalars,
string formatter for the comma-separated lists). See docs/NEW-FIRMWARE.md.

usage:
  fw-key-sources.py --root <Dekompilate folder> [--ref <folder name>] [--json <dir>] [folder ...]
  (no folders given: every folder whose name contains "Control")
Python 3 standard library only. Expects the layout of the reverse-engineering project:
  <folder>/<addr>_Cloud_UploadTelemetryData.c, ..._MQTT_Telemetry_Struct_Builder.c, ..._MQTT_Telemetry_String_Formatter.c,
  <folder>/listing/0*.txt and listing/globals_and_registers.txt
"""
import re, sys, os, glob, json, argparse


def trace(ROOT, d):
    D = os.path.join(ROOT, d) + "/"
    def ls(pat):
        return [f for f in os.listdir(D) if re.search(pat, f, re.I) and f.endswith(".c")]
    up = ls(r"Cloud_UploadTelemetryData")[0]
    func_addr = up.split("_")[0]
    text = open(D + up).read()
    m = re.search(r'"(di=%s&sn=%s&to=%d(?:[^"\\]|\\.)*"(?:\s*"(?:[^"\\]|\\.)*")*)', text, re.S)
    fmt = re.sub(r'"\s*"', '', m.group(1)).strip('"')
    args = []
    for part in fmt.split('&'):
        k, v = part.split('=', 1)
        for c in re.findall(r'%[-0-9]*(?:ll|l)?[dxsu]', v): args.append((k, c))
    order = args[2:]
    slots = []; off = 0
    for k, c in order:
        if 'll' in c:
            if off % 8: off += 4
            slots.append((k, off, 8)); off += 8
        else: slots.append((k, off, 4)); off += 4
    # globals
    G = {}; N = {}
    for l in open(D + "listing/globals_and_registers.txt"):
        mm = re.match(r'^([0-9a-f]{8})\s+(\S+)', l)
        if mm: G[int(mm.group(1), 16)] = mm.group(2); N[mm.group(2)] = int(mm.group(1), 16)
    BASE = N["g_telemetryHistoryBuf"]
    # listing
    lines = []
    for f in sorted(glob.glob(D + "listing/0*.txt")): lines += open(f).read().split("\n")
    pool = {}
    for l in lines:
        mm = re.match(r'^([0-9a-f]{8})\s+([0-9a-f]+)\s+pointer(?:32)?\s+([0-9a-f]{8})', l)
        if mm: pool[int(mm.group(1), 16)] = int(mm.group(3), 16)
    start = next(i for i, l in enumerate(lines) if l.startswith(";================ FUNCTION") and f"@ {func_addr}" in l)
    ins = []
    for l in lines[start + 1:]:
        if l.startswith(";================ FUNCTION"): break
        mm = re.match(r'^([0-9a-f]{8})\s+([0-9a-f]{4,8})\s+([a-z][a-z0-9.]*)\s*(.*)$', l)
        if mm and not re.search(r'(pointer|string|Terminated|Alignment|undefined|word|dword)', mm.group(3)): ins.append((int(mm.group(1), 16), mm.group(3), mm.group(4).strip()))
    sub_sp = next((int(re.search(r'#(0x[0-9a-f]+)', o).group(1), 16) for a, mn, o in ins[:6] if mn.startswith('sub') and o.startswith('sp')), None)
    PARAM1, SLOTOFF = sub_sp, sub_sp + 4
    regs = {'r0': ('param1',), 'r1': ('SLOTIDX',)}; stack = {}
    imm = lambda s: int(s.lstrip('#'), 0)
    def ops(o): return [x.strip() for x in re.split(r',(?![^\[{]*[\]}])', o)]
    def add(a, b):
        if isinstance(a, tuple) and a[0] == 'SLOT' and isinstance(b, int) and b == BASE: return ('rec', 0)
        if isinstance(b, tuple) and b[0] == 'SLOT' and isinstance(a, int) and a == BASE: return ('rec', 0)
        if isinstance(a, tuple) and a[0] == 'rec' and isinstance(b, int): return ('rec', a[1] + b)
        if isinstance(b, tuple) and b[0] == 'rec' and isinstance(a, int): return ('rec', b[1] + a)
        if isinstance(a, tuple) and a[0] == 'sp' and isinstance(b, int): return ('sp', a[1] + b)
        if isinstance(a, int) and isinstance(b, int): return a + b
        return ('?', str(a), str(b))
    def load(addr, size, sg):
        if isinstance(addr, tuple) and addr[0] == 'rec': return ('val', 'rec', addr[1], size, sg)
        if isinstance(addr, int): return ('val', 'abs', addr, size, sg)
        if isinstance(addr, tuple) and addr[0] == 'sp': return stack.get(addr[1], ('?stack', addr[1]))
        return ('?load', str(addr))
    SZ = {'ldr': (4, 0), 'ldr.w': (4, 0), 'ldrh': (2, 0), 'ldrh.w': (2, 0), 'ldrsh': (2, 1), 'ldrsh.w': (2, 1), 'ldrb': (1, 0), 'ldrb.w': (1, 0), 'ldrsb': (1, 1), 'ldrsb.w': (1, 1)}
    end_call = None
    _mm = re.search(r'FUNCTION sprintf @ ([0-9a-f]{8})', '\n'.join(lines))
    SPR = int(_mm.group(1), 16) if _mm else None
    for a, mn, o in ins:
        p = ops(o)
        if mn in ('movw', 'movs', 'mov', 'mov.w') and len(p) == 2:
            regs[p[0]] = imm(p[1]) if p[1].startswith('#') else regs.get(p[1])
        elif mn in SZ:
            sz, sg = SZ[mn]; dst = p[0]; mm = re.match(r'^\[(.*)\]$', p[1]); inner = [x.strip() for x in mm.group(1).split(',')]
            if re.match(r'^0x[0-9a-f]+$', inner[0]): regs[dst] = pool.get(int(inner[0], 16), ('?pool', inner[0])); continue
            if len(inner) > 1 and not inner[1].startswith('#'): regs[dst] = ('?regoff',); continue
            offv = imm(inner[1]) if len(inner) > 1 else 0
            if inner[0] == 'sp':
                v = stack.get(offv, ('?stack', offv))
                if offv == SLOTOFF: v = ('SLOTIDX',)
                if offv == PARAM1: v = ('param1',)
                regs[dst] = v
            else:
                base = regs.get(inner[0])
                regs[dst] = load(add(base, offv), sz, sg) if not (isinstance(base, tuple) and base[0] == 'SLOTIDX') else ('?',)
        elif mn == 'muls':
            x, y = regs.get(p[0]), regs.get(p[-1])
            regs[p[0]] = ('SLOT',) if ((x == ('SLOTIDX',) and isinstance(y, int)) or (y == ('SLOTIDX',) and isinstance(x, int))) else ('?mul', str(x), str(y))
        elif mn in ('add', 'adds', 'addw', 'add.w'):
            dst, s1, s2 = (p[0], p[0], p[1]) if len(p) == 2 else p
            if s1 == 'sp': regs[dst] = ('sp', imm(s2)); continue
            regs[dst] = add(regs.get(s1), imm(s2) if s2.startswith('#') else regs.get(s2))
        elif mn == 'subs' and len(p) == 2: regs[p[0]] = regs[p[0]] - imm(p[1]) if isinstance(regs.get(p[0]), int) else ('?',)
        elif mn == 'adr': regs[p[0]] = ('str', p[1])
        elif mn == 'str':
            mm = re.match(r'^\[sp,\s*#(0x[0-9a-f]+|\d+)\]$', p[1])
            if mm: stack[imm(mm.group(1))] = regs.get(p[0])
            elif p[1] == '[sp]': stack[0] = regs.get(p[0])
        elif mn == 'strd':
            mm = re.match(r'^\[sp,\s*#(0x[0-9a-f]+|\d+)\]$', p[2]); o2 = imm(mm.group(1)) if mm else 0
            stack[o2] = regs.get(p[0]); stack[o2 + 4] = regs.get(p[1])
        elif mn in ('stmia', 'stm', 'stm.w', 'stmia.w'):
            b0 = p[0].rstrip('!'); l2 = [x.strip() for x in p[1].strip('{}').split(',')]; bv = ('sp', 0) if b0 == 'sp' else regs.get(b0)
            if isinstance(bv, tuple) and bv[0] == 'sp':
                for i, r in enumerate(l2): stack[bv[1] + 4 * i] = regs.get(r)
                if b0 != 'sp': regs[b0] = ('sp', bv[1] + 4 * len(l2))
        elif mn == 'bl':
            tgt = p[0].lstrip('0x') if p else ''
            if end_call is None and SPR and int(p[0], 16) == SPR: end_call = dict(stack)
            elif len(stack) > 40 and end_call is None and not SPR: end_call = dict(stack)
            regs['r0'] = ('ret',)
    stack = end_call or stack
    # struct mapping: record payload starts at rec+0xc = g_telemetryWorkState
    S0 = N.get("g_telemetryWorkState")
    def struct_addr(recoff): return S0 + (recoff - 0xc)
    def read(pat):
        fs = ls(pat); return open(D + fs[0]).read() if fs else ""
    def lhs_addr(lhs):
        mm = re.match(r'^[a-zA-Z]*Ram([0-9a-f]{8})$', lhs)
        if mm: return int(mm.group(1), 16)
        return N.get(lhs)
    B = read(r"MQTT_Telemetry_Struct_Builder")
    assign = {}
    for mm in re.finditer(r'^\s*(\w+)\s*=\s*(.+?);\s*$', B, re.M):
        ad = lhs_addr(mm.group(1))
        if ad is not None: assign[ad] = mm.group(2).strip()
    F = read(r"MQTT_Telemetry_String_Formatter")
    fmtstmt = {}
    for mm in re.finditer(r'snprintf\(\(?(?:char \*\))?&?(\w+)\s*,\s*(?:0x[0-9a-f]+|\d+)\s*,\s*((?:"[^"]*"\s*)+),(.*?)\);', F, re.S):
        ad = lhs_addr(mm.group(1))
        if ad is None:
            m2 = re.match(r'^DAT_([0-9a-f]{8})$', mm.group(1)); ad = int(m2.group(1), 16) if m2 else None
        if ad is not None:
            fmtstmt[ad] = (re.sub(r'"\s*"', '', mm.group(2)).strip('"'), [re.sub(r'\s+', ' ', x.strip()) for x in re.split(r',(?![^()]*\))', mm.group(3))])
    def name_of(v):
        if v is None: return {"kind": "none"}
        if isinstance(v, tuple):
            if v[0] == 'val':
                kind, o, sz, sg = v[1], v[2], v[3], v[4]
                if kind == 'rec':
                    sa = struct_addr(o)
                    return {"kind": "scalar", "rec": o, "recName": G.get(BASE + o), "structAddr": hex(sa), "source": assign.get(sa), "width": sz * 8, "signed": bool(sg)}
                return {"kind": "global", "addr": o, "name": G.get(o), "width": sz * 8, "signed": bool(sg)}
            if v[0] == 'rec':
                sa = struct_addr(v[1]); st = fmtstmt.get(sa)
                return {"kind": "list", "rec": v[1], "structAddr": hex(sa), "format": st[0] if st else None, "items": st[1] if st else None}
            if v[0] == 'param1': return {"kind": "param"}
            if v[0] == 'sp': return {"kind": "stack-address"}
            return {"kind": "unresolved", "detail": str(v)}
        if isinstance(v, int): return {"kind": "const", "value": v}
        return {"kind": "unresolved", "detail": str(v)}
    out = {"dir": d, "function": func_addr, "base": hex(BASE), "keys": [k for k, c in args], "nkeys": len(args), "slots": {}}
    for k, o, sz in slots: out["slots"].setdefault(k, []).append(name_of(stack.get(o)))

    return out


def norm(s):
    """Strip what differs only by decompiler naming: casts and local variable names."""
    s = re.sub(r"\((?:u?int|uchar|ushort|short|byte|undefined\d?|ulonglong|longlong)\)", "", str(s))
    s = re.sub(r"\b(?:uVar|iVar|bVar|local_\w+|puVar|sVar)\w*", "<local>", s)
    s = re.sub(r"\b_(g_)", r"\1", s)
    s = {"'\\0'": "0", "'\\x01'": "1"}.get(s.strip(), s)
    return s.strip()


def sig(e):
    if not e:
        return None
    e = e[0]
    k = e["kind"]
    if k == "scalar":
        return f"{norm(e.get('source') or 'NOSRC')}|{e['width']}{'s' if e['signed'] else 'u'}"
    if k == "global":
        return f"{e['name'] or hex(e['addr'])}|{e['width']}{'s' if e['signed'] else 'u'}"
    if k == "list":
        return "LIST:" + "; ".join(norm(x) for x in (e.get("items") or ["NOITEMS"]))
    if k == "const":
        return f"const {e['value']}"
    return k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--ref", default=None, help="folder to compare against (default: the newest VNSD folder)")
    ap.add_argument("--json", default=None, help="write one JSON per folder here")
    ap.add_argument("folders", nargs="*")
    a = ap.parse_args()
    folders = a.folders or sorted(f for f in os.listdir(a.root) if "Control" in f and os.path.isdir(os.path.join(a.root, f)))
    ref = a.ref or next((f for f in reversed(folders) if f.startswith("VNSD")), folders[0])
    T = {}
    for f in folders:
        try:
            T[f] = trace(a.root, f)
        except Exception as e:  # keep going: one odd version must not hide the others
            print(f"!! {f}: {type(e).__name__}: {e}")
        if a.json and f in T:
            os.makedirs(a.json, exist_ok=True)
            json.dump(T[f], open(os.path.join(a.json, f + ".json"), "w"), indent=1)
    if ref not in T:
        sys.exit(f"reference {ref} could not be traced")
    print(f"reference: {ref}\n\n== keys sent")
    rk = list(dict.fromkeys(T[ref]["keys"]))
    for f, t in T.items():
        ks = list(dict.fromkeys(t["keys"]))
        print(f"{f}: {len(ks)} keys; missing: {[k for k in rk if k not in ks]}; extra: {[k for k in ks if k not in rk]}")
    print("\n== keys whose source differs from the reference (decompiler naming removed)")
    allk = list(dict.fromkeys(k for t in T.values() for k in t["slots"]))
    for k in allk:
        if k == "dn":
            continue  # literal firmware version in every build
        r = sig(T[ref]["slots"].get(k))
        diff = [(f, sig(t["slots"].get(k))) for f, t in T.items() if k in t["slots"] and sig(t["slots"][k]) != r]
        if diff:
            print(f"\n{k}  reference: {r}")
            for f, s in diff:
                print(f"   {f}: {s}")
    bad = [(f, k) for f, t in T.items() for k, v in t["slots"].items() if v[0]["kind"] in ("unresolved", "none") and k != "no"]
    if bad:
        print("\n== could not be traced (check by hand):", bad)


if __name__ == "__main__":
    main()
