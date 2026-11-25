# makefun-token-radar-02

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/LinkZhang/makefun-token-radar-02/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/LinkZhang/makefun-token-radar-02/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar, model v3 ("radar-3"): a fitted launch-pricing model over the sealed DefiLlama snapshot — 178 ranked rows (the 40-protocol watchlist plus 138 rankable pre-token protocols below the floor), topped by Steakhouse Financial at $19.4M implied value. The implied value is TVL × a fitted launch multiple × token odds from the peers' own record, and every row carries a costed farm plan (FARM / WATCH / TRACK).

The multiple is fitted, not hand-set: ridge regression (lambda 10) of log(mcap/TVL) on the snapshot's own 128 token protocols — ln(TVL/$100M), 7-day growth clamped to [-40, +40]%, log(1+age), min(chains, 8) and a shrunk category effect. Fitted coefficients: const -1.7360, ln_tvl -0.3339, growth -0.2694, ln_age -0.0232, chains +0.0446, category +1.5412; in-sample R² = 0.335.

Held-out validation, both splits beating a constant median multiple: (A) random 80/20, 26 test rows — R² +0.097 vs baseline −0.047; (B) time split, fit on protocols listed before 2025-06-01, test on the 20 listed after — R² +0.196 vs baseline −0.021. The time split is the honest one: pricing future launches from past ones. The dashboard states the fit and both results in full, alongside data-integrity facts and headline KPIs.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0d4806qy&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
