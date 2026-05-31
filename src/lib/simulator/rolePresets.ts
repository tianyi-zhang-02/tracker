/**
 * Role-level starting points for the career-stage builder. Two tracks for
 * now: `legal` (BigLaw → in-house → government) and `swe` (IC SWE → EM →
 * MLE/research). Each entry is a single-role row that fills the three
 * salary-curve fields on a career stage; everything stays editable after
 * the user picks one.
 *
 * ## Last reviewed: 2026-05
 *
 * These numbers are ROUGH ILLUSTRATIVE DEFAULTS, not market data and not
 * sourced from a specific survey. They reflect a back-of-envelope read of
 * publicly-discussed US compensation ranges (Cravath-scale BigLaw,
 * Bay Area / NYC big-tech ICs, federal GS / public-interest pay) as of
 * the date above. The point is to give a user a starting anchor so they
 * don't type into a blank field — NOT to assert "this is what the role
 * pays." Anyone using this for actual planning should override every
 * number with their own real offer / W-2 figure.
 *
 * The UI accompanying this file MUST surface that caveat ("Starting
 * estimates — replace with your own figures.") so a casual user doesn't
 * walk away thinking these were derived from data.
 *
 * Bonus is modeled as a percent of base salary (matches `CareerStage.bonusPct`
 * in the engine), and `annualRaisePct` is the within-stage YoY raise (nominal,
 * before inflation). To model a promotion to a different role, add a second
 * career stage with that role's numbers and a higher `startAge`.
 */

export type RoleTrack = 'legal' | 'swe';

export type RolePreset = {
  /** Stable id for React keys + analytics. */
  id: string;
  track: RoleTrack;
  /** Human-readable title shown in the search results. */
  title: string;
  /** Annual base salary in USD (pre-bonus, pre-tax). */
  baseSalary: number;
  /** Within-stage annual raise, nominal %. */
  annualRaisePct: number;
  /** Bonus as % of base. */
  bonusPct: number;
  /** One-line context shown under the title. Plain language, no figures. */
  notes: string;
};

export const ROLE_PRESETS: readonly RolePreset[] = [
  // ---------------- Legal ----------------
  {
    id: 'biglaw-assoc-y1',
    track: 'legal',
    title: 'BigLaw Associate (Year 1)',
    baseSalary: 225_000,
    annualRaisePct: 0,
    bonusPct: 25,
    notes: 'Lockstep first-year base; raise is the year-to-year class-year bump (modeled as 0 since stages shift on promotion).',
  },
  {
    id: 'biglaw-assoc-mid',
    track: 'legal',
    title: 'BigLaw Associate (Years 3–5)',
    baseSalary: 280_000,
    annualRaisePct: 8,
    bonusPct: 35,
    notes: 'Mid-class-year lockstep; bonus scales with class.',
  },
  {
    id: 'biglaw-senior-assoc',
    track: 'legal',
    title: 'BigLaw Senior Associate (Years 6–8)',
    baseSalary: 390_000,
    annualRaisePct: 5,
    bonusPct: 45,
    notes: 'Top-of-scale associates at top-paying firms.',
  },
  {
    id: 'biglaw-counsel',
    track: 'legal',
    title: 'BigLaw Counsel / Of Counsel',
    baseSalary: 450_000,
    annualRaisePct: 3,
    bonusPct: 40,
    notes: 'Non-partner-track senior role; flatter raise curve.',
  },
  {
    id: 'biglaw-partner',
    track: 'legal',
    title: 'BigLaw Equity Partner',
    baseSalary: 1_000_000,
    annualRaisePct: 5,
    bonusPct: 100,
    notes: 'Highly variable across firms; this is a midpoint guess. Real number depends on firm + book of business.',
  },
  {
    id: 'inhouse-counsel',
    track: 'legal',
    title: 'In-house Counsel (mid-level)',
    baseSalary: 220_000,
    annualRaisePct: 4,
    bonusPct: 15,
    notes: 'Corporate legal department, mid-career.',
  },
  {
    id: 'inhouse-senior',
    track: 'legal',
    title: 'Senior In-house Counsel',
    baseSalary: 320_000,
    annualRaisePct: 4,
    bonusPct: 25,
    notes: 'Director-level in-house; often equity at tech companies.',
  },
  {
    id: 'general-counsel',
    track: 'legal',
    title: 'General Counsel',
    baseSalary: 500_000,
    annualRaisePct: 3,
    bonusPct: 50,
    notes: 'Chief legal officer at a mid-size company; equity grants not modeled.',
  },
  {
    id: 'gov-attorney',
    track: 'legal',
    title: 'Federal Government Attorney',
    baseSalary: 130_000,
    annualRaisePct: 3,
    bonusPct: 0,
    notes: 'Mid-career GS-13 to GS-14 federal; no bonus typical.',
  },
  {
    id: 'public-interest',
    track: 'legal',
    title: 'Public-interest Attorney',
    baseSalary: 75_000,
    annualRaisePct: 3,
    bonusPct: 0,
    notes: 'Nonprofit / legal-aid / DA office entry-mid level.',
  },

  // ---------------- SWE / MLE ----------------
  {
    id: 'swe-junior',
    track: 'swe',
    title: 'Junior SWE (L3 / SDE I)',
    baseSalary: 145_000,
    annualRaisePct: 6,
    bonusPct: 15,
    notes: 'New-grad big-tech; total comp heavier on RSUs which are not modeled.',
  },
  {
    id: 'swe-mid',
    track: 'swe',
    title: 'Mid SWE (L4 / SDE II)',
    baseSalary: 180_000,
    annualRaisePct: 5,
    bonusPct: 20,
    notes: '2–4 yrs experience at a top-paying tech employer.',
  },
  {
    id: 'swe-senior',
    track: 'swe',
    title: 'Senior SWE (L5)',
    baseSalary: 240_000,
    annualRaisePct: 4,
    bonusPct: 25,
    notes: '5–8 yrs experience; tech-company senior IC.',
  },
  {
    id: 'swe-staff',
    track: 'swe',
    title: 'Staff SWE (L6)',
    baseSalary: 320_000,
    annualRaisePct: 4,
    bonusPct: 30,
    notes: 'Senior IC at big tech; total comp dominated by equity in practice.',
  },
  {
    id: 'swe-principal',
    track: 'swe',
    title: 'Principal SWE (L7)',
    baseSalary: 420_000,
    annualRaisePct: 4,
    bonusPct: 35,
    notes: 'Top IC track; rare and highly variable.',
  },
  {
    id: 'em-manager',
    track: 'swe',
    title: 'Engineering Manager (M1)',
    baseSalary: 260_000,
    annualRaisePct: 5,
    bonusPct: 25,
    notes: 'First-line manager at a top-paying tech employer.',
  },
  {
    id: 'em-senior',
    track: 'swe',
    title: 'Senior EM / Director (M2)',
    baseSalary: 340_000,
    annualRaisePct: 4,
    bonusPct: 30,
    notes: 'Multi-team or director-level org.',
  },
  {
    id: 'mle-mid',
    track: 'swe',
    title: 'ML Engineer (mid)',
    baseSalary: 200_000,
    annualRaisePct: 6,
    bonusPct: 20,
    notes: 'Applied ML/MLE at a big-tech company.',
  },
  {
    id: 'mle-senior',
    track: 'swe',
    title: 'Senior ML Engineer',
    baseSalary: 280_000,
    annualRaisePct: 5,
    bonusPct: 25,
    notes: 'Senior applied-ML IC.',
  },
  {
    id: 'res-engineer',
    track: 'swe',
    title: 'Research Engineer (frontier labs)',
    baseSalary: 280_000,
    annualRaisePct: 5,
    bonusPct: 30,
    notes: 'AI research lab; total comp heavily driven by equity grants not modeled here.',
  },
  {
    id: 'res-scientist',
    track: 'swe',
    title: 'Research Scientist (PhD, frontier labs)',
    baseSalary: 320_000,
    annualRaisePct: 4,
    bonusPct: 35,
    notes: 'Sr. research scientist at an AI lab; numbers very compressed at the top vs. real practice.',
  },
] as const;

/**
 * Case-insensitive search across title + track + notes. Empty / whitespace
 * query returns all roles. Caller is responsible for picking display order.
 */
export function searchRolePresets(query: string): RolePreset[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...ROLE_PRESETS];
  return ROLE_PRESETS.filter((r) => {
    return (
      r.title.toLowerCase().includes(q) ||
      r.track.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    );
  });
}
