# Step 10 (Upgraded) — Household Wealth Simulator

> Replaces the basic "Projections" page in the original `WEALTH_TRACKER_SPEC.md`. Do NOT build ahead of order — Steps 8 (Savings Goals) and 9 (Holdings + Alpha Vantage) come first.

## What this is

An interactive scenario planner that projects household net worth over time (e.g. to age 65), modeling two careers, career switches, windfalls, major expenses, and investment growth. Scenarios are saved and named so the user can revisit and compare them (e.g. "Stay in BigLaw" vs "Both go in-house at 35").

This is a planning/illustration tool, not financial advice. The UI carries a short disclaimer: projections are estimates based on user assumptions, not predictions, and not advice.

---

## Data model — new table

```sql
scenarios (
  id          uuid primary key,
  user_id     uuid references auth.users not null,
  name        text,                       -- "Move to in-house at 35"
  assumptions jsonb,                       -- the full scenario config (see shape below)
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
```

RLS: `auth.uid() = user_id`, same as every other table.

Storing the whole config as `jsonb` keeps the schema simple and lets the simulator evolve without migrations. Validate the JSON shape with zod on write.

### `assumptions` JSON shape

```jsonc
{
  "horizonStartYear": 2026,
  "horizonEndYear": 2061,          // or derive from a target age
  "people": [
    {
      "id": "p1",
      "name": "Me",
      "birthYear": 1995,
      "careerStages": [            // ordered, contiguous by age/year
        {
          "label": "BigLaw Associate",
          "startAge": 30,
          "baseSalary": 215000,
          "annualRaisePct": 4,     // nominal raise on top of inflation
          "bonusPct": 15           // % of base, optional
        },
        {
          "label": "In-house Counsel",
          "startAge": 35,
          "baseSalary": 250000,
          "annualRaisePct": 3,
          "bonusPct": 10
        }
      ]
    },
    {
      "id": "p2",
      "name": "Spouse",
      "birthYear": 1996,
      "careerStages": [ /* ... */ ]
    }
  ],
  "startingNetWorth": 120000,
  "startingInvested": 80000,       // portion already invested (grows at returnPct)
  "annualSavingsRatePct": 30,      // % of after-tax income saved/invested
  "effectiveTaxRatePct": 32,       // blended household rate, simplifying assumption
  "investment": {
    "returnPct": 7,                // nominal expected annual return
    "returnPctLow": 4,             // for the pessimistic band
    "returnPctHigh": 10            // for the optimistic band
  },
  "inflationPct": 3,
  "windfalls": [
    { "label": "Inheritance",   "year": 2030, "amount": 200000 },
    { "label": "Signing bonus", "year": 2027, "amount":  50000 }
  ],
  "majorExpenses": [
    { "label": "House down payment", "year": 2029, "amount": 150000 },
    { "label": "Kid #1", "startYear": 2031, "annualAmount": 25000, "years": 18 }
  ],
  "recurringAnnualExpenses": 90000  // baseline household spend, grows with inflation
}
```

Other factors can be added as new optional keys over time (e.g. `oneTimeIncomes`, `debtPayoff`, `rentVsBuy`). The engine should ignore keys it doesn't recognize so old scenarios never break.

---

## Career presets

Ship a small library of editable presets in code (not the DB) — `src/lib/simulator/career-presets.ts`. User picks one to seed a career stage, then edits the numbers. Examples to include (illustrative starting points the user will tune, NOT authoritative salary data):

- BigLaw associate track (Cravath-scale-style steep curve)
- In-house counsel
- Government / public-interest attorney
- Software engineer (IC track)
- Engineering management
- Medicine (resident → attending)
- Finance / IB
- Generic "custom" (all fields blank)

Each preset is just default values for `baseSalary`, `annualRaisePct`, `bonusPct`, and optional multi-stage curves. Add a code comment that these are rough illustrative defaults, last reviewed [date], and the user should replace with their own figures.

---

## Simulation engine — `src/lib/simulator/engine.ts`

Pure, deterministic function. No DB, no network. Easy to unit-test.

```ts
type YearRow = {
  year: number;
  ages: Record<string, number>;     // per person
  grossIncome: number;
  afterTaxIncome: number;
  expenses: number;
  windfalls: number;
  saved: number;                    // added to invested this year
  investmentGrowth: number;
  investedBalance: number;
  netWorth: number;
  netWorthRealTodayDollars: number; // inflation-adjusted
};

function simulate(assumptions): {
  rows: YearRow[];
  low: YearRow[];   // using returnPctLow
  high: YearRow[];  // using returnPctHigh
};
```

### Year-by-year loop (the core logic)

For each year from start to end:

1. For each person, find their active `careerStage` (the one whose `startAge` ≤ current age, latest one). Compute that year's salary = `baseSalary * (1 + annualRaisePct/100)^(yearsIntoStage)`, plus bonus. Sum across people → `grossIncome`.
2. `afterTaxIncome = grossIncome * (1 - effectiveTaxRatePct/100)`.
3. `expenses = recurringAnnualExpenses * (1 + inflationPct/100)^(yearsElapsed)` + any `majorExpenses` active this year.
4. `windfalls` = sum of windfalls for this year.
5. `saved = max(0, afterTaxIncome * savingsRatePct/100 - shortfall)`. If expenses exceed after-tax income, draw down invested balance instead.
6. `investmentGrowth = investedBalance * returnPct/100` (apply before or after contributions — pick start-of-year convention and document it).
7. `investedBalance += saved + windfalls + investmentGrowth - majorExpensesPaidFromInvestments`.
8. `netWorth = investedBalance + any non-invested cash`. Keep it simple: treat everything as one pool unless a cash-vs-invested split is needed.
9. `netWorthRealTodayDollars = netWorth / (1 + inflationPct/100)^(yearsElapsed)`.

Run the loop three times (base / low / high return) for the confidence band on the chart.

Document every simplifying assumption in a comment block at the top of the engine: flat effective tax rate, no Social Security, no sequence-of-returns risk, no tax-advantaged account modeling, etc. This keeps the user honest about what the tool does and doesn't capture.

---

## API routes

```
GET    /api/scenarios            list user's saved scenarios
POST   /api/scenarios            create { name, assumptions }
GET    /api/scenarios/:id
PATCH  /api/scenarios/:id        rename or update assumptions
DELETE /api/scenarios/:id
```

The simulation itself runs client-side (pure math, no secrets, instant). No `/api/simulate` needed — just import the engine in the page. Saving only persists the `assumptions` config, not the computed rows (recompute on load).

Seed defaults from the user's real data where possible: `startingNetWorth` and `startingInvested` can be prefilled from `/api/networth`, and `recurringAnnualExpenses` / `annualSavingsRatePct` can be estimated from the last 6–12 months of transactions. Offer these as "use my actual data" prefill buttons.

---

## UI — `/simulator` (rename from `/projections`)

Add it as a 6th route. The bottom nav has 5 slots; put Simulator under Settings or a "More" affordance, or swap Projections→Simulator if Projections was nav-linked.

### Layout

- **Top**: scenario selector dropdown (saved scenarios) + "New scenario" + "Duplicate" + "Compare" buttons
- **Left / collapsible panel**: the assumptions form, grouped into sections:
  - People & careers (add person, add career stage, pick preset, edit fields)
  - Investment & inflation assumptions
  - Windfalls (add/remove rows)
  - Major expenses (add/remove rows)
  - Savings rate & taxes
- **Main: results**
  - Net worth chart (Recharts) — base line, shaded low–high band, markers on years with windfalls or major expenses. Toggle nominal vs inflation-adjusted.
  - Year-by-year table below the chart — scrollable, one row per year, columns from `YearRow`. Tabular nums. Highlight career-switch years and windfall/expense years.
- **Compare mode**: select 2–3 saved scenarios → overlay their net-worth lines on one chart with a legend, plus a small table of end-state deltas ("Scenario B ends $1.2M higher, crosses $1M four years earlier").

### Interactions

- Editing any assumption recomputes instantly (debounced) — no save needed to preview
- "Save" persists the current assumptions to the selected scenario; "Save as new" creates a copy
- Each career stage shows the implied age range and a tiny inline salary-at-end-of-stage preview

### Design

Follow `CLAUDE.md` design tokens. Numbers are the hero. The chart is thin-lined, no chart-junk. The band is a low-opacity fill of the accent color.

---

## Build sub-steps (commit each)

1. `scenarios` table migration + RLS + zod schema for `assumptions`
2. Scenarios CRUD API routes
3. Career presets file + engine (`engine.ts`) with unit tests — this is the one place tests are worth it; a wrong formula silently corrupts every projection
4. Simulator page shell + assumptions form
5. Chart (base + band, nominal/real toggle)
6. Year-by-year table
7. Save / load / duplicate scenarios
8. Compare mode
9. "Use my actual data" prefill from networth + transactions

**Pause after sub-step 3** (engine + tests) so the user can sanity-check the math against a known case before the UI is built on top of it.

---

## Notes / disclaimers to bake into the UI

- A one-line disclaimer near the results: "Estimates based on your assumptions. Not a prediction or financial advice."
- Career preset salaries are illustrative defaults, not market data — user should replace with real figures.
- The model uses simplifying assumptions (flat tax rate, single asset-return figure, etc.). Consider a small "What this model ignores" expandable note for honesty.
