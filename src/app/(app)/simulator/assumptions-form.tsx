'use client';

import { useMemo, useState } from 'react';

import { CAREER_PRESETS } from '@/lib/simulator/career-presets';
import {
  ROLE_PRESETS,
  searchRolePresets,
  type RolePreset,
} from '@/lib/simulator/rolePresets';
import type {
  Assumptions,
  CareerStage,
  MajorExpense,
  Person,
  Windfall,
} from '@/lib/validation/scenarios';

import { newId } from './default-assumptions';

type Setter = (next: Assumptions) => void;

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-border rounded border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] tracking-[0.2em] uppercase">{title}</span>
        <span className="text-muted text-xs">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="border-border border-t px-4 py-4">{children}</div> : null}
    </section>
  );
}

/**
 * Numeric input that fixes the "type-and-prepend-0" UX bug:
 *
 *   - When the underlying value is `0`, the input renders empty with a `0`
 *     placeholder. Typing puts characters into an empty field instead of
 *     prepending to a literal "0".
 *   - During editing, we keep a local string buffer so the user can clear,
 *     type "-", or type "1." mid-decimal without the parent forcing the
 *     value back to 0 on every keystroke.
 *   - Click/focus selects the entire value so non-zero fields are easy to
 *     replace too.
 *   - On blur, an empty or unparseable buffer propagates as `0` and the
 *     local buffer is released so external prop updates (e.g. the
 *     "Use my actual data" prefill) take over again.
 *
 * The pattern is deliberately controlled-but-tolerant: while the user is
 * actively editing, the local buffer wins; outside of editing, the prop
 * value is the source of truth. This avoids the React 19
 * `set-state-in-effect` lint and the fight-the-cursor bugs that come with
 * naive `useEffect`-based re-syncing.
 */
function NumField({
  label,
  value,
  step = 1,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  // null = "not currently editing; derive display from prop".
  // string = "user is editing; use this string verbatim".
  const [draft, setDraft] = useState<string | null>(null);

  const display = draft !== null ? draft : value === 0 ? '' : String(value);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={display}
          placeholder="0"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            // Only propagate when the buffer parses to a finite number.
            // Empty / "-" / "1." stay local until blur — propagating those
            // as 0 would clobber what the user is in the middle of typing.
            if (next.trim() === '') return;
            const n = Number(next);
            if (Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => {
            // Release the buffer back to prop-derived display. If the user
            // left it empty or garbage, fall back to 0 so the form's number
            // shape stays valid.
            if (draft !== null) {
              const trimmed = draft.trim();
              if (trimmed === '' || !Number.isFinite(Number(trimmed))) {
                onChange(0);
              }
              setDraft(null);
            }
          }}
          className="border-border focus:border-foreground nums w-full rounded border bg-transparent px-3 py-2 text-base outline-none"
        />
        {suffix ? <span className="text-muted text-xs">{suffix}</span> : null}
      </div>
    </label>
  );
}

/**
 * Inline role-library search for a career stage. The user types a query;
 * matching roles render as a small clickable list. Clicking one fills
 * baseSalary / annualRaisePct / bonusPct on the stage; everything stays
 * editable afterward.
 *
 * Deliberately stateless about "which role was picked" — once applied,
 * the stage is just a stage, not a tagged preset. The library is a
 * starting point, not a category. This matches the disclaimer the UI
 * surfaces ("starting estimates, replace with your own figures") — you
 * should never be able to tell, after editing, that someone "is" still
 * the BigLaw associate preset.
 */
function RoleSearchBox({
  onPick,
}: {
  onPick: (preset: RolePreset) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  // Memoized so typing doesn't repeatedly re-filter on identical inputs.
  const results = useMemo(() => searchRolePresets(query).slice(0, 8), [query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay blur close so an onClick on a result can fire first.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={`Search ${ROLE_PRESETS.length} starting roles (e.g. "biglaw", "L5", "MLE")…`}
        className="border-border focus:border-foreground placeholder:text-muted/50 w-full rounded border bg-transparent px-3 py-2 text-xs outline-none"
      />
      {open && results.length > 0 ? (
        <ul
          className="border-border bg-background absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-auto rounded border shadow-lg"
          role="listbox"
        >
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                // onMouseDown fires before the input's onBlur, so the pick
                // lands before the dropdown collapses.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(r);
                  setQuery('');
                  setOpen(false);
                }}
                className="hover:bg-foreground/5 flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
              >
                <span className="text-foreground text-xs">{r.title}</span>
                <span className="text-muted text-[10px]">
                  {r.track === 'legal' ? 'Legal' : 'SWE / MLE'} · ${r.baseSalary.toLocaleString()}
                  /yr base · +{r.annualRaisePct}% raise · {r.bonusPct}% bonus
                </span>
                {r.notes ? <span className="text-muted text-[10px] italic">{r.notes}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-xs">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="border-border focus:border-foreground placeholder:text-muted/50 rounded border bg-transparent px-3 py-2 text-base outline-none"
      />
    </label>
  );
}

export default function AssumptionsForm({
  value,
  onChange,
}: {
  value: Assumptions;
  onChange: Setter;
}) {
  function update(patch: Partial<Assumptions>) {
    onChange({ ...value, ...patch });
  }

  // ----------------- People helpers -----------------
  function setPeople(people: Person[]) {
    update({ people });
  }

  function addPerson() {
    setPeople([
      ...value.people,
      {
        id: newId(),
        name: `Person ${value.people.length + 1}`,
        birthYear: 1995,
        careerStages: [],
      },
    ]);
  }

  function patchPerson(personId: string, patch: Partial<Person>) {
    setPeople(value.people.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
  }

  function removePerson(personId: string) {
    setPeople(value.people.filter((p) => p.id !== personId));
  }

  function setStages(personId: string, stages: CareerStage[]) {
    patchPerson(personId, { careerStages: stages });
  }

  function addStage(personId: string) {
    const p = value.people.find((x) => x.id === personId);
    if (!p) return;
    setStages(personId, [
      ...p.careerStages,
      { label: 'New stage', startAge: 22, baseSalary: 100_000, annualRaisePct: 3 },
    ]);
  }

  function patchStage(personId: string, idx: number, patch: Partial<CareerStage>) {
    const p = value.people.find((x) => x.id === personId);
    if (!p) return;
    setStages(
      personId,
      p.careerStages.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function removeStage(personId: string, idx: number) {
    const p = value.people.find((x) => x.id === personId);
    if (!p) return;
    setStages(
      personId,
      p.careerStages.filter((_, i) => i !== idx),
    );
  }

  function applyPreset(personId: string, presetId: string) {
    const preset = CAREER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setStages(personId, preset.stages.map((s) => ({ ...s })));
  }

  // ----------------- Windfalls helpers -----------------
  function setWindfalls(windfalls: Windfall[]) {
    update({ windfalls });
  }

  // ----------------- Major-expenses helpers -----------------
  function setMajor(majorExpenses: MajorExpense[]) {
    update({ majorExpenses });
  }

  return (
    <div className="flex flex-col gap-3">
      <Section title="Horizon">
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Start year"
            value={value.horizonStartYear}
            min={1900}
            max={2200}
            onChange={(n) => update({ horizonStartYear: Math.round(n) })}
          />
          <NumField
            label="End year"
            value={value.horizonEndYear}
            min={1900}
            max={2200}
            onChange={(n) => update({ horizonEndYear: Math.round(n) })}
          />
        </div>
      </Section>

      <Section title="Starting state">
        <div className="grid grid-cols-1 gap-3">
          <NumField
            label="Starting net worth"
            value={value.startingNetWorth}
            step={1000}
            onChange={(n) => update({ startingNetWorth: n })}
            suffix="$"
          />
          <NumField
            label="Starting invested (subset of net worth)"
            value={value.startingInvested}
            step={1000}
            min={0}
            onChange={(n) => update({ startingInvested: n })}
            suffix="$"
          />
          <NumField
            label="Recurring annual household expenses"
            value={value.recurringAnnualExpenses}
            step={1000}
            min={0}
            onChange={(n) => update({ recurringAnnualExpenses: n })}
            suffix="$"
          />
        </div>
      </Section>

      <Section title="Cash flow">
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Annual savings rate"
            value={value.annualSavingsRatePct}
            step={1}
            min={0}
            max={100}
            onChange={(n) => update({ annualSavingsRatePct: n })}
            suffix="%"
          />
          <NumField
            label="Effective tax rate"
            value={value.effectiveTaxRatePct}
            step={1}
            min={0}
            max={80}
            onChange={(n) => update({ effectiveTaxRatePct: n })}
            suffix="%"
          />
        </div>
      </Section>

      <Section title="Investment & inflation">
        <div className="grid grid-cols-1 gap-3">
          <NumField
            label="Inflation"
            value={value.inflationPct}
            step={0.25}
            onChange={(n) => update({ inflationPct: n })}
            suffix="%"
          />
          <div className="grid grid-cols-3 gap-3">
            <NumField
              label="Return (low)"
              value={value.investment.returnPctLow}
              step={0.25}
              onChange={(n) =>
                update({ investment: { ...value.investment, returnPctLow: n } })
              }
              suffix="%"
            />
            <NumField
              label="Return (base)"
              value={value.investment.returnPct}
              step={0.25}
              onChange={(n) => update({ investment: { ...value.investment, returnPct: n } })}
              suffix="%"
            />
            <NumField
              label="Return (high)"
              value={value.investment.returnPctHigh}
              step={0.25}
              onChange={(n) =>
                update({ investment: { ...value.investment, returnPctHigh: n } })
              }
              suffix="%"
            />
          </div>
          <p className="text-muted text-[10px]">
            Constraint: low ≤ base ≤ high. Values outside this range will fail
            the save-scenario validation.
          </p>
        </div>
      </Section>

      <Section title={`People & careers (${value.people.length})`}>
        <div className="flex flex-col gap-4">
          {value.people.map((p) => (
            <div key={p.id} className="border-border rounded border p-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Name"
                  value={p.name}
                  maxLength={80}
                  onChange={(s) => patchPerson(p.id, { name: s })}
                />
                <NumField
                  label="Birth year"
                  value={p.birthYear}
                  min={1900}
                  max={2200}
                  onChange={(n) => patchPerson(p.id, { birthYear: Math.round(n) })}
                />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-muted text-[10px] tracking-[0.18em] uppercase">
                  Career stages ({p.careerStages.length})
                </span>
                <div className="flex items-center gap-2">
                  <select
                    className="border-border bg-background rounded border px-2 py-1 text-[11px]"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        applyPreset(p.id, e.target.value);
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="" disabled>
                      Pick preset…
                    </option>
                    {CAREER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addStage(p.id)}
                    className="border-border hover:bg-foreground/5 rounded border px-2 py-1 text-[11px]"
                  >
                    + Stage
                  </button>
                </div>
              </div>

              {p.careerStages.length === 0 ? (
                <p className="text-muted mt-2 text-xs italic">No career stages yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {p.careerStages.map((s, i) => (
                    <li key={i} className="border-border rounded border p-3">
                      <div className="mb-3 flex flex-col gap-1">
                        <span className="text-muted text-[10px] tracking-[0.18em] uppercase">
                          Role library
                        </span>
                        <RoleSearchBox
                          onPick={(preset) =>
                            patchStage(p.id, i, {
                              baseSalary: preset.baseSalary,
                              annualRaisePct: preset.annualRaisePct,
                              bonusPct: preset.bonusPct,
                            })
                          }
                        />
                        <span className="text-muted text-[10px] italic">
                          Starting estimates — replace with your own figures.
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <TextField
                          label="Label"
                          value={s.label}
                          onChange={(v) => patchStage(p.id, i, { label: v })}
                        />
                        <NumField
                          label="Starts at age"
                          value={s.startAge}
                          min={0}
                          max={120}
                          onChange={(v) => patchStage(p.id, i, { startAge: v })}
                        />
                        <NumField
                          label="Base salary"
                          value={s.baseSalary}
                          step={1000}
                          min={0}
                          onChange={(v) => patchStage(p.id, i, { baseSalary: v })}
                          suffix="$"
                        />
                        <NumField
                          label="Annual raise"
                          value={s.annualRaisePct}
                          step={0.5}
                          onChange={(v) => patchStage(p.id, i, { annualRaisePct: v })}
                          suffix="%"
                        />
                        <NumField
                          label="Bonus (% of base)"
                          value={s.bonusPct ?? 0}
                          step={1}
                          min={0}
                          onChange={(v) => patchStage(p.id, i, { bonusPct: v })}
                          suffix="%"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStage(p.id, i)}
                        className="text-muted hover:text-negative mt-2 text-[11px]"
                      >
                        Remove stage
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => removePerson(p.id)}
                className="text-muted hover:text-negative mt-3 text-[11px]"
              >
                Remove person
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addPerson}
            className="border-border hover:bg-foreground/5 self-start rounded border px-3 py-1.5 text-xs"
          >
            + Add person
          </button>
        </div>
      </Section>

      <Section title={`Windfalls (${value.windfalls.length})`} defaultOpen={false}>
        <div className="flex flex-col gap-3">
          {value.windfalls.map((w, i) => (
            <div key={i} className="border-border rounded border p-3">
              <div className="grid grid-cols-3 gap-3">
                <TextField
                  label="Label"
                  value={w.label}
                  onChange={(v) =>
                    setWindfalls(
                      value.windfalls.map((x, j) => (j === i ? { ...x, label: v } : x)),
                    )
                  }
                />
                <NumField
                  label="Year"
                  value={w.year}
                  onChange={(v) =>
                    setWindfalls(
                      value.windfalls.map((x, j) =>
                        j === i ? { ...x, year: Math.round(v) } : x,
                      ),
                    )
                  }
                />
                <NumField
                  label="Amount"
                  value={w.amount}
                  step={1000}
                  onChange={(v) =>
                    setWindfalls(
                      value.windfalls.map((x, j) => (j === i ? { ...x, amount: v } : x)),
                    )
                  }
                  suffix="$"
                />
              </div>
              <button
                type="button"
                onClick={() => setWindfalls(value.windfalls.filter((_, j) => j !== i))}
                className="text-muted hover:text-negative mt-2 text-[11px]"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setWindfalls([
                ...value.windfalls,
                { label: 'Windfall', year: value.horizonStartYear, amount: 10_000 },
              ])
            }
            className="border-border hover:bg-foreground/5 self-start rounded border px-3 py-1.5 text-xs"
          >
            + Add windfall
          </button>
        </div>
      </Section>

      <Section title={`Major expenses (${value.majorExpenses.length})`} defaultOpen={false}>
        <div className="flex flex-col gap-3">
          {value.majorExpenses.map((e, i) => {
            const isRecurring = !('year' in e);
            return (
              <div key={i} className="border-border rounded border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-muted text-[10px] tracking-[0.18em] uppercase">
                    {isRecurring ? 'Recurring' : 'One-time'}
                  </span>
                  <button
                    type="button"
                    className="text-muted hover:text-foreground text-[11px] underline-offset-2 hover:underline"
                    onClick={() => {
                      setMajor(
                        value.majorExpenses.map((x, j) => {
                          if (j !== i) return x;
                          return isRecurring
                            ? { label: x.label, year: value.horizonStartYear, amount: 10_000 }
                            : {
                                label: x.label,
                                startYear: value.horizonStartYear,
                                annualAmount: 10_000,
                                years: 5,
                              };
                        }),
                      );
                    }}
                  >
                    switch to {isRecurring ? 'one-time' : 'recurring'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Label"
                    value={e.label}
                    onChange={(v) =>
                      setMajor(
                        value.majorExpenses.map((x, j) =>
                          j === i ? { ...x, label: v } : x,
                        ),
                      )
                    }
                  />
                  {'year' in e ? (
                    <>
                      <NumField
                        label="Year"
                        value={e.year}
                        onChange={(v) =>
                          setMajor(
                            value.majorExpenses.map((x, j) =>
                              j === i && 'year' in x ? { ...x, year: Math.round(v) } : x,
                            ),
                          )
                        }
                      />
                      <NumField
                        label="Amount"
                        value={e.amount}
                        step={1000}
                        onChange={(v) =>
                          setMajor(
                            value.majorExpenses.map((x, j) =>
                              j === i && 'year' in x ? { ...x, amount: v } : x,
                            ),
                          )
                        }
                        suffix="$"
                      />
                    </>
                  ) : (
                    <>
                      <NumField
                        label="Start year"
                        value={e.startYear}
                        onChange={(v) =>
                          setMajor(
                            value.majorExpenses.map((x, j) =>
                              j === i && 'startYear' in x ? { ...x, startYear: Math.round(v) } : x,
                            ),
                          )
                        }
                      />
                      <NumField
                        label="Annual amount"
                        value={e.annualAmount}
                        step={1000}
                        onChange={(v) =>
                          setMajor(
                            value.majorExpenses.map((x, j) =>
                              j === i && 'startYear' in x ? { ...x, annualAmount: v } : x,
                            ),
                          )
                        }
                        suffix="$"
                      />
                      <NumField
                        label="Years"
                        value={e.years}
                        min={1}
                        max={200}
                        onChange={(v) =>
                          setMajor(
                            value.majorExpenses.map((x, j) =>
                              j === i && 'startYear' in x
                                ? { ...x, years: Math.max(1, Math.round(v)) }
                                : x,
                            ),
                          )
                        }
                      />
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMajor(value.majorExpenses.filter((_, j) => j !== i))}
                  className="text-muted hover:text-negative mt-2 text-[11px]"
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setMajor([
                  ...value.majorExpenses,
                  { label: 'One-time expense', year: value.horizonStartYear, amount: 50_000 },
                ])
              }
              className="border-border hover:bg-foreground/5 rounded border px-3 py-1.5 text-xs"
            >
              + One-time
            </button>
            <button
              type="button"
              onClick={() =>
                setMajor([
                  ...value.majorExpenses,
                  {
                    label: 'Recurring expense',
                    startYear: value.horizonStartYear,
                    annualAmount: 10_000,
                    years: 5,
                  },
                ])
              }
              className="border-border hover:bg-foreground/5 rounded border px-3 py-1.5 text-xs"
            >
              + Recurring
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
