#!/usr/bin/env python3
"""
Check unit and scale of the upload keys against the Modbus register map.

Every upload argument is a copy of a firmware variable. The Modbus descriptor table of the same firmware says which register
serves that variable and with which scale and unit. Joined by the variable's RAM address, that gives a second, independent
source for unit and scale. See docs/NEW-FIRMWARE.md.

usage: fw-key-units.py --root <Dekompilate folder> --folder <Control folder> --traces <dir> --registers <register map csv>
         --column <source_ptr column> [--keydefs <keydefs.cjs>]
  <dir> holds the JSON files written by `fw-key-sources.py --json <dir>`.
Python 3 standard library; node only to read keydefs.cjs.
Per key: OK (agrees with keydefs), DIFF (does not), or what is missing (NOREG: no register serves the variable; NOVAR: the
argument is computed, no single variable).
"""
import json, re, csv, sys, os, subprocess, argparse

ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--folder", required=True)
ap.add_argument("--traces", required=True)
ap.add_argument("--registers", required=True)
ap.add_argument("--column", required=True, help="column with the RAM pointers of this firmware, e.g. source_ptr_v151")
ap.add_argument("--keydefs", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "keydefs.cjs"))
a = ap.parse_args()
T = json.load(open(os.path.join(a.traces, a.folder + ".json")))["slots"]
N = {}
for l in open(os.path.join(a.root, a.folder, "listing", "globals_and_registers.txt")):
    m = re.match(r'^([0-9a-f]{8})\s+(\S+)\s+(\S+)', l)
    if m: N[m.group(2)] = (int(m.group(1), 16), m.group(3))
R = list(csv.DictReader(open(a.registers)))
col = a.column
SEED = {s[0]: s for s in json.loads(subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).SEED))", os.path.abspath(a.keydefs)]))}
regs=[]
for r in R:
    p=r[col]
    for q in re.findall(r'0x[0-9A-Fa-f]{8}',p):
        sz=int(r['elem_size'] or 2)*max(1,int(r['count'] or 1))
        regs.append((int(q,16),sz,r))
def find(addr):
    return [r for a,sz,r in regs if a<=addr<a+sz]
def varsof(e): return re.findall(r'\bg_\w+(?:\[\w+\])?',e or '')
def factor(e):
    e=(e or '').strip()
    e=re.sub(r'\((?:u?int|uchar|ushort|short|byte|undefined\d?)\)','',e).strip()
    m=re.fullmatch(r'\(?\s*(g_\w+)\s*\)?(?:\s*/\s*(\d+))?',e)
    if m: return m.group(1), (1/int(m.group(2)) if m.group(2) else 1.0)
    return None,None
out=[]
def handle(key,expr,name=None):
    v,f=factor(expr) if expr else (name,1.0)
    if v is None: v=(varsof(expr) or [None])[0]; f=None
    ad=N.get(v) if v else None
    rr=find(ad[0]) if ad else []
    out.append((key,expr,v,f,[(r['register'],r['name'],r['einheit'],r['anzeige_faktor'],r['typ'],{'x1':1.0,'/10':0.1,'x10':10.0}.get(r['fw_scale'],1.0),next((r[k] for k in r if k.startswith('einheit_skala_')), '')) for r in rr]))
for k,v in T.items():
    e=v[0]
    if e['kind']=='scalar': handle(k,e.get('source'))
    elif e['kind']=='global': handle(k,e.get('name'),e.get('name'))
    elif e['kind']=='list':
        for i,it in enumerate(e.get('items') or []): handle(f'{k}[{i}]',it)
res={'ok':0,'conf':0,'nores':0,'noreg':0}
rows=[]
for key,expr,v,f,rr in out:
    s=SEED.get(key)
    cur=(s[2],s[3]) if s else None
    if not rr:
        res['noreg' if v else 'nores']+=1; rows.append((key,'NOREG' if v else 'NOVAR',expr,v,cur,None)); continue
    r0=rr[0]; fac=float(r0[3]) if r0[3] else None
    fm=r0[5]
    if fac is not None: fac*=fm
    der=None
    if fac is not None and f is not None: der=(r0[2], round(fac/f,6) if f else None)
    rows.append((key,'REG',expr,v,cur,(rr,der)))
for row in rows:
    key,st,expr,v,cur,rest=row
    if st!='REG': print(f"{key:10} {st:6} {str(v)[:34]:34} cur={cur}"); continue
    rr,der=rest
    flag=''
    if cur and der: flag='OK ' if (abs(cur[1]-der[1])<1e-9 and (cur[0]==der[0] or not cur[0] or not der[0])) else 'DIFF'
    print(f"{key:10} {flag:4} {str(v)[:30]:30} expr={str(expr)[:30]:30} reg={rr[0][0]}:{rr[0][1]} [{rr[0][2]}] x{rr[0][3]} -> derived={der} cur={cur}"+(('\n      '+r0[6][:150]) if flag=='DIFF' else ''))
