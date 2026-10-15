# Checking a new control firmware

> 🇩🇪 Deutsche Version: [NEW-FIRMWARE.de.md](NEW-FIRMWARE.de.md)

The measurements page names every key of the cloud upload. Those names were verified on a Venus D with control firmware 151
and read from the firmware code of ten decompiled versions. When a new control firmware appears, check whether it still means
the same by those keys. This takes a few minutes with the script in `tools/`.

## What the script does

The upload is one `sprintf` in `Cloud_UploadTelemetryData`. The decompiler shows only its first arguments, so
`tools/fw-key-sources.py` reads the rest from the assembler listing, joins each argument to the telemetry record and then to the
code that fills that field (the struct builder for single values, the string formatter for the comma-separated lists). The result
is, per key, the live variable it comes from, its width and its sign. It then compares every version with a reference version
and prints only what differs.

Python 3 and the standard library; nothing to install.

## Steps

1. **Decompile** the new control firmware the way the reverse-engineering project does (one folder per version with the
   `.c` files and a `listing/` folder; the folder name contains `Control`).
2. **Run the script** over all versions, against the Venus D reference:

   ```bash
   python3 tools/fw-key-sources.py --root <Dekompilate folder> --ref VNSD_Control_v151
   ```

   `--json <dir>` also writes one file per version with the raw result. Naming folders on the command line limits the run.
3. **Read the report.** It has three parts:
   - *keys sent*: the keys a version sends and the reference keys it lacks. A new key shows under *extra*.
   - *keys whose source differs*: per key the reference source and the other one. Casts, local variable names (`uVar2`) and
     `_g_` prefixes are removed, so what is left is a real difference or a variable the analyst renamed.
   - *could not be traced*: arguments the script could not follow. Check these in the listing by hand.
4. **Judge each difference.** A different name in the same place of the record with the same neighbours is usually a rename.
   A different variable, a constant instead of a variable, another width or another number of list items is a change of meaning.
5. **Carry it into the endpoint.**
   - New key: add it to `SEED` in `src/keydefs.cjs` (`F(...)` for "read from the firmware"), with a description and the versions that
     send it.
   - Same key, other meaning on a model or firmware: add a row to `MODEL_SEED` in `src/keydefs.cjs`
     (`[key, model, fw, name, unit, scale, category, fmt, evidence, description]`; `fw` `'*'` for all firmware of the model).
     Rows from the firmware code are not marked verified.
   - Keys a version no longer sends need no change.
   - Update the comment at the top of `src/keydefs.cjs`, then a web release (see `RELEASING.md`): `src/keydefs.cjs` is part of the web
     bundle, so no new image is needed.
6. **Check unit and scale against Modbus.** The upload code gives the meaning, the register map gives the unit. Every upload
   argument is a copy of a firmware variable, and the Modbus descriptor table of the same firmware says which register serves
   that variable, with which scale and unit. `tools/fw-key-units.py` joins the two by the variable's RAM address and compares the
   result with `src/keydefs.cjs`:

   ```bash
   python3 tools/fw-key-sources.py --root <Dekompilate folder> --json traces
   python3 tools/fw-key-units.py --root <Dekompilate folder> --folder VNSD_Control_v151 --traces traces \
       --registers <VNSD_Register_Map_Final_generated.csv> --column source_ptr_v151
   ```

   `OK` means the register map agrees with `src/keydefs.cjs`, `DIFF` means it does not (fix `src/keydefs.cjs` or look at the register).
   `NOREG` means no register serves the variable (cell statistics, CT power, MPPT income, internal states): unit and scale then
   rest on the upload code and on the check in step 7. `NOVAR` means the argument is computed from several variables; read the
   formatter code by hand (the PV power is such a case: the firmware sends the 0.1 W register value, or 0 below 101).
   Arguments that pass through a division (`/ 10`) are handled; other arithmetic is not.
7. **Verify on a device.** Neither script compares live data. Unit and scale of the keys without a register can only be checked
   against a device that runs the version (a Modbus value in Home Assistant is the best reference). Until then the row stays
   *from the firmware code*, not *checked*.

## Limits

- The script expects the folder layout of the reverse-engineering project and reads the first `sprintf` call whose format starts
  with `di=%s&sn=%s&to=%d`. If a version changes the structure of the upload, the script reports a failure for that folder and
  continues with the others.
- It reads Thumb-2 listings of the Cortex-M builds so far. A different compiler layout can leave single keys *unresolved*; the
  report lists them.
- Binaries without a decompilation are not covered. Decompile them first.
