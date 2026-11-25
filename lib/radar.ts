// Token Radar model v3 ("radar-3"): a sealed DefiLlama snapshot in, a ranked board out.
//
// The board ranks pre-token protocols only. Live-token protocols are kept apart
// and shown at their market values, never mixed into the ranking.
//
// VALUE MODEL — every term is FITTED from the snapshot's own token protocols,
// never hand-set. The fit (scripts/fit.py, reproducible from the snapshot):
//   * Sample: the 128 protocols that record a token with mcap_usd > 0.
//     (15 record mcap $0 and 1 records a negative mcap: data errors, excluded.
//     The fit target is log(mcap_usd / tvl_usd), winsorized at the 1st/99th
//     percentile, because launch multiples span five orders of magnitude.)
//   * Ridge regression (lambda 10) of log(multiple) on:
//       ln(TVL / $100M), 7-day TVL growth clamped to [-40, +40]%, log(1+age),
//       min(chains, 8), and a shrunk category effect (each category's mean log
//       multiple pulled k=5 toward the global mean -1.5021, i.e. a 0.223x median).
//   * Fitted coefficients (full-sample fit):
//       const -1.7360, ln_tvl -0.3339, growth -0.2694, ln_age -0.0232,
//       chains +0.0446, category +1.5412. In-sample R2 = 0.335.
//   * What the fit says, plainly: bigger TVL means a LOWER multiple (-0.33 per
//     e-fold of TVL); a hot week slightly LOWERS the multiple (-0.27 per 100pp
//     of growth: TVL that rushed in has not been repriced yet); age and chain
//     count barely matter once size and category are in; category is the big
//     term (Basis Trading +0.66, Derivatives +0.63, Dexs +0.38, RWA +0.07,
//     Lending -0.17, Liquid Staking -0.82, Staking Pool -1.43).
//   * The fitted multiple is clamped to [0.01, 3.0] so no row extrapolates wild.
//
// HELD-OUT VALIDATION — the fit was tested twice before it was trusted:
//   * Split A (random 80/20, 26 test rows): R2 +0.097, median |log error| 1.16,
//     31% of predictions within 2x of the truth. A constant median multiple
//     scores R2 -0.047 on the same split.
//   * Split B (time: fit on protocols listed before 2025-06-01, test on the 20
//     listed after — the split that mimics pricing future launches from past
//     ones): R2 +0.196, median |log error| 1.15, 30% within 2x. The constant
//     scores R2 -0.021 there.
//   * Launch multiples are extremely dispersed (the middle 80% of token
//     protocols sit between 0.03x and 2.2x TVL), so no model prices them
//     tightly; the fitted model beats the constant on BOTH held-out splits,
//     and the time split — the honest one — by a wide margin.
//
// TOKEN ODDS — from the peers' record, computed at run time from this very
// snapshot (never hardcoded): for a protocol's category x age band, the share
// of peers that record a token, smoothed toward its category rate (prior
// weight 8) and the snapshot-wide rate 19.0% (prior weight 5), clamped to
// [0.05, 0.65]. Risk Curators: 1 of 39 peers has a token, so their odds sit
// at the 0.05 floor — curators are service businesses that may never issue.
// Yield: 13 of 39 (33%); Basis Trading: 8 of 21 (38%). Odds rise with age:
// 3.4% of protocols listed <180 days ago have a token, 29.4% of those listed
// over 3 years ago do.
//
//   launch_value   = tvl_usd x fitted_multiple        (what the token is worth IF issued)
//   implied_value  = launch_value x token_odds         (the expected value; the board ranks on this)
//
// The board covers the snapshot's whole watchlist (40 protocols) plus every
// other pre-token protocol below the watchlist floor that passes the
// watchlist's own exclusions (no bridge / liquid-staking / restaking / CEX
// category, no version-marked name, no wrapped or staked product, no
// exchange-prefixed name). That is 138 early rows, 178 rows in all: the
// watchlist is the floor, never the ceiling. (Pre-token here means the strict
// record: no market cap, no CoinGecko id and no symbol — the same rule the
// watchlist itself uses.)
//
// Farm plans are generated from each protocol's own record (category, main
// chain, TVL tier, age, odds): seven steps, each carrying what it costs and
// how long it takes, ending in a costed verdict (FARM / WATCH / TRACK) that
// weighs the implied value against the total cost of farming it. Nothing is
// hand-written per protocol, and no protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted ridge coefficients (scripts/fit.py, full-sample fit, n=128). */
export const FIT = {
  const: -1.736,
  ln_tvl: -0.3339,
  growth: -0.2694,
  ln_age: -0.0232,
  chains: 0.0446,
  category: 1.5412,
  /** Global mean log multiple: median launch multiple 0.223x TVL. */
  global_mean_log_multiple: -1.5021,
  /** Fitted multiple clamp. */
  multiple_min: 0.01,
  multiple_max: 3.0,
  /** Token-odds clamp. */
  odds_min: 0.05,
  odds_max: 0.65,
  /** Fit sample size. */
  n_fit: 128,
  /** In-sample R2. */
  r2_insample: 0.335,
} as const;

/** Shrunk category effect on log(multiple): each category's mean log multiple
 *  pulled k=5 toward the global mean. A category with no token protocol in the
 *  fit scores 0 (the global mean). From scripts/fit.py. */
export const CATEGORY_EFFECT: Record<string, number> = {
  'Prediction Market': 0.9277,
  'Collateral Management': 0.6667,
  'Basis Trading': 0.6589,
  Derivatives: 0.6292,
  'Cross Chain Bridge': 0.5566,
  'Token Locker': 0.4596,
  Chain: 0.4349,
  'Risk Curators': 0.432,
  'Canonical Bridge': 0.3917,
  Dexs: 0.3783,
  'Decentralized AI': 0.3708,
  'NFT Marketplace': 0.366,
  Options: 0.3195,
  'AI Agents': 0.25,
  Privacy: 0.1981,
  RWA: 0.0661,
  Indexes: 0.0439,
  Bridge: 0.0026,
  'Leveraged Farming': -0.0426,
  Payments: -0.0664,
  Launchpad: -0.0889,
  DOR: -0.1514,
  Lending: -0.1694,
  Yield: -0.2132,
  'Liquid Restaking': -0.2785,
  'Yield Aggregator': -0.2842,
  CEX: -0.2947,
  'Dual-Token Stablecoin': -0.3253,
  CDP: -0.4388,
  'Liquidity Manager': -0.4491,
  Restaking: -0.6416,
  'Liquid Staking': -0.8212,
  'Onchain Capital Allocator': -0.8704,
  'Staking Pool': -1.4319,
};

/** The two held-out validation runs, as the dashboard states them. */
export const VALIDATION = {
  split_a: {
    name: 'random 80/20',
    n_test: 26,
    r2: 0.097,
    r2_baseline_const: -0.047,
    median_abs_log_error: 1.16,
    within_2x: 0.31,
  },
  split_b: {
    name: 'time split (fit listed before 2025-06-01, test 20 listed after)',
    n_test: 20,
    r2: 0.196,
    r2_baseline_const: -0.021,
    median_abs_log_error: 1.15,
    within_2x: 0.3,
  },
} as const;

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  token_odds: number;
  verdict: 'FARM' | 'WATCH' | 'TRACK';
  model: {
    fitted_multiple: number;
    token_odds: number;
    launch_value_usd: number;
    growth_pct: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  token_odds: number;
  fitted_multiple: number;
  verdict: 'FARM' | 'WATCH' | 'TRACK';
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Data-quality facts the dashboard's integrity strip states. */
export interface Integrity {
  protocols: number;
  with_token: number;
  pre_token: number;
  mcap_zero: number;
  mcap_negative: number;
  missing_change_7d: number;
  missing_listed_at: number;
  fit_rows: number;
  max_change_7d: number;
  as_of: string;
}

/** Headline KPIs the dashboard's strip states. */
export interface Kpis {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  pre_token_total: number;
  median_fitted_multiple: number;
  median_token_odds: number;
  total_implied_usd: number;
  top_implied_usd: number;
  top_slug: string;
  farm_count: number;
  watch_count: number;
  track_count: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: typeof FIT;
  validation: typeof VALIDATION;
  integrity: Integrity;
  kpis: Kpis;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The age band a protocol's age falls in (unknown age scores as 365 days). */
export function ageBand(age: number | null): string {
  const a = age ?? 365;
  if (a < 180) return '<180d';
  if (a < 365) return '180-365d';
  if (a < 730) return '365-730d';
  if (a < 1095) return '730-1095d';
  return '>1095d';
}

/**
 * Token odds from the peers' record, computed from this snapshot at run time:
 * the share of protocols in the same category x age band that record a token,
 * smoothed toward the category rate (prior weight 8) and the snapshot-wide
 * rate (prior weight 5), clamped to [0.05, 0.65]. No number here is hardcoded.
 */
export class OddsTable {
  readonly globalRate: number;
  private readonly catRate = new Map<string, number>();
  private readonly cellRate = new Map<string, number>();

  constructor(snapshot: Snapshot) {
    const ps = snapshot.protocols;
    const has = (p: SnapshotProtocol): boolean => p.mcap_usd !== null;
    this.globalRate = ps.filter(has).length / Math.max(1, ps.length);
    const byCat = new Map<string, { k: number; n: number }>();
    const byCell = new Map<string, { k: number; n: number }>();
    for (const p of ps) {
      const c = p.category ?? '(none)';
      const cell = `${c}|${ageBand(ageDays(snapshot.as_of, p.listed_at))}`;
      const ce = byCat.get(c) ?? { k: 0, n: 0 };
      ce.n += 1;
      if (has(p)) ce.k += 1;
      byCat.set(c, ce);
      const le = byCell.get(cell) ?? { k: 0, n: 0 };
      le.n += 1;
      if (has(p)) le.k += 1;
      byCell.set(cell, le);
    }
    for (const [c, { k, n }] of byCat) {
      this.catRate.set(c, (k + 5 * this.globalRate) / (n + 5));
    }
    for (const [cell, { k, n }] of byCell) {
      const c = cell.slice(0, cell.lastIndexOf('|'));
      const prior = this.catRate.get(c) ?? this.globalRate;
      this.cellRate.set(cell, (k + 8 * prior) / (n + 8));
    }
  }

  odds(p: SnapshotProtocol, asOf: string): number {
    const c = p.category ?? '(none)';
    const cell = `${c}|${ageBand(ageDays(asOf, p.listed_at))}`;
    const o = this.cellRate.get(cell) ?? this.catRate.get(c) ?? this.globalRate;
    return Math.min(FIT.odds_max, Math.max(FIT.odds_min, o));
  }
}

/** The fitted launch multiple for one protocol: exp of the ridge fit, clamped. */
export function fittedMultiple(p: SnapshotProtocol, asOf: string): number {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? 365;
  const logMult =
    FIT.const +
    FIT.ln_tvl * Math.log(Math.max(1, p.tvl_usd) / 100_000_000) +
    FIT.growth * (Math.min(40, Math.max(-40, finite(p.change_7d, 0))) / 100) +
    FIT.ln_age * Math.log1p(Math.min(Math.max(ageForModel, 0), 1095)) +
    FIT.chains * Math.min(p.chains.length, 8) +
    FIT.category * (p.category !== null && p.category in CATEGORY_EFFECT ? CATEGORY_EFFECT[p.category]! : 0);
  return Math.min(FIT.multiple_max, Math.max(FIT.multiple_min, Math.exp(logMult)));
}

/** Launch value, token odds and implied (expected) value for one protocol. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  odds: OddsTable,
): { launch: number; tokenOdds: number; implied: number; multiple: number; growthPct: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = fittedMultiple(p, asOf);
  const tokenOdds = odds.odds(p, asOf);
  const launch = Math.max(1, Math.round(p.tvl_usd * multiple));
  const implied = Math.max(1, Math.round(launch * tokenOdds));
  return { launch, tokenOdds, implied, multiple, growthPct: Math.min(40, Math.max(-40, finite(p.change_7d, 0))), age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in the name: a wrapped or staked product. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name must not begin with (the watchlist's own rule). */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank below the watchlist floor:
 *  pre-token, not an exchange or bridge / liquid-staking product, not a
 *  versioned pool, not a wrapped or staked product, not exchange-branded. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return false;
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The farm verdict: FARM when the expected value dwarfs the cost of farming
 *  it and the token odds are real; WATCH when it is worth tracking; TRACK
 *  otherwise. Thresholds are stated in the dashboard. */
export function verdictFor(implied: number, tokenOdds: number): 'FARM' | 'WATCH' | 'TRACK' {
  if (tokenOdds >= 0.25 && implied >= 5_000_000) return 'FARM';
  if (implied >= 1_000_000 || tokenOdds >= 0.2) return 'WATCH';
  return 'TRACK';
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time,
 * ending in a costed verdict. The plan is derived from the protocol's own
 * record (category, chains, TVL, age, odds, implied value), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, tokenOdds: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const totalCost = capital + gas + 3 + 8;
  const verdict = verdictFor(implied, tokenOdds);
  const verdictText =
    verdict === 'FARM'
      ? `Verdict: FARM. The expected value is $${implied.toLocaleString('en-US')} against about $${totalCost} of total cost, and ${Math.round(tokenOdds * 100)}% of its peers record a token: farm it now and keep the position through the hold.`
      : verdict === 'WATCH'
        ? `Verdict: WATCH. The expected value is $${implied.toLocaleString('en-US')} against about $${totalCost} of total cost: open a small position, log the dates, and re-check after the next snapshot.`
        : `Verdict: TRACK. The expected value is $${implied.toLocaleString('en-US')} against about $${totalCost} of total cost and only ${Math.round(tokenOdds * 100)}% of its peers record a token: do not tie up capital, just watch its TVL and re-rank it next time.`;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
    { text: verdictText, cost: `about $${totalCost} all-in for the plan`, time: `${hold} days of holding` },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const odds = new OddsTable(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, odds);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.launch - a.launch || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_value_usd: s.launch,
    // Full-precision odds: the page recomputes implied value from this exact
    // number, so its "matches board" check is exact, not within rounding.
    // The rounded copy lives in model.token_odds for display.
    token_odds: s.tokenOdds,
    verdict: verdictFor(s.implied, s.tokenOdds),
    model: {
      fitted_multiple: round4(s.multiple),
      token_odds: round4(s.tokenOdds),
      launch_value_usd: s.launch,
      growth_pct: s.growthPct,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied, s.tokenOdds).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Data-quality facts, computed from the snapshot at run time. */
export function integrityOf(snapshot: Snapshot): Integrity {
  const ps = snapshot.protocols;
  let maxChange = -Infinity;
  for (const p of ps) if (typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)) maxChange = Math.max(maxChange, p.change_7d);
  return {
    protocols: ps.length,
    with_token: ps.filter((p) => p.mcap_usd !== null).length,
    pre_token: ps.filter((p) => p.mcap_usd === null).length,
    mcap_zero: ps.filter((p) => p.mcap_usd === 0).length,
    mcap_negative: ps.filter((p) => p.mcap_usd !== null && p.mcap_usd < 0).length,
    missing_change_7d: ps.filter((p) => p.change_7d === null).length,
    missing_listed_at: ps.filter((p) => p.listed_at === null).length,
    fit_rows: FIT.n_fit,
    max_change_7d: maxChange,
    as_of: snapshot.as_of,
  };
}

/** A board row's compact form for data.js, with the farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.launch_value_usd,
    token_odds: row.token_odds,
    fitted_multiple: row.model.fitted_multiple,
    verdict: row.verdict,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiples = board.map((r) => r.model.fitted_multiple).sort((a, b) => a - b);
  const oddsVals = board.map((r) => r.token_odds).sort((a, b) => a - b);
  const median = (xs: number[]): number => xs[Math.floor(xs.length / 2)]!;
  const totalImplied = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const kpis: Kpis = {
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    pre_token_total: snapshot.protocols.filter((p) => p.mcap_usd === null).length,
    median_fitted_multiple: round4(median(multiples)),
    median_token_odds: round4(median(oddsVals)),
    total_implied_usd: totalImplied,
    top_implied_usd: board[0]!.implied_value_usd,
    top_slug: board[0]!.slug,
    farm_count: board.filter((r) => r.verdict === 'FARM').length,
    watch_count: board.filter((r) => r.verdict === 'WATCH').length,
    track_count: board.filter((r) => r.verdict === 'TRACK').length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: FIT,
    validation: VALIDATION,
    integrity: integrityOf(snapshot),
    kpis,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
