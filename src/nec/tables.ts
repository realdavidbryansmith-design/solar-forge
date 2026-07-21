/**
 * NEC lookup tables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE TRUSTING ANY NUMBER IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 * NFPA 70 is copyrighted and paywalled. These tables were transcribed from
 * secondary sources (training material, manufacturer guides, AHJ handouts) and
 * have NOT been checked line-by-line against a licensed copy of the code book.
 *
 * Every table below carries a `verification` record. The calculation engine
 * propagates that status into its results, and the UI renders an "unverified"
 * badge on any output that depended on an unverified table. Nothing here is
 * silently trusted.
 *
 * See VERIFICATION.md for the checklist a licensed electrician must work
 * through before this tool is used on a permitted job.
 */

export type VerificationStatus =
  | 'verified-against-code-book'
  | 'transcribed-needs-review'
  | 'unverified-do-not-rely'

export interface TableProvenance {
  citation: string
  edition: string
  status: VerificationStatus
  note?: string
}

// ---------------------------------------------------------------------------
// Conductor sizes
// ---------------------------------------------------------------------------

/** Conductor sizes in ascending area order. Index order matters for upsizing. */
export const CONDUCTOR_SIZES = [
  '14',
  '12',
  '10',
  '8',
  '6',
  '4',
  '3',
  '2',
  '1',
  '1/0',
  '2/0',
  '3/0',
  '4/0',
  '250',
  '300',
  '350',
  '400',
  '500',
] as const

export type ConductorSize = (typeof CONDUCTOR_SIZES)[number]
export type ConductorMaterial = 'Cu' | 'Al'
export type TempRating = 60 | 75 | 90

// ---------------------------------------------------------------------------
// Table 310.16 — allowable ampacities, not more than 3 current-carrying
// conductors in a raceway, 30 degrees C ambient.
// ---------------------------------------------------------------------------

export const AMPACITY_310_16: Record<
  ConductorMaterial,
  Record<TempRating, Partial<Record<ConductorSize, number>>>
> = {
  Cu: {
    60: {
      '14': 15, '12': 20, '10': 30, '8': 40, '6': 55, '4': 70, '3': 85,
      '2': 95, '1': 110, '1/0': 125, '2/0': 145, '3/0': 165, '4/0': 195,
      '250': 215, '300': 240, '350': 260, '400': 280, '500': 320,
    },
    75: {
      '14': 20, '12': 25, '10': 35, '8': 50, '6': 65, '4': 85, '3': 100,
      '2': 115, '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230,
      '250': 255, '300': 285, '350': 310, '400': 335, '500': 380,
    },
    90: {
      '14': 25, '12': 30, '10': 40, '8': 55, '6': 75, '4': 95, '3': 115,
      '2': 130, '1': 145, '1/0': 170, '2/0': 195, '3/0': 225, '4/0': 260,
      '250': 290, '300': 320, '350': 350, '400': 380, '500': 430,
    },
  },
  Al: {
    // Aluminum / copper-clad aluminum. 14 AWG Al is not a listed size.
    60: {
      '12': 15, '10': 25, '8': 30, '6': 40, '4': 55, '3': 65, '2': 75,
      '1': 85, '1/0': 100, '2/0': 115, '3/0': 130, '4/0': 150,
      '250': 170, '300': 195, '350': 210, '400': 225, '500': 260,
    },
    75: {
      '12': 20, '10': 30, '8': 40, '6': 50, '4': 65, '3': 75, '2': 90,
      '1': 100, '1/0': 120, '2/0': 135, '3/0': 155, '4/0': 180,
      '250': 205, '300': 230, '350': 250, '400': 270, '500': 310,
    },
    90: {
      '12': 25, '10': 35, '8': 45, '6': 55, '4': 75, '3': 85, '2': 100,
      '1': 115, '1/0': 135, '2/0': 150, '3/0': 175, '4/0': 205,
      '250': 230, '300': 260, '350': 280, '400': 305, '500': 350,
    },
  },
}

export const AMPACITY_310_16_PROVENANCE: TableProvenance = {
  citation: 'NEC Table 310.16',
  edition: '2023',
  status: 'transcribed-needs-review',
  note:
    'Values are stable across the 2017/2020/2023 editions. Transcribed from ' +
    'secondary sources; verify against a code book before permitted use.',
}

/**
 * NEC 240.4(D) small-conductor rule: regardless of ampacity, overcurrent
 * protection for these sizes is capped unless one of the 240.4(E)/(G)
 * exceptions applies (PV circuits under 690.9 are one such case).
 */
export const SMALL_CONDUCTOR_OCPD_LIMIT: Partial<
  Record<ConductorMaterial, Partial<Record<ConductorSize, number>>>
> = {
  Cu: { '14': 15, '12': 20, '10': 30 },
  Al: { '12': 15, '10': 25 },
}

// ---------------------------------------------------------------------------
// Table 310.15(B)(1)(1) — ambient temperature correction, 30 C base
// ---------------------------------------------------------------------------

interface TempBand {
  max_c: number
  f60: number | null
  f75: number | null
  f90: number | null
}

export const TEMP_CORRECTION_30C_BASE: TempBand[] = [
  { max_c: 10, f60: 1.29, f75: 1.2, f90: 1.15 },
  { max_c: 15, f60: 1.22, f75: 1.15, f90: 1.12 },
  { max_c: 20, f60: 1.15, f75: 1.11, f90: 1.08 },
  { max_c: 25, f60: 1.08, f75: 1.05, f90: 1.04 },
  { max_c: 30, f60: 1.0, f75: 1.0, f90: 1.0 },
  { max_c: 35, f60: 0.91, f75: 0.94, f90: 0.96 },
  { max_c: 40, f60: 0.82, f75: 0.88, f90: 0.91 },
  { max_c: 45, f60: 0.71, f75: 0.82, f90: 0.87 },
  { max_c: 50, f60: 0.58, f75: 0.75, f90: 0.82 },
  { max_c: 55, f60: 0.41, f75: 0.67, f90: 0.76 },
  { max_c: 60, f60: null, f75: 0.58, f90: 0.71 },
  { max_c: 65, f60: null, f75: 0.47, f90: 0.65 },
  { max_c: 70, f60: null, f75: 0.33, f90: 0.58 },
  { max_c: 75, f60: null, f75: null, f90: 0.5 },
  { max_c: 80, f60: null, f75: null, f90: 0.41 },
  { max_c: 85, f60: null, f75: null, f90: 0.29 },
]

export const TEMP_CORRECTION_PROVENANCE: TableProvenance = {
  citation: 'NEC Table 310.15(B)(1)(1)',
  edition: '2023',
  status: 'transcribed-needs-review',
}

/**
 * Ambient temperature correction factor.
 * Returns null when the ambient exceeds what the insulation rating allows —
 * that is a genuine "you cannot use this conductor here" answer, not an error.
 */
export function tempCorrectionFactor(
  ambient_c: number,
  rating: TempRating,
): number | null {
  const key = rating === 60 ? 'f60' : rating === 75 ? 'f75' : 'f90'
  for (const band of TEMP_CORRECTION_30C_BASE) {
    if (ambient_c <= band.max_c) return band[key]
  }
  return null
}

// ---------------------------------------------------------------------------
// Table 310.15(C)(1) — adjustment for more than 3 current-carrying conductors
// ---------------------------------------------------------------------------

export function conduitFillAdjustment(currentCarryingConductors: number): number {
  const n = currentCarryingConductors
  if (n <= 3) return 1.0
  if (n <= 6) return 0.8
  if (n <= 9) return 0.7
  if (n <= 20) return 0.5
  if (n <= 30) return 0.45
  if (n <= 40) return 0.4
  return 0.35
}

export const CONDUIT_FILL_PROVENANCE: TableProvenance = {
  citation: 'NEC Table 310.15(C)(1)',
  edition: '2023',
  status: 'transcribed-needs-review',
}

/**
 * NEC 310.15(B)(2) rooftop conduit temperature adder.
 *
 * The 2014 code had a tiered adder up to 33 C for conduit close to the roof
 * deck. The 2017 edition deleted that table and replaced it with a flat 33 C
 * adder that applies only to circuits in sunlight on or above a roof, with an
 * exception for XHHW-2. Which rule applies depends on the AHJ's code cycle,
 * so the caller passes the edition in.
 */
export function rooftopTempAdder(
  edition: '2017' | '2020' | '2023',
  heightAboveRoof_mm: number,
  insulation: string,
): number {
  // XHHW-2 is exempted from the adder in 2017 and later.
  if (edition !== '2017' && insulation.toUpperCase().includes('XHHW-2')) return 0
  if (insulation.toUpperCase().includes('XHHW-2')) return 0

  // Above 900 mm (36 in) the conduit is out of the hot boundary layer.
  if (heightAboveRoof_mm > 900) return 0
  return 33
}

export const ROOFTOP_ADDER_PROVENANCE: TableProvenance = {
  citation: 'NEC 310.15(B)(2)',
  edition: '2023',
  status: 'unverified-do-not-rely',
  note:
    'The 2017 edition replaced the 2014 tiered table with a flat 33 C adder ' +
    'and an XHHW-2 exception. The exact height threshold and exception ' +
    'wording could not be confirmed from a primary source. Verify before use.',
}

// ---------------------------------------------------------------------------
// Table 250.122 — equipment grounding conductor sizing
// ---------------------------------------------------------------------------

interface EgcRow {
  ocpd_a: number
  cu: ConductorSize
  al: ConductorSize | null
}

export const EGC_250_122: EgcRow[] = [
  { ocpd_a: 15, cu: '14', al: '12' },
  { ocpd_a: 20, cu: '12', al: '10' },
  { ocpd_a: 60, cu: '10', al: '8' },
  { ocpd_a: 100, cu: '8', al: '6' },
  { ocpd_a: 200, cu: '6', al: '4' },
  { ocpd_a: 300, cu: '4', al: '2' },
  { ocpd_a: 400, cu: '3', al: '1' },
  { ocpd_a: 500, cu: '2', al: '1/0' },
  { ocpd_a: 600, cu: '1', al: '2/0' },
  { ocpd_a: 800, cu: '1/0', al: '3/0' },
  { ocpd_a: 1000, cu: '2/0', al: '4/0' },
  { ocpd_a: 1200, cu: '3/0', al: '250' },
]

export const EGC_PROVENANCE: TableProvenance = {
  citation: 'NEC Table 250.122',
  edition: '2023',
  status: 'transcribed-needs-review',
}

/** Smallest EGC permitted for a given OCPD rating. */
export function egcSize(
  ocpd_a: number,
  material: ConductorMaterial,
): ConductorSize | null {
  for (const row of EGC_250_122) {
    if (ocpd_a <= row.ocpd_a) return material === 'Cu' ? row.cu : row.al
  }
  return null
}

// ---------------------------------------------------------------------------
// Chapter 9, Table 8 — conductor DC resistance, ohms per 1000 ft, stranded
// ---------------------------------------------------------------------------

export const RESISTANCE_OHMS_PER_KFT: Record<
  ConductorMaterial,
  Partial<Record<ConductorSize, number>>
> = {
  Cu: {
    '14': 3.14, '12': 1.98, '10': 1.24, '8': 0.778, '6': 0.491, '4': 0.308,
    '3': 0.245, '2': 0.194, '1': 0.154, '1/0': 0.122, '2/0': 0.0967,
    '3/0': 0.0766, '4/0': 0.0608, '250': 0.0515, '300': 0.0429,
    '350': 0.0367, '400': 0.0321, '500': 0.0258,
  },
  Al: {
    '12': 3.25, '10': 2.04, '8': 1.28, '6': 0.808, '4': 0.508, '3': 0.403,
    '2': 0.319, '1': 0.253, '1/0': 0.201, '2/0': 0.159, '3/0': 0.126,
    '4/0': 0.1, '250': 0.0847, '300': 0.0707, '350': 0.0605, '400': 0.0529,
    '500': 0.0424,
  },
}

export const RESISTANCE_PROVENANCE: TableProvenance = {
  citation: 'NEC Chapter 9, Table 8',
  edition: '2023',
  status: 'transcribed-needs-review',
  note: 'Uncoated stranded conductor DC resistance at 75 degrees C.',
}

// ---------------------------------------------------------------------------
// 240.6(A) — standard overcurrent device ratings
// ---------------------------------------------------------------------------

export const STANDARD_OCPD_RATINGS = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175,
  200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200,
] as const

export const OCPD_PROVENANCE: TableProvenance = {
  citation: 'NEC 240.6(A)',
  edition: '2023',
  status: 'transcribed-needs-review',
}

/** Smallest standard OCPD at or above the given current. */
export function nextStandardOcpd(current_a: number): number | null {
  for (const r of STANDARD_OCPD_RATINGS) if (r >= current_a) return r
  return null
}

/** Largest standard OCPD at or below the given current. */
export function prevStandardOcpd(current_a: number): number | null {
  let best: number | null = null
  for (const r of STANDARD_OCPD_RATINGS) if (r <= current_a) best = r
  return best
}

// ---------------------------------------------------------------------------
// Table 690.7(A) — voltage correction for crystalline silicon modules
// ---------------------------------------------------------------------------

/**
 * DELIBERATELY NOT POPULATED.
 *
 * Research could not obtain a complete, verifiable reproduction of this table
 * — every source confirmed the table exists but declined to reproduce the
 * rows. Shipping a half-remembered multiplier here would silently produce
 * wrong maximum-voltage results, which is a genuine safety issue.
 *
 * The engine therefore uses the manufacturer temperature-coefficient method
 * (NEC 690.7(A), the alternative to this table), which needs only the module
 * datasheet and is fully verifiable. That method is also more accurate and is
 * what most designers use anyway.
 *
 * If you want the table method, enter the multipliers from your own code book
 * via the site settings — the engine will use them and drop the warning.
 */
export const TABLE_690_7_A: Array<{ max_c: number; multiplier: number }> = []

export const TABLE_690_7_A_PROVENANCE: TableProvenance = {
  citation: 'NEC Table 690.7(A)',
  edition: '2023',
  status: 'unverified-do-not-rely',
  note:
    'Intentionally empty. Use the temperature-coefficient method instead, or ' +
    'supply the multipliers from your own code book.',
}

// ---------------------------------------------------------------------------
// Voltage drop constants
// ---------------------------------------------------------------------------

/**
 * Approximate resistivity K (ohm-cmil/ft) used in the classic voltage drop
 * shortcut. The engine prefers the Chapter 9 Table 8 resistance values above;
 * these are provided for cross-checking against field rules of thumb.
 */
export const VD_K_CONSTANT: Record<ConductorMaterial, number> = {
  Cu: 12.9,
  Al: 21.2,
}

/** Circular mil area by conductor size (Chapter 9, Table 8). */
export const CIRCULAR_MILS: Partial<Record<ConductorSize, number>> = {
  '14': 4110, '12': 6530, '10': 10380, '8': 16510, '6': 26240, '4': 41740,
  '3': 52620, '2': 66360, '1': 83690, '1/0': 105600, '2/0': 133100,
  '3/0': 167800, '4/0': 211600, '250': 250000, '300': 300000, '350': 350000,
  '400': 400000, '500': 500000,
}

/**
 * Every provenance record in this module, so the UI can render a single
 * "code data sources" screen and the engine can roll up a worst-case status.
 */
export const ALL_PROVENANCE: TableProvenance[] = [
  AMPACITY_310_16_PROVENANCE,
  TEMP_CORRECTION_PROVENANCE,
  CONDUIT_FILL_PROVENANCE,
  ROOFTOP_ADDER_PROVENANCE,
  EGC_PROVENANCE,
  RESISTANCE_PROVENANCE,
  OCPD_PROVENANCE,
  TABLE_690_7_A_PROVENANCE,
]
