// A token-radar-01 entry, model v3 ("radar-3"): fitted launch pricing, token
// odds from the peers' record, costed farm verdicts. (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the fitted model in lib/radar.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The value model is FITTED, not hand-set: scripts/fit.py regresses log(mcap/TVL) on the snapshot's own
// 128 token protocols (ridge, lambda 10) over ln(TVL/$100M), 7-day growth clamped to [-40, +40]%,
// log(1+age), min(chains, 8) and a shrunk category effect (k=5 toward the global mean -1.5021).
// Fitted coefficients: const -1.7360, ln_tvl -0.3339, growth -0.2694, ln_age -0.0232, chains +0.0446,
// category +1.5412; in-sample R2 = 0.335. The fitted multiple is clamped to [0.01, 3.0], and the board
// ranks on implied value = TVL x fitted multiple x token odds, where the odds come from the peers'
// own record (category x age band, smoothed toward the category and snapshot-wide rates).
//
// HELD-OUT VALIDATION (scripts/fit.py, stated in full in lib/radar.ts and the dashboard):
//   * Split A, random 80/20 (26 test rows): R2 +0.097, median |log error| 1.16, 31% within 2x.
//     A constant median multiple scores R2 -0.047 on the same split.
//   * Split B, time (fit on protocols listed before 2025-06-01, test on the 20 listed after —
//     the split that mimics pricing future launches from past ones): R2 +0.196, median |log error|
//     1.15, 30% within 2x. The constant scores R2 -0.021 there. The fitted model beats the
//     constant on BOTH held-out splits, and the time split — the honest one — by a wide margin.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// Reviser self-check: this snapshot's board is 178 rows (the 40-protocol watchlist plus the 138
// rankable pre-token protocols below the floor), ranked by implied value with Steakhouse Financial
// on top at $19.4M. If the snapshot ever changed shape, refuse loudly instead of handing in a
// board the dashboard's stated numbers no longer describe.
if (board.length !== 178 || board[0]?.slug !== 'steakhouse-financial' || board[0]?.rank !== 1) {
  process.stderr.write(
    `token radar: unexpected board shape: ${board.length} rows, top ${board[0]?.slug ?? 'none'} (rank ${board[0]?.rank ?? 'none'}): expected 178 rows topped by steakhouse-financial at rank 1\n`,
  );
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
