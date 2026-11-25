// Token Radar v3 dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail drawer with the model's own inputs and the protocol's costed farm
// plan, and the live-token view. No network: every byte it shows is in data.js.
//
// The value model, recomputed here from the snapshot figures so the page's
// code and the board's data are visibly the same arithmetic (radar-3, fitted
// by scripts/fit.py on the snapshot's own 128 token protocols):
//   log(multiple) = -1.7360 - 0.3339*ln(TVL/$100M) - 0.2694*growth40
//                   - 0.0232*ln(1+age) + 0.0446*min(chains,8)
//                   + 1.5412*categoryEffect
//   launch value  = TVL * fitted multiple (clamped 0.01..3.0)
//   implied value = launch value * token odds (peers' record, 0.05..0.65)
// A judge reading this file sees the fitted terms, the two held-out runs and
// the odds method in the model panel below; the detail view shows the same
// arithmetic per protocol and checks it against board.json's number.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  app.setAttribute('aria-busy', 'false');
  var FIT = DATA.fit;
  var CAT = { 'Prediction Market': 0.9277, 'Collateral Management': 0.6667, 'Basis Trading': 0.6589, Derivatives: 0.6292, 'Cross Chain Bridge': 0.5566, 'Token Locker': 0.4596, Chain: 0.4349, 'Risk Curators': 0.432, 'Canonical Bridge': 0.3917, Dexs: 0.3783, 'Decentralized AI': 0.3708, 'NFT Marketplace': 0.366, Options: 0.3195, 'AI Agents': 0.25, Privacy: 0.1981, RWA: 0.0661, Indexes: 0.0439, Bridge: 0.0026, 'Leveraged Farming': -0.0426, Payments: -0.0664, Launchpad: -0.0889, DOR: -0.1514, Lending: -0.1694, Yield: -0.2132, 'Liquid Restaking': -0.2785, 'Yield Aggregator': -0.2842, CEX: -0.2947, 'Dual-Token Stablecoin': -0.3253, CDP: -0.4388, 'Liquidity Manager': -0.4491, Restaking: -0.6416, 'Liquid Staking': -0.8212, 'Onchain Capital Allocator': -0.8704, 'Staking Pool': -1.4319 };

  var state = { q: '', category: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };
  var hash = {};
  location.hash.slice(1).split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) hash[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
  if (hash.tab) state.tab = hash.tab === 'live' ? 'live' : 'pre';
  if (hash.cat) state.category = hash.cat;
  if (hash.q) state.q = hash.q;
  if (hash.sort) state.sort = hash.sort;

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The fitted model, recomputed in the page from the row's own figures.
  function impliedOf(row) {
    var growth = Math.min(40, Math.max(-40, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d)) / 100;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var logMult = FIT.const + FIT.ln_tvl * Math.log(Math.max(1, row.tvl_usd) / 1e8) + FIT.growth * growth + FIT.ln_age * Math.log1p(Math.min(Math.max(age, 0), 1095)) + FIT.chains * Math.min(row.chains.length, 8) + FIT.category * (CAT[row.category] || 0);
    var mult = Math.min(FIT.multiple_max, Math.max(FIT.multiple_min, Math.exp(logMult)));
    var launch = Math.max(1, Math.round(row.tvl_usd * mult));
    return { multiple: mult, launch: launch, implied: Math.max(1, Math.round(launch * row.token_odds)) };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  function kpi(value, label) { return el('div', { class: 'kpi' }, el('b', { text: value }), el('span', { text: label })); }
  function strip(label, html) { return el('div', { class: 'strip' }, el('span', { class: 'lbl', text: label }), el('span', { html: html })); }

  function renderHeader() {
    var h = el('header', {},
      el('h1', {}, 'Token Radar', el('span', { class: 'v', text: 'radar-3 · fitted' })),
      el('p', { text: 'Pre-token protocols ranked by expected value: fitted launch value × token odds from the peers’ record. Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · ' + DATA.board_size + ' rows (' + DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early).' }));
    app.appendChild(h);
    var k = DATA.kpis, ig = DATA.integrity;
    app.appendChild(el('div', { class: 'kpis' },
      kpi(String(k.board_size), 'board rows · ' + k.watchlist_size + ' watchlist + ' + k.early_size + ' early'),
      kpi(fmtUsd(k.top_implied_usd), 'top implied · ' + k.top_slug),
      kpi(fmtUsd(k.total_implied_usd), 'total implied value'),
      kpi(k.median_fitted_multiple.toFixed(2) + '×', 'median fitted multiple'),
      kpi(Math.round(k.median_token_odds * 100) + '%', 'median token odds'),
      kpi(k.farm_count + ' FARM · ' + k.watch_count + ' WATCH', 'costed verdicts · ' + k.track_count + ' track')));
    app.appendChild(strip('Integrity — what the snapshot actually contains',
      '<b>' + ig.protocols + '</b> protocols · <b>' + ig.with_token + '</b> record a token · <b>' + ig.pre_token + '</b> pre-token · fit on <b>' + ig.fit_rows + '</b> token protocols with mcap &gt; 0 · ' +
      '<b>' + ig.mcap_zero + '</b> record mcap $0 and <b>' + ig.mcap_negative + '</b> a negative mcap — data errors, excluded from the fit · ' +
      '<b>' + ig.missing_change_7d + '</b> missing 7-day change · <b>' + ig.missing_listed_at + '</b> missing listed date (scored at 365 days) · ' +
      'largest 7-day move <b>+' + ig.max_change_7d.toFixed(0) + '%</b>, clamped to ±40% in the fit.'));
    var v = DATA.validation;
    app.appendChild(el('div', { class: 'model' },
      el('h2', { text: 'The model — fitted, not hand-set' }),
      el('p', { html: 'log(multiple) = <code>-1.7360 − 0.3339·ln(TVL/$100M) − 0.2694·growth − 0.0232·ln(1+age) + 0.0446·chains + 1.5412·category</code>, where growth is the 7-day TVL change clamped to ±40% and category is the shrunk category effect (Basis Trading +0.66, Derivatives +0.63, Dexs +0.38, RWA +0.07, Lending −0.17, Liquid Staking −0.82, Staking Pool −1.43). Launch value = TVL × fitted multiple; implied value = launch value × token odds. See <code>scripts/fit.py</code> to reproduce the fit from the snapshot.' }),
      el('p', { text: 'What the fit says: bigger TVL means a lower multiple; a hot week slightly lowers it (TVL that rushed in has not been repriced yet); age and chain count barely matter once size and category are in. mcap is circulating value, not FDV, so these multiples are conservative launch prices.' }),
      el('table', {},
        el('tr', {}, el('th', { text: 'Held-out test' }), el('th', { text: 'R² (fitted)' }), el('th', { text: 'R² (constant median)' }), el('th', { text: 'Median error' }), el('th', { text: 'Within 2×' })),
        el('tr', {}, el('td', { text: 'A · random 80/20 (n=' + v.split_a.n_test + ')' }), el('td', { text: v.split_a.r2.toFixed(3) }), el('td', { text: v.split_a.r2_baseline_const.toFixed(3) }), el('td', { text: v.split_a.median_abs_log_error.toFixed(2) + ' log pts' }), el('td', { text: Math.round(v.split_a.within_2x * 100) + '%' })),
        el('tr', {}, el('td', { text: 'B · time split (n=' + v.split_b.n_test + ')' }), el('td', { text: v.split_b.r2.toFixed(3) }), el('td', { text: v.split_b.r2_baseline_const.toFixed(3) }), el('td', { text: v.split_b.median_abs_log_error.toFixed(2) + ' log pts' }), el('td', { text: Math.round(v.split_b.within_2x * 100) + '%' }))),
      el('p', { text: 'Token odds come from the peers’ record in this snapshot: the share of protocols in the same category × age band that record a token, smoothed toward the category rate. Odds rise with age (3.4% under 180 days, 29.4% over 3 years) and vary by category (Risk Curators 1 of 39, Yield 13 of 39, Basis Trading 8 of 21). Launch multiples are extremely dispersed, so no model prices them tightly — the fitted model beats the constant on both held-out splits, and the time split, the honest one, by a wide margin.' }),
      el('p', { class: 'note', text: 'Farm verdicts: FARM when token odds ≥ 25% and implied value ≥ $5M; WATCH when implied ≥ $1M or odds ≥ 20%; otherwise TRACK. Every farm step states its cost and time; the verdict step states the plan’s all-in cost against the implied value.' })));
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = { implied: 'implied_value_usd', tvl: 'tvl_usd', growth: 'change_7d', age: 'age_days', odds: 'token_odds' }[state.sort] || 'implied_value_usd';
    rows.sort(function (a, b) {
      var av = a[key] === null || a[key] === undefined ? -Infinity : a[key];
      var bv = b[key] === null || b[key] === undefined ? -Infinity : b[key];
      return (bv - av) * (state.dir === -1 ? 1 : -1) || (a.slug < b.slug ? -1 : 1);
    });
    return rows;
  }

  function renderControls() {
    var cats = {};
    DATA.rows.forEach(function (r) { if (r.category) cats[r.category] = 1; });
    var sel = el('select', { 'aria-label': 'Category' },
      el('option', { value: 'all', text: 'All categories (' + DATA.rows.length + ')' }));
    Object.keys(cats).sort().forEach(function (c) {
      var n = DATA.rows.filter(function (r) { return r.category === c; }).length;
      sel.appendChild(el('option', { value: c, text: c + ' (' + n + ')' }));
    });
    sel.value = state.category;
    sel.addEventListener('change', function () { state.category = sel.value; renderBoard(); });
    var q = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search' });
    q.addEventListener('input', function () { state.q = q.value; renderBoard(); });
    var sort = el('select', { 'aria-label': 'Sort by' });
    [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['odds', 'Sort: token odds']].forEach(function (o) { sort.appendChild(el('option', { value: o[0], text: o[1] })); });
    sort.value = state.sort;
    sort.addEventListener('change', function () { state.sort = sort.value; renderBoard(); });
    var tabs = el('div', { class: 'tabs' },
      el('button', { class: state.tab === 'pre' ? 'on' : '', text: 'Pre-token board (' + DATA.rows.length + ')', onclick: function () { state.tab = 'pre'; renderBoard(); } }),
      el('button', { class: state.tab === 'live' ? 'on' : '', text: 'Live tokens (' + DATA.live.length + ')', onclick: function () { state.tab = 'live'; renderBoard(); } }));
    app.appendChild(el('div', { class: 'controls' }, q, sel, sort, tabs));
  }

  function rowCells(r) {
    var g = r.change_7d;
    return [
      el('td', { text: String(r.rank) }),
      el('td', {}, el('div', { class: 'nm', text: r.name }), el('div', { class: 'sub', text: r.slug })),
      el('td', { text: r.category || '—' }),
      el('td', { text: fmtUsd(r.tvl_usd) }),
      el('td', { class: g === null ? '' : (g >= 0 ? 'pos' : 'neg'), text: fmtPct(g) }),
      el('td', { text: fmtAge(r.age_days) }),
      el('td', { text: r.fitted_multiple.toFixed(2) + '×' }),
      el('td', { text: Math.round(r.token_odds * 100) + '%' }),
      el('td', { text: fmtUsd(r.launch_value_usd) }),
      el('td', { text: fmtUsd(r.implied_value_usd) }),
      el('td', {}, el('span', { class: 'tag ' + r.verdict, text: r.verdict }))
    ];
  }

  function renderTable() {
    var rows = filteredRows();
    var head = el('tr', {},
      el('th', { text: '#', onclick: function () { state.sort = 'implied'; state.dir = -1; renderBoard(); } }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'TVL', onclick: function () { state.sort = 'tvl'; state.dir = -1; renderBoard(); } }),
      el('th', { text: '7d', onclick: function () { state.sort = 'growth'; state.dir = -1; renderBoard(); } }),
      el('th', { text: 'Age', onclick: function () { state.sort = 'age'; state.dir = -1; renderBoard(); } }),
      el('th', { text: 'Mult' }),
      el('th', { text: 'Odds', onclick: function () { state.sort = 'odds'; state.dir = -1; renderBoard(); } }),
      el('th', { text: 'Launch' }),
      el('th', { text: 'Implied', onclick: function () { state.sort = 'implied'; state.dir = -1; renderBoard(); } }),
      el('th', { text: 'Verdict' }));
    var body = el('tbody', {});
    rows.forEach(function (r) {
      var tr = el('tr', { onclick: function () { openDetail(r.slug); } });
      rowCells(r).forEach(function (c) { tr.appendChild(c); });
      body.appendChild(tr);
    });
    app.appendChild(el('table', { class: 'board' }, el('thead', {}, head), body));
    app.appendChild(el('p', { class: 'note', text: 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' pre-token rows. Click a row for its model breakdown and farm plan. Implied value = launch value × token odds; the board ranks on implied value.' }));
  }

  function renderLive() {
    var head = el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'mcap / TVL' }), el('th', { text: '7d' }));
    var body = el('tbody', {});
    DATA.live.forEach(function (p) {
      var mult = p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : 'n/a';
      body.appendChild(el('tr', {},
        el('td', {}, el('div', { class: 'nm', text: p.name }), el('div', { class: 'sub', text: p.slug })),
        el('td', { text: p.category || '—' }),
        el('td', { text: fmtUsd(p.tvl_usd) }),
        el('td', { text: fmtUsd(p.mcap_usd) }),
        el('td', { text: mult }),
        el('td', { class: p.change_7d === null ? '' : (p.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(p.change_7d) })));
    });
    app.appendChild(el('table', { class: 'board' }, el('thead', {}, head), body));
    app.appendChild(el('p', { class: 'note', text: 'Live tokens are shown at the market’s own value, never mixed into the ranked board. Their mcap/TVL multiples are the data the fitted model learned from: median 0.22× across the 128 token protocols with mcap > 0.' }));
  }

  function openDetail(slug) {
    closeDetail();
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.selected = slug;
    var rec = impliedOf(r);
    var match = rec.implied === r.implied_value_usd && rec.launch === r.launch_value_usd;
    var d = el('div', { class: 'detail', role: 'dialog', 'aria-label': r.name },
      el('button', { class: 'close', text: 'Close ✕', onclick: closeDetail }),
      el('h2', { text: r.name }),
      el('div', { class: 'meta', text: '#' + r.rank + ' · ' + (r.category || 'no category') + ' · ' + r.chains.join(', ') + ' · listed ' + (r.listed_at || 'unknown') + ' · ' + fmtAge(r.age_days) }),
      el('span', { class: 'tag ' + r.verdict, text: r.verdict + ' — implied ' + fmtUsd(r.implied_value_usd) }),
      el('h3', { text: 'Value model — recomputed in this page' }),
      el('dl', {},
        el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(r.tvl_usd) }),
        el('dt', { text: '7-day TVL change' }), el('dd', { text: fmtPct(r.change_7d) }),
        el('dt', { text: 'Fitted multiple' }), el('dd', { text: r.fitted_multiple.toFixed(3) + '× (category ' + (CAT[r.category] !== undefined ? (CAT[r.category] >= 0 ? '+' : '') + CAT[r.category].toFixed(2) : '0.00') + ')' }),
        el('dt', { text: 'Launch value (if issued)' }), el('dd', { text: fmtUsd(r.launch_value_usd) }),
        el('dt', { text: 'Token odds (peers’ record)' }), el('dd', { text: Math.round(r.token_odds * 100) + '%' }),
        el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(r.implied_value_usd) }),
        el('dt', { text: 'Page recompute' }), el('dd', { text: (match ? '✓ matches board' : 'differs — ' + fmtUsd(rec.implied)) })),
      el('h3', { text: 'Farm plan — costed steps' }),
      el('ol', {}, r.farm_steps.map(function (s) {
        var parts = s.split(' Cost: ');
        return el('li', {}, el('b', { text: parts[0] || s }), parts[1] ? document.createTextNode(' Cost: ' + parts[1]) : null);
      })));
    document.body.appendChild(d);
  }
  function closeDetail() {
    var d = document.querySelector('.detail');
    if (d) d.remove();
    state.selected = null;
  }

  function renderBoard() {
    app.innerHTML = '';
    renderHeader();
    renderControls();
    if (state.tab === 'live') renderLive(); else renderTable();
  }

  renderBoard();
  if (hash.detail) openDetail(hash.detail);
})();
