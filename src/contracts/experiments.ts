// Experiment statistics shared by the server and the console. Used for A/B splits in native workflows, which are
// judged on what recipients did (clicks, conversions, qualified leads, revenue), never on opens: Apple Mail Privacy
// Protection and security scanners load tracking pixels, so open rates cannot pick a winner reliably.

export const experimentMetrics = ['click', 'conversion', 'qualified_lead', 'revenue'] as const;
export type ExperimentMetric = (typeof experimentMetrics)[number];

export const experimentMetricLabels: Record<ExperimentMetric, { label: string; description: string }> = {
  click: { label: 'Clicked a link', description: 'A link in an email from this workflow was clicked (scanner clicks excluded).' },
  conversion: { label: 'Converted', description: 'Submitted a form or converted on a landing page.' },
  qualified_lead: { label: 'Became a qualified lead', description: 'A deal was created for the contact.' },
  revenue: { label: 'Revenue won', description: 'Value of deals won for the contact. Compared per contact.' },
};

/** Fixed rules, shown to the user with every result. */
export const experimentRules = { minimumPerArm: 100, minimumEvents: 5, alpha: 0.05, defaultWindowDays: 14 } as const;

export type ExperimentArm = {
  arm: 'a' | 'b';
  allocated: number;
  /** Contacts who did the metric at least once (for revenue: contacts with any won revenue). */
  successes: number;
  rate: number;
  revenue: number;
  revenuePerContact: number;
};

export type ExperimentVerdict = 'collecting' | 'inconclusive' | 'a_wins' | 'b_wins';

export type ExperimentResult = {
  nodeId: string;
  label: string;
  metric: ExperimentMetric;
  windowDays: number;
  percentA: number;
  arms: [ExperimentArm, ExperimentArm];
  verdict: ExperimentVerdict;
  /** Two-sided p-value; null while collecting. */
  pValue: number | null;
  /** B minus A: rate points for proportions, currency per contact for revenue. */
  difference: number | null;
  /** 95% confidence interval for the difference. */
  interval: [number, number] | null;
  explanation: string;
  /** Clicks left out because a mail scanner or link previewer made them. */
  excludedScannerClicks: number;
};

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const twoSided = (z: number) => Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));

/** Two-proportion z-test (pooled) with an unpooled 95% interval for pB - pA. */
export function proportionTest(successA: number, totalA: number, successB: number, totalB: number) {
  const pA = successA / totalA;
  const pB = successB / totalB;
  const pooled = (successA + successB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  const z = se === 0 ? 0 : (pB - pA) / se;
  const seDiff = Math.sqrt(pA * (1 - pA) / totalA + pB * (1 - pB) / totalB);
  return { difference: pB - pA, pValue: se === 0 ? 1 : twoSided(z), interval: [pB - pA - 1.96 * seDiff, pB - pA + 1.96 * seDiff] as [number, number] };
}

/** Welch's test on per-contact values, large-sample normal approximation (each arm has at least 100 contacts). */
export function meanTest(a: number[], b: number[]) {
  const stats = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    return { mean, variance, n: values.length };
  };
  const sa = stats(a);
  const sb = stats(b);
  const se = Math.sqrt(sa.variance / sa.n + sb.variance / sb.n);
  const difference = sb.mean - sa.mean;
  return { difference, pValue: se === 0 ? 1 : twoSided(difference / se), interval: [difference - 1.96 * se, difference + 1.96 * se] as [number, number] };
}

type Outcome = { arm: 'a' | 'b'; success: boolean; revenue: number };

/** Judges one split. A winner needs the minimum sample in both arms, enough events, and p below alpha. */
export function judgeExperiment(input: { metric: ExperimentMetric; outcomes: Outcome[] }) {
  const arms = (['a', 'b'] as const).map(arm => {
    const rows = input.outcomes.filter(row => row.arm === arm);
    const successes = rows.filter(row => row.success).length;
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    return { arm, allocated: rows.length, successes, rate: rows.length ? successes / rows.length : 0, revenue, revenuePerContact: rows.length ? revenue / rows.length : 0 };
  }) as [ExperimentArm, ExperimentArm];
  const [a, b] = arms;
  const { minimumPerArm, minimumEvents, alpha } = experimentRules;
  const base = { arms, pValue: null, difference: null, interval: null } as const;
  if (a.allocated < minimumPerArm || b.allocated < minimumPerArm) {
    return { ...base, verdict: 'collecting' as const, explanation: `Collecting: each path needs at least ${minimumPerArm} contacts (A has ${a.allocated}, B has ${b.allocated}).` };
  }
  // The normal approximation needs at least a handful of successes and failures in each path.
  const sparse = input.metric === 'revenue'
    ? a.successes + b.successes < minimumEvents * 2
    : Math.min(a.successes, b.successes, a.allocated - a.successes, b.allocated - b.successes) < minimumEvents;
  if (sparse) {
    return { ...base, verdict: 'inconclusive' as const, explanation: `Inconclusive: too few outcomes to compare (A ${a.successes}, B ${b.successes}; each path needs at least ${minimumEvents}).` };
  }
  const test = input.metric === 'revenue'
    ? meanTest(input.outcomes.filter(row => row.arm === 'a').map(row => row.revenue), input.outcomes.filter(row => row.arm === 'b').map(row => row.revenue))
    : proportionTest(a.successes, a.allocated, b.successes, b.allocated);
  const p = test.pValue;
  if (p >= alpha) {
    return { arms, ...test, verdict: 'inconclusive' as const, explanation: `Inconclusive: the difference could be chance (p = ${p.toFixed(3)}, needs below ${alpha}). Keep both paths or let more contacts through.` };
  }
  const winner = test.difference > 0 ? 'b' : 'a';
  return { arms, ...test, verdict: winner === 'a' ? 'a_wins' as const : 'b_wins' as const, explanation: `Path ${winner.toUpperCase()} performs better (p = ${p < 0.001 ? '< 0.001' : p.toFixed(3)}).` };
}
