# How this was found

A record of the investigation, including the parts that were wrong. It is written
down because four plausible explanations survived a long time on reasoning alone,
and one cheap experiment killed all of them in ten minutes. If you are debugging
something similar, the shape of that mistake is more useful than the answer.

Everything below was measured on one device: a Marstek Venus D on Control
firmware v150, wired, 25–26 August 2026.

## What was known at the start

The dropouts were understood. `FUN_08015bd0` in the Control firmware contains:

```c
if (((1 < *(ushort *)(DAT_08015fcc + 2)) &&
     (Tick_Timer_Check_Elapsed(DAT_0801600c, 0x708) != 0)) &&
    (*_DAT_08016010 == 0)) {
    CH395_Reset_And_Reinit(0);
    log_printf(3, 1, "[HTTP]ch395 reset!!!!");
    *DAT_0801600c = 0;
}
```

`0x708` is 1800 seconds. The first term is a count of buffered telemetry records.
So: more than one record backed up, half an hour elapsed, and the firmware
power-cycles its own Ethernet bridge. Two to three seconds with no network at
all — no Modbus, not even ICMP.

The fix follows directly: answer the upload, the buffer drains, the condition is
never met. A container was built to do that, and it did answer — the log showed
uploads arriving and being accepted.

**The resets continued anyway.** Twelve of them over five and a half hours, mean
interval 1829 s, spread 43 s. Dead regular, no trend.

## Four explanations that were wrong

### 1. The time reply was malformed

It genuinely was — truncated, and in local time where the real endpoint sends
something else. Fixing it was correct and necessary.

It changed nothing. The next reset landed 34 seconds off a prediction made from
the previous interval, well inside the observed spread. The rhythm ran straight
through a full container restart, during which nothing answered at all.

### 2. The counter survives a cold start

The counter lives at `0x2000100C` in ordinary SRAM. No code path restores it from
anywhere, so a cold start must zero it.

That part was right, and the measurement showed it: after a power cycle the first
interval was **2133 s** against a steady-state 1824 s. The extra 309 seconds is
the counter climbing back over its threshold — `Tick_Timer_Check_Elapsed` latches
once elapsed, so the reset fires the moment the *last* outstanding condition
becomes true.

But it climbed back within 35 minutes and the cycle resumed. Rebooting is not a
cure.

### 3. Node's keep-alive was blocking the device

Measured against the real server file: with HTTP/1.1, Node held the connection
open and a test client sat there until its own timeout. The device speaks
HTTP/1.1. The theory fit.

Sending `Connection: close` was verified to close the socket immediately. The
bursts of four time requests continued unchanged.

### 4. The receive loop needs CR LF at the end

This one is real, and it is documented in the firmware:

```c
} while ( ( (total == 0) || (idle < 0x15) ||
            (buf[total-1] != '\n') || (buf[total-2] != '\r') )
          && !elapsed(timer, timeout) && total < maxlen );
```

`HTTPS_POST_ReceiveResponseData` (`0x08015744`) leaves early only when data has
arrived, 21 consecutive polls came back empty, **and** the last two bytes are
CR LF. A reply ending in `0` runs into the full timeout — which is exactly
`Cloud_Report_URL_Builder(1, 0x14)`, twenty seconds, and matched the observed
20-second retry spacing perfectly.

The container was changed to end its reply with CR LF, then to answer chunked the
way a raw capture of the real endpoint showed, terminating chunk and all. Byte
for byte the same shape.

**Still four retries.** Still 20 seconds apart.

## The experiment that settled it

Every one of those four had a mechanism, evidence, and a matching number. What
none of them had was a control.

So the container got a passthrough mode: forward the *time* request to the real
endpoint and return the answer verbatim, written straight onto the socket so
nothing gets re-framed. The telemetry upload stayed local throughout.

The answer arrived in one ten-minute window:

| reply | device behaviour |
|---|---|
| built locally — same body, same chunked framing | four requests, 20 s apart, then gives up |
| genuine, proxied through | **one request**, accepted |

That is the whole finding. A functionally equivalent reply is not accepted. The
difference had to be in the bytes that were *not* the body — and once both were
on the table, it was visible:

```
ours   HTTP/1.1 200 OK · Content-Type · Date · Connection · Keep-Alive · Transfer-Encoding
real   HTTP/1.1 200 OK · Date · Content-Type · Transfer-Encoding · Connection · Trace-Id
```

Node adds `Keep-Alive: timeout=5`, which the real endpoint does not send, and
orders the headers differently. **Which of those the firmware objects to is still
unknown** — the container reproduces the captured response exactly rather than
narrowing it down further.

## The upload path needed the same treatment

The upload host is a different machine behind a Kong API gateway, and it sends
seven headers the time endpoint does not: `vary`, `Access-Control-Allow-Credentials`,
two `X-Kong-*-Latency`, `Via`, `X-Kong-Request-Id`, `Strict-Transport-Security`.

Capturing that needed no telemetry — a POST with `{}` as the body is rejected
with `{"code":51,"message":"The d field is required"}`, and the framing is what
mattered.

One more thing came out of the same reading. The TLS path is read by a different
loop, `mbedTLS_SSL_Recv_WithRetry` (`0x08015914`), and it has no CR LF condition
at all. Its only early exit carrying data is `MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY`.
The real endpoint answers keep-alive and never closes, so the device waits out its
full 20-second timeout on every upload — normal, not a fault.

What is not harmless is cutting in early:

```c
if ((int)uVar1 < 1) {
    if (uVar1 == 0xffff8780) { ... }                       // close_notify: clean
    if ((uVar1 != 0xffff9700) && (uVar1 != 0xffff9780)) {
        return uVar1;        // returns the ERROR as the result, discarding the bytes
    }
}
```

The caller stores that value as a length. An earlier version of this container
destroyed the connection after six seconds, so llhttp was handed tens of thousands
of bytes out of a 3 KB buffer — a guaranteed parse failure, return code −10, and
`FUN_08015bd0` takes the error branch, **which never decrements the counter**.

## What the rigid 86-second cadence actually was

For most of a day the uploads arrived exactly 86 seconds apart, and that was read
as a retry rhythm. It is a throttle:

```c
if ((3 < count) && (Tick_Timer_Check_Elapsed(timer, 0x3c) == 0)) { state++; break; }
```

More than three records backed up and the firmware limits itself to one upload per
60 seconds. Its disappearance is the signal that the backlog has fallen below four
— which is how the fix was confirmed before the ping trace caught up.

## The result

With the corrected container in place:

- the 86-second throttle disappeared within 45 minutes,
- uploads settled to one per 300 s — the record interval, meaning one upload per
  record and an empty buffer,
- and the resets stopped. Seven hours, none, against a previous rhythm of one
  every 1824 s.

```
21:55:14           23:56:43   +1804
22:25:39   +1825   00:27:08   +1825
22:56:03   +1824   ————— corrected container —————
23:26:39   +1836   nothing for seven hours
```

## What is still not established

- **Which header the firmware objects to.** The container reproduces all of them.
- **Whether this generalises.** One device, one firmware version, wired. Reports
  from Venus E v3 owners line up, but no other build has been decompiled.
- **Whether the upload host's framing matters as much as the time host's.** The
  Kong headers were added on the reasoning that a difference which looked equally
  harmless had already proven decisive once. That is a judgement, not a
  measurement.
- **The second reset trigger.** Two dropouts after the fix came 1293 s and 1052 s
  apart — shorter than 1800 s, which this mechanism cannot produce, and one of
  them landed four minutes after a container restart. Something else can also
  reset that chip. `CH395_Reset_And_Reinit` has other callers, two of them thin
  wrappers reached through function tables Ghidra has not resolved.

## The lesson worth keeping

Four explanations, each with a real mechanism in the firmware, each with a number
that matched the measurement. All four wrong. They survived because every test of
them was a *change* — and a change that does not help tells you almost nothing,
since it might be right and insufficient.

The passthrough was different: it compared the thing under test against a known
good, with one variable. It cost an hour to build and settled in ten minutes what
a day of reasoning could not.
