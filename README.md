# SolarForge

An NEC-aware design, sizing and takeoff tool for solar PV, battery storage, and
EV charging systems. Runs in a browser, installs as a PWA, and works on a phone
on a roof.

Built as a standalone web app rather than an AutoCAD plugin because a plugin
can't be mobile — see [Why not an AutoCAD add-on](#why-not-an-autocad-add-on).

> **Read [VERIFICATION.md](VERIFICATION.md) before using any output on a
> permitted job.** This is a design aid, not a substitute for a licensed
> electrician. NFPA 70 is paywalled, so the code tables here were transcribed
> from secondary sources and are flagged as unverified inside the app itself.

---

## What it does

**3D site model.** Roof planes at real tilt and azimuth, modules laid out at
true datasheet dimensions, and a sun you can scrub through the year. Shadows are
computed from real solar geometry, so the winter-9am shading case you have to
design around is something you can actually look at.

**NEC calculations that show their work.** Every check renders the citation, the
arithmetic, and the intermediate values — so a plan reviewer can follow it
rather than trusting a green tick:

- **690.7** cold-temperature Voc correction and maximum string length
- **690.8** maximum circuit current and the compounded 156% conductor rule
- **310.16 / 310.15** ampacity with temperature, conduit-fill and rooftop derates
- **110.14(C)** termination limits and **240.4(D)** small-conductor caps
- **250.122** EGC sizing, plus voltage drop
- **705.12** load-side interconnection — the sum rule and the 120% busbar rule
- **625.41 / 220.87 / 220.57** EV charging against the existing service
- Off-grid charge controller and battery bank sizing

**Component catalog** researched from manufacturer datasheets: modules,
string/micro/hybrid inverters, batteries, charge controllers, racking and
trackers, EVSE, and balance-of-system parts.

**Bill of materials** with a CSV export.

## What it deliberately does not do

Silence is not compliance. It performs no structural, wind, snow or ballast
calculation; no fire setback or access pathway check; no utility interconnection
review; no arc-flash study. The 705.12 options requiring judgement or a PE stamp
are named as next steps, never auto-passed. Full list in
[VERIFICATION.md](VERIFICATION.md).

## Design decisions worth knowing

**Nulls are never zero.** Any spec the research could not verify is `null`, and
the engine reports `unknown` rather than calculating on it. The BOM excludes
unpriced lines from the subtotal instead of silently treating them as free.

**Table 690.7(A) ships empty on purpose.** Research could not obtain a
verifiable reproduction of it. Rather than ship half-remembered multipliers, the
engine uses the manufacturer temperature-coefficient method — which needs only
the module datasheet, is independently checkable, and is more accurate anyway.

**Optimizer-based inverters are a separate code path.** SolarEdge optimizers
hold a fixed string voltage, so string length is bounded by optimizer count, not
by cold-temperature Voc. Applying the 690.7 method there gives a wrong answer,
so the engine branches instead of pretending.

**Provenance is visible.** Every catalog part carries a datasheet URL, retrieval
date and confidence rating, surfaced as an ⓘ badge. Every NEC table carries a
verification status, and the compliance panel banners the ones still unverified.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173/solar-forge/
npm test         # solar geometry unit tests
npm run build
```

Deploying somewhere other than a GitHub Pages project site:

```bash
BASE_PATH=/ npm run build
```

## Architecture

```
src/
  types.ts          domain model — every spec field, nullable where unverified
  store.ts          Zustand store; derived values are selectors, never stored
  catalog/          researched parts, each with a source + confidence
  nec/
    tables.ts       NEC lookup tables, each with a verification status
    index.ts        the calculation engine; every result carries its citation
  engine/solar.ts   sun position, row spacing, backtracking, PVWatts v5 yield
  render3d/         Three.js scene (roof geometry, module instancing, sun)
  ui/               mobile-first panels
```

The solar geometry is unit-tested against known values — solstice declination,
noon altitude, backtracking behaviour, PVWatts temperature derates.

## Why not an AutoCAD add-on

An AutoCAD plugin is Windows-only, desktop-only, and needs an AutoCAD licence,
which rules out the phone-on-a-roof use case that drove this design. A DXF
export is the sensible bridge back into CAD and is the natural next feature.

## Roadmap

- DXF export and a generated single-line diagram
- PDF permit package
- PVWatts / NSRDB integration for real weather-driven yield
- Automatic string configuration and inter-row spacing for ground mounts
- Conduit fill per Chapter 9

## Licence

MIT. Provided as-is, with no warranty of code compliance — see
[VERIFICATION.md](VERIFICATION.md).
