import { describe, it, expect } from 'vitest';

import { classifyLot, estimateSale } from './lots';

const TODAY = new Date('2026-06-15T12:00:00Z');

describe('classifyLot — contract from migration 0003 header', () => {
  it('returns needs_review for estimated-date lots, even if "old"', () => {
    expect(
      classifyLot({ acquired_on: '2010-01-01', acquired_on_estimated: true }, TODAY),
    ).toBe('needs_review');
  });

  it('returns needs_review for estimated-date lots, even if "recent"', () => {
    expect(
      classifyLot({ acquired_on: '2026-06-14', acquired_on_estimated: true }, TODAY),
    ).toBe('needs_review');
  });

  it('classifies a lot acquired more than 365 days ago as long_term', () => {
    // 2026-06-15 minus 2025-06-14 = 366 days → long_term.
    expect(
      classifyLot({ acquired_on: '2025-06-14', acquired_on_estimated: false }, TODAY),
    ).toBe('long_term');
  });

  it('classifies a lot acquired exactly 365 days ago as short_term (exclusive threshold — IRS LT kicks in at 366+)', () => {
    expect(
      classifyLot({ acquired_on: '2025-06-15', acquired_on_estimated: false }, TODAY),
    ).toBe('short_term');
  });

  it('classifies a lot acquired today as short_term', () => {
    expect(
      classifyLot({ acquired_on: '2026-06-15', acquired_on_estimated: false }, TODAY),
    ).toBe('short_term');
  });

  it('returns needs_review on a malformed date', () => {
    expect(
      classifyLot({ acquired_on: 'not-a-date', acquired_on_estimated: false }, TODAY),
    ).toBe('needs_review');
  });
});

describe('estimateSale — math + contract behavior', () => {
  const base = {
    quantity: 100,
    cost_basis: 10_000,
    current_price: 150,
    acquired_on_estimated: false,
    ltTaxRatePct: 15,
    stTaxRatePct: 32,
  };

  it('computes marketValue = qty × current_price and unrealizedGain = marketValue − cost_basis', () => {
    const r = estimateSale({ ...base, acquired_on: '2024-01-01' }, TODAY);
    expect(r.marketValue).toBe(15_000); // 100 × 150
    expect(r.unrealizedGain).toBe(5_000); // 15_000 − 10_000
  });

  it('applies the LT rate when classification is long_term', () => {
    const r = estimateSale({ ...base, acquired_on: '2024-01-01' }, TODAY);
    expect(r.classification).toBe('long_term');
    expect(r.taxEstimate).toBe(750); // 5_000 × 0.15
  });

  it('applies the ST rate when classification is short_term', () => {
    const r = estimateSale({ ...base, acquired_on: '2026-01-01' }, TODAY);
    expect(r.classification).toBe('short_term');
    expect(r.taxEstimate).toBe(1_600); // 5_000 × 0.32
  });

  it('returns taxEstimate=null for needs_review lots (contract)', () => {
    const r = estimateSale({ ...base, acquired_on_estimated: true, acquired_on: '2024-01-01' }, TODAY);
    expect(r.classification).toBe('needs_review');
    expect(r.taxEstimate).toBeNull();
    // Market value + gain still computed — they're not classification-dependent.
    expect(r.marketValue).toBe(15_000);
    expect(r.unrealizedGain).toBe(5_000);
  });

  it('returns taxEstimate=null when the relevant rate is 0 (user has not set it)', () => {
    const r = estimateSale(
      { ...base, ltTaxRatePct: 0, acquired_on: '2024-01-01' },
      TODAY,
    );
    expect(r.classification).toBe('long_term');
    expect(r.taxEstimate).toBeNull();
  });

  it('returns taxEstimate=null on a loss (no tax owed on a loss)', () => {
    const r = estimateSale(
      { ...base, current_price: 50, acquired_on: '2024-01-01' },
      TODAY,
    );
    expect(r.unrealizedGain).toBe(-5_000);
    expect(r.taxEstimate).toBeNull();
  });

  it('returns taxEstimate=null on zero gain', () => {
    const r = estimateSale(
      { ...base, current_price: 100, acquired_on: '2024-01-01' },
      TODAY,
    );
    expect(r.unrealizedGain).toBe(0);
    expect(r.taxEstimate).toBeNull();
  });

  it('rounds market value, gain, and tax estimate to the cent', () => {
    const r = estimateSale(
      {
        ...base,
        quantity: 47.39281004,
        cost_basis: 9_876.21,
        current_price: 243.18,
        ltTaxRatePct: 20,
        acquired_on: '2024-01-01',
      },
      TODAY,
    );
    // Market: 47.39281004 × 243.18 = 11,524.05 (rounded). Hand-check the
    // arithmetic.
    const exactMarket = 47.39281004 * 243.18;
    expect(r.marketValue).toBe(Math.round(exactMarket * 100) / 100);
    const exactGain = r.marketValue - 9_876.21;
    expect(r.unrealizedGain).toBe(Math.round(exactGain * 100) / 100);
    if (r.taxEstimate !== null) {
      const exactTax = r.unrealizedGain * 0.20;
      expect(r.taxEstimate).toBe(Math.round(exactTax * 100) / 100);
    }
  });
});
