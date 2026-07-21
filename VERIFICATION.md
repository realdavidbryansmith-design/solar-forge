# Verification checklist

**Read this before using SolarForge output on a permitted job.**

SolarForge is a design and takeoff aid. It is not a substitute for a licensed
electrician, a stamped engineering review, or the actual NFPA 70 code book.
This document lists exactly what has been verified, what has not, and what a
licensed professional must check before any output leaves the office.

---

## Why this document exists

NFPA 70 (the NEC) is copyrighted and paywalled. During development the code
tables and rules in this tool were transcribed from **secondary sources** —
training material, manufacturer compliance guides, trade press, AHJ handouts,
and code-education sites. Several of these sources disagreed with each other on
section numbering, and none reproduced the tables verbatim.

Rather than paper over that, the tool carries the uncertainty in the data model:
every NEC table in [`src/nec/tables.ts`](src/nec/tables.ts) has a `verification`
status, and the compliance panel shows a banner naming any table that has not
been checked against a real code book.

**Nothing here has status `verified-against-code-book`.** That status is
reserved for tables a licensed professional has checked line by line against a
purchased copy of the code. Doing that is the single highest-value contribution
anyone can make to this project.

---

## Tier 1 — must verify before any permitted use

These feed pass/fail results that affect safety.

| Item | Where | Status | What to check |
|---|---|---|---|
| Table 310.16 ampacities | `src/nec/tables.ts` | transcribed, unreviewed | Every value, Cu and Al, all three temperature columns. A wrong ampacity undersizes a conductor. |
| Table 310.15(B)(1)(1) temperature correction | `src/nec/tables.ts` | transcribed, unreviewed | All bands and factors. |
| Table 310.15(C)(1) conduit fill adjustment | `src/nec/tables.ts` | transcribed, unreviewed | Breakpoints and percentages. |
| Table 250.122 EGC sizing | `src/nec/tables.ts` | transcribed, unreviewed | All rows, Cu and Al. |
| 240.6(A) standard OCPD ratings | `src/nec/tables.ts` | transcribed, unreviewed | The full list. |
| Chapter 9 Table 8 resistances | `src/nec/tables.ts` | transcribed, unreviewed | Used for voltage drop. |
| 310.15(B)(2) rooftop temperature adder | `src/nec/tables.ts` | **unverified — do not rely** | The 2017 edition replaced the 2014 tiered table with a flat 33 °C adder plus an XHHW-2 exception. The exact height threshold and exception wording could not be confirmed. |

### Table 690.7(A) is deliberately empty

Research could not obtain a complete, verifiable reproduction of Table 690.7(A).
Rather than ship half-remembered multipliers, the table is **empty by design**
and the engine uses the manufacturer temperature-coefficient method instead —
which needs only the module datasheet, is independently verifiable, and is more
accurate anyway.

If you want the table method, enter the multipliers from your own code book.
See [`TABLE_690_7_A`](src/nec/tables.ts).

---

## Tier 2 — section numbering must be confirmed

The engine cites section numbers in its output. Plan reviewers read those
citations. Research found **genuine disagreement between reputable sources** on
several of them, and the NEC renumbered heavily between the 2020 and 2023
editions.

| Rule | Cited as | Concern |
|---|---|---|
| 120% busbar rule | `705.12(B)(3)(2)` in 2020, `705.12(B)(2)` in 2023 | The 2023 edition flattened one nesting level. The rule *content* is very well corroborated; the *numbering* shifted. |
| Sum rule | `705.12(B)(3)(3)` / `705.12(B)(3)` | Same flattening. One widely cited source gets this wrong, listing the sum rule at two different subsections. |
| Engineering supervision vs feed-through | `(3)(5)`/`(3)(6)` in 2020 | These two appear to have **swapped positions** in 2023. This was inferred by triangulating three sources, not stated by any one of them. Confirm before quoting. |
| EVSE branch circuit | 625.40 / 625.41 / 625.42 | Sources disagree on which subsection carries which rule. The *substance* (individual circuit, 125% continuous, EMS exclusion, 60 A/150 V disconnect threshold) is well agreed; the numbering is not. Note 625.17 is "Cord and Cable" — **not** conductor sizing, contrary to common assumption. |
| Max DC voltage label | `690.53`, possibly relocated to `690.7(D)` in 2023 | Single-source claim, uncorroborated. |
| Rapid shutdown labeling | `690.56(C)` in 2020 → `690.12(D)` in 2023 | This relocation is well corroborated. A claimed relaxation of the placard colour/reflectivity rule in 2023 is **single-source and unconfirmed** — do not rely on it to pass a labeling inspection. |

---

## Tier 3 — rules the engine does *not* implement

Do not assume silence means compliance. The engine says nothing about:

- **705.12(B) options 3–6** — center-fed panelboards, feeder taps, engineering
  supervision, and the 705.13 power control system path. These need judgement or
  a PE stamp. The engine names them as next steps when the 120% rule fails; it
  never claims compliance under them.
- **Article 706 spacing and energy limits.** The 20 kWh per unit / 40 kWh in a
  utility space / 80 kWh in a garage limits, and the 3 ft unit separation, are
  **NFPA 855 / IFC numbers, not NEC 706 text**. NEC 706 defers to the locally
  adopted fire code. Your AHJ governs, and a UL 9540A test report can raise
  those limits.
- **Structural loading.** No wind, snow, or ballast calculation is performed.
  Racking span tables are load-dependent and vary by ASCE 7 edition — several
  manufacturers' own documents cite different editions. Run the manufacturer's
  design tool.
- **Fire setbacks and access pathways** (IFC 1204 / IRC R324). Not modelled.
- **Utility interconnection rules.** Independent of the NEC and often stricter.
- **Arc-flash and available fault current.**
- **Conduit fill** beyond the ampacity adjustment factor.

---

## Component catalog

Specs were researched from manufacturer datasheets on **2026-07-20**. Treat the
catalog as a point-in-time snapshot.

- Any spec that could not be verified is `null`, never a guess. The engine
  reports `unknown` rather than calculating on a null.
- Each part carries a `source` URL, retrieval date, and confidence rating. The
  UI surfaces an ⓘ badge on low-confidence parts.
- **Prices are the least reliable field.** Most are street estimates from a
  single distributor; many manufacturers publish no pricing at all. Get a live
  quote before bidding.

### Known catalog caveats worth reading

- **UL listings are manufacturer claims.** UL's Product iQ database could not be
  queried during research. Every UL 9540 / 9540A / 1973 claim in the catalog
  comes from the manufacturer's own datasheet, not an independent check. For
  anything going to an AHJ, pull the actual UL file number and verify it.
- **UL 9540 is usually a *system* listing** — battery plus a specific inverter —
  not a property of the battery alone. Check the exact pairing.
- **UL 9540A is a test method, not a certification.** "Tested to" is not
  "listed to."
- Two products carry documented certification contradictions between the
  manufacturer's own datasheet and installation manual. Both are flagged in
  their catalog `source.note`.
- Budget battery brands vary enormously in certification coverage *within a
  single product line*. Do not generalise from one SKU to another.
- **SolarEdge does not size by cold-temperature Voc.** Its optimizers hold a
  fixed string voltage, so string length is bounded by optimizer count. The
  catalog flags these separately; applying the 690.7 method to a SolarEdge
  string gives a wrong answer.

---

## Inputs the tool will not guess

Several checks depend on decisions only the designer can make. Where one is
missing, the compliance panel reports **unknown** and says what to enter — it
does not substitute a plausible default. An invented input that produces a
confident PASS is more dangerous than a visible gap, because the arithmetic is
displayed and looks authoritative.

Currently required before the related check will run:

| Input | Set on | Gates |
|---|---|---|
| Modules per string, strings in parallel | Electrical | Conductor sizing, charge controller |
| DC run length, conductors in raceway | Electrical | Wire size and voltage drop |
| Daily load (kWh) | Start wizard | Battery bank sizing |

## Engine assumptions

- **String sizing** uses the manufacturer coefficient method (690.7(A)), with
  the limit taken as the lowest of the occupancy ceiling, the inverter max DC
  input, and the module max system voltage.
- **The minimum string length check is operational, not code.** It keeps the
  array inside the MPPT window on hot days. Leaving it out is the classic way to
  design a system that passes inspection and underproduces all summer.
- **Conductor selection** applies, in order: 690.8(B) ampacity after temperature
  and fill derates, the 110.14(C) termination limit, the 240.4(D) small
  conductor cap, and a voltage-drop target (default 3%, a design goal, not a
  code requirement).
- **220.87** uses 125% of the recorded 12-month peak. The engine *can* refuse
  the 30-day recording alternative when the service has PV or peak shaving, but
  the UI does not yet ask which method was used, so that check is not currently
  reachable. If you used a 30-day recording on a service that already has solar,
  the result here does not apply.
- **Battery bank sizing** is design practice, not a code rule, and is labelled
  as such in the output.
- **There is no annual production figure yet.** PVWatts v5 functions (Sandia
  cell temperature, DC power, inverter curve) are implemented and unit-tested in
  `src/engine/solar.ts`, but nothing in the UI displays a yield number. The
  clear-sky insolation used for *sizing* and *shading* is a geometric model
  driven by latitude and tilt — **no weather data** — and will differ from
  PVsyst or a PVWatts run against TMY.

- **625.42 load management is not wired.** The engine supports sizing an EVSE on
  its managed limit, but the UI does not ask for one, so every EVSE is sized on
  nameplate. That is the conservative direction.

---

## Contributing a verification

If you check a table against a real code book:

1. Correct any wrong values in `src/nec/tables.ts`.
2. Change that table's `status` to `verified-against-code-book`.
3. Add a note recording the edition and printing you checked against.
4. Add a test in `src/nec/*.test.ts` pinning the values you verified.

That converts a caveat into a guarantee, and the UI banner will drop the table
from its warning list automatically.
