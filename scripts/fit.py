#!/usr/bin/env python3
"""Fit the token-radar-03 launch-pricing model from the sealed snapshot.

Usage: python3 scripts/fit.py [--input path/to/snapshot.json]

Reproduces the fitted coefficients hardcoded in lib/radar.ts (FIT and
CATEGORY_EFFECT) and the two held-out validation runs quoted in the
dashboard and README. Requires numpy + pandas.

Method
------
Sample: protocols that record a token with mcap_usd > 0 (n=128 of 144;
15 record mcap $0 and 1 records a negative mcap: data errors, excluded).
Target: y = log(mcap_usd / tvl_usd), winsorized at the 1st/99th percentile.
Features: ln(TVL/$100M), 7-day TVL growth clamped to [-40,+40]% (/100),
log(1+age_days capped at 1095), min(chains, 8), and a shrunk category
effect: each category's mean y pulled k=5 toward the global mean.
Fit: ridge regression, lambda=10 (intercept unpenalized).

Held-out runs
-------------
A: random 80/20 split (seed 7, 26 test rows).
B: time split — fit on protocols listed before 2025-06-01, test on the 20
   listed on or after it. This mimics pricing future launches from past ones.
Baseline in both: the constant median multiple.
"""
import argparse
import json

import numpy as np
import pandas as pd

GLOBAL_PRIOR = 5  # category-effect shrinkage weight toward the global mean


def cat_effect(train_y, train_cat, k=GLOBAL_PRIOR):
    gm = train_y.mean()
    out = {}
    for c, s in train_y.groupby(train_cat):
        n = len(s)
        out[c] = (s.sum() + k * gm) / (n + k) - gm
    return out, gm


def build_X(frame, ce):
    X = pd.DataFrame(index=frame.index)
    X["ln_tvl"] = np.log(frame["tvl_usd"] / 1e8)
    X["growth40"] = frame["change_7d"].fillna(0).clip(-40, 40) / 100.0
    X["ln_age"] = np.log1p(frame["age_days"].fillna(365).clip(0, 1095))
    X["chains"] = frame["n_chains"].clip(0, 8)
    X["cat"] = frame["category"].map(ce).fillna(0.0)
    return X


def ridge_fit(X, y, lam=10.0):
    A = np.column_stack([np.ones(len(X))] + [X[c].values for c in X.columns])
    P = np.eye(A.shape[1]) * lam
    P[0, 0] = 0
    return np.linalg.solve(A.T @ A + P, A.T @ y.values)


def ridge_pred(X, beta):
    A = np.column_stack([np.ones(len(X))] + [X[c].values for c in X.columns])
    return A @ beta


def evaluate(name, y_true, y_pred, y_baseline):
    r2 = 1 - ((y_true - y_pred) ** 2).sum() / ((y_true - y_true.mean()) ** 2).sum()
    r2b = 1 - ((y_true - y_baseline) ** 2).sum() / ((y_true - y_true.mean()) ** 2).sum()
    ratio = np.exp(y_pred - y_true)
    print(
        f"{name}: R2={r2:+.3f} (constant baseline {r2b:+.3f})  "
        f"median |log err|={np.median(np.abs(np.log(ratio))):.2f}  "
        f"within 2x={np.mean((ratio > 0.5) & (ratio < 2)):.2f}"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="input/snapshot.json")
    args = ap.parse_args()

    with open(args.input) as f:
        d = json.load(f)
    df = pd.DataFrame(d["protocols"])
    as_of = pd.Timestamp(d["as_of"])
    df["age_days"] = (as_of - pd.to_datetime(df["listed_at"], errors="coerce")).dt.days
    df["n_chains"] = df["chains"].str.len()
    tok = df[df["mcap_usd"].notna() & (df["mcap_usd"] > 0) & (df["tvl_usd"] > 0)].copy()
    tok["y"] = np.log(tok["mcap_usd"] / tok["tvl_usd"])
    lo, hi = tok["y"].quantile([0.01, 0.99])
    tok["y"] = tok["y"].clip(lo, hi)
    print(f"fit sample: n={len(tok)} token protocols (mcap>0); y winsorized [{lo:.2f}, {hi:.2f}]")

    ce, gm = cat_effect(tok["y"], tok["category"])
    X = build_X(tok, ce)
    beta = ridge_fit(X, tok["y"])
    print(f"global mean log multiple: {gm:.4f} (median multiple {np.exp(gm):.3f}x TVL)")
    for label, b in zip(["const"] + list(X.columns), beta):
        print(f"  {label}: {b:+.4f}")
    yp = ridge_pred(X, beta)
    r2 = 1 - ((tok["y"] - yp) ** 2).sum() / ((tok["y"] - tok["y"].mean()) ** 2).sum()
    print(f"in-sample R2: {r2:.3f}")

    # Held-out A: random 80/20.
    rng = np.random.default_rng(7)
    idx = rng.permutation(len(tok))
    trd, ted = tok.iloc[idx[:102]], tok.iloc[idx[102:]]
    ce_a, _ = cat_effect(trd["y"], trd["category"])
    b_a = ridge_fit(build_X(trd, ce_a), trd["y"])
    evaluate("held-out A (random 80/20, n=26)", ted["y"].values,
             ridge_pred(build_X(ted, ce_a), b_a), np.full(len(ted), trd["y"].median()))

    # Held-out B: time split.
    tokk = tok[tok["listed_at"].notna()].copy()
    cut = pd.Timestamp("2025-06-01")
    tr_b = tokk[pd.to_datetime(tokk["listed_at"]) < cut]
    te_b = tokk[pd.to_datetime(tokk["listed_at"]) >= cut]
    ce_b, _ = cat_effect(tr_b["y"], tr_b["category"])
    b_b = ridge_fit(build_X(tr_b, ce_b), tr_b["y"])
    evaluate(f"held-out B (time split, n={len(te_b)})", te_b["y"].values,
             ridge_pred(build_X(te_b, ce_b), b_b), np.full(len(te_b), tr_b["y"].median()))


if __name__ == "__main__":
    main()
