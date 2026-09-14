// ===== feed.html: one feed, in full, with the notes behind it =====
//
// One page serves all nine feeds off ?feed=<key>. The alternative was nine near-identical
// HTML files, which is nine places for the nav, the footer and the freshness handling to
// drift apart. Everything about rendering a payload lives in predictions.js and is shared
// with the home page; what is here is the per-project prose and the fuller renderers for
// the feeds whose compact row drops real data.
//
// Repos are private, so a project is NAMED here and not linked. A dead link to a 404 on
// a portfolio page is worse than no link.

// Wrapped in an IIFE: script tags share ONE global scope, so a top-level `const esc`
// here collides with predictions.js's `function esc` and the whole file dies with
// "Identifier 'esc' has already been declared" -- a SyntaxError, so nothing on the page
// renders at all. Caught by the render harness; it would have shipped a blank page.
(function () {
'use strict';

const P = window.Predictions;
const esc = P.esc;

const PROJECTS = {
    nfl: {
        title: 'NFL Game Picks',
        tagline: 'Win probability and predicted margin for every game on the week’s slate.',
        repo: 'nfl-prediction',
        stack: ['Python', 'LightGBM', 'SQLite', 'ESPN public API'],
        what: 'Picks a side and a margin for each scheduled NFL game, with a stated '
            + 'confidence that is the model’s own win probability rather than a '
            + 'separate score.',
        how: 'Margin-adjusted Elo carried across seasons, rolling team form over the last '
            + '3/5/8 games, rest and short-week flags, and the current injury report. A '
            + 'gradient-boosted classifier produces the win probability; a companion '
            + 'regressor produces the spread.',
        data: 'ESPN’s public scoreboard and game-summary endpoints. No auth, no paid '
            + 'feed. Twenty seasons of completed games in a local SQLite database.',
        limits: 'One NFL season is 272 games, so a full season is a small sample by any '
            + 'statistical standard and a good year is not evidence of an edge. Market '
            + 'lines are collected but deliberately excluded from the features: they '
            + 'would dominate every other signal and the model would be reading the '
            + 'market back to you.',
    },
    nba: {
        title: 'NBA Moneyline Picks',
        tagline: 'Daily win probabilities and predicted spreads for the night’s slate.',
        repo: 'nba-prediction',
        stack: ['Python', 'LightGBM', 'SQLite', 'ESPN public API'],
        what: 'A pick and a predicted spread for every game on today’s schedule, '
            + 'refreshed each morning once the previous night has been finalised.',
        how: 'Margin-adjusted Elo plus rolling five, ten and twenty-game team four-factor '
            + 'stats, rest days and win streak, fed to a LightGBM classifier. Player '
            + 'injury impact is the only enhanced feature that survived ablation testing '
            + '— schedule and travel features cost 1.1% accuracy and were removed, and '
            + 'matchup history added noise.',
        data: 'ESPN public API. 5,400 games and 90,000+ player box scores held locally.',
        limits: 'Backtested at 65.5% over 1,075 games of the 2025-26 season, and 77.1% on '
            + 'the subset it called at 70%+ confidence. That high-confidence number is '
            + 'mostly lopsided matchups a book also prices short, not an edge over the '
            + 'price. Model output, not a betting recommendation.',
    },
    mlb: {
        title: 'MLB Moneyline Picks',
        tagline: 'Win probabilities for the day’s slate, with the season’s measured record attached.',
        repo: 'mlb-prediction',
        stack: ['Python', 'LightGBM', 'XGBoost', 'pybaseball', 'MLB Stats API'],
        what: 'A win probability per game, in first-pitch order rather than sorted by '
            + 'confidence, with the model’s own record for the season rendered above it.',
        how: 'An ensemble over Elo, logistic regression, XGBoost and LightGBM. Features are '
            + 'starting-pitcher FIP/WHIP/K9/BB9, team OPS and wOBA split by opposing '
            + 'handedness, rolling bullpen ERA and FIP, margin-adjusted Elo, park factors, '
            + 'rest and travel. Leaking feature groups are dropped explicitly before '
            + 'training, and evaluation is a walk-forward through the season.',
        data: 'pybaseball (Baseball Reference and FanGraphs) for 2022-2025 history; the MLB '
            + 'Stats API for the live season. No auth.',
        limits: 'Baseball is the hardest of the three to beat and the payload says so: the '
            + 'published track record includes a McNemar test against always-picking-home, '
            + 'and the validator refuses any payload that quotes a record it cannot '
            + 'support. It carries no predicted spread — the model predicts a win '
            + 'probability and not a run margin, and inventing one would be exactly the '
            + 'kind of number this site refuses to print.',
    },
    f1: {
        title: 'F1 Race Predictions',
        tagline: 'Predicted finishing order for the coming race weekend, before practice runs.',
        repo: 'f1_prediction',
        stack: ['Python', 'scikit-learn', 'FastF1'],
        what: 'A full predicted finishing order for the next race, published Thursday '
            + '— ahead of the weekend, so it is a forecast rather than a readout of '
            + 'Friday pace.',
        how: 'A rolling-season model: rather than looking up the same Grand Prix in past '
            + 'years, it builds features from the races already run this season — '
            + 'average grid, average finish, points, DNF rate, qualifying position. Win '
            + 'and podium probabilities come from the spread of the forest’s '
            + 'individual trees, each of which gives a complete ordering, so they are '
            + 'genuine ensemble frequencies rather than a softmax over one point estimate.',
        data: 'FastF1, cached locally. A backtesting simulator compares four model families '
            + 'against two aggregation methods, three data windows and both the historical '
            + 'and rolling approaches.',
        limits: 'Twenty-odd races a season is very little training data, and a single '
            + 'safety car rearranges a result the model had no way to anticipate. '
            + 'Predicted position is a continuous score, so the gaps between adjacent '
            + 'drivers are often far smaller than the ordering implies.',
    },
    magic_formula: {
        title: 'Magic Formula Stock Screen',
        tagline: 'Joel Greenblatt’s earnings-yield and return-on-capital rank, recomputed weekly.',
        repo: 'magic-formula-portfolio',
        stack: ['Python', 'yfinance', 'Click', 'Rich'],
        what: 'The combined Magic Formula ranking — earnings yield plus return on '
            + 'capital — over a candidate universe, re-scored weekly against current '
            + 'prices and the latest available fundamentals.',
        how: 'EBIT over enterprise value gives the earnings yield; EBIT over net working '
            + 'capital plus net fixed assets gives return on capital. Each name is ranked '
            + 'on both and the two ranks are summed. The portfolio side of the project also '
            + 'tracks holdings and flags the one-year mark with tax-aware timing — sell '
            + 'losers on day 364, winners on day 366.',
        data: 'The candidate universe is pasted in by hand from magicformulainvesting.com. '
            + 'Fundamentals and prices come from yfinance with a 24-hour cache.',
        limits: 'Two clocks run here and only one of them is visible in the timestamp. The '
            + 'ranking re-runs weekly, so it is always fresh; the universe it ranks is a '
            + 'hand-pasted list that only changes when new quarterly filings land. That is '
            + 'what the banner above the names is reporting. It is a mechanical rank and '
            + 'says nothing about whether a business is sound.',
    },
    business_hunter: {
        title: 'Business Acquisition Screen',
        tagline: 'Small businesses priced below a fair-value band for their earnings type and size.',
        repo: 'business-hunter',
        stack: ['Python', 'stdlib only'],
        what: 'Listings from small-business marketplaces, scored on how far the asking '
            + 'multiple sits below a fair-value band built for that listing’s own '
            + 'earnings definition and size.',
        how: 'The band is the point. SDE is EBITDA plus owner compensation, so the same '
            + 'business prices at a very different multiple of one than the other, and a '
            + 'flat "3x is cheap" rule mostly finds mislabelled earnings. Bands come from '
            + 'IBBA Market Pulse and BizBuySell closed medians, with online businesses on '
            + 'their own band. Rows whose earnings label cannot be scored are refused '
            + 'rather than guessed at, and the refused count is published.',
        data: 'Only the marketplaces that answer plain HTTP are in this feed. BizBuySell is '
            + 'Akamai-blocked and needs a manual rendering pass, so its rows are months '
            + 'stale between sweeps and are deliberately excluded here rather than decaying '
            + 'into dead links on a page claiming to be current.',
        limits: 'The measured rank-to-outcome correlation explains about 9.5% of rank '
            + 'variance — real information, and modest. Financials are self-reported; '
            + '"vetted" means the marketplace screened the P&L, not that anyone audited it. '
            + 'The cheapest multiples are almost never free lunches: sub-1x usually means '
            + 'owner wages dressed as profit, a misleading cash-flow definition, or '
            + 'platform risk correctly priced in.',
    },
    real_estate: {
        title: 'Real Estate Deal Screen',
        tagline: 'Residential listings priced below what comparable sales imply.',
        repo: 'real_estate',
        stack: ['Python', 'homeharvest', 'SQLite', 'Census ACS'],
        what: 'Active listings scored against sold comparables on five weighted factors '
            + '— relative value 30%, cash flow 20%, seller motivation 20%, upside 15%, '
            + 'market 15% — with anything over 40 persisted and tracked to outcome.',
        how: 'Comparable value is built per ZIP and property type from recent sold prices '
            + 'per square foot. The tracker re-scrapes solds later and matches them back to '
            + 'flagged deals, so the published track record is measured against what the '
            + 'houses actually sold for rather than against the model’s own scores.',
        data: 'homeharvest (Realtor.com), with optional Census ACS five-year data.',
        limits: 'Twelve states do not make sale prices public record. In those, Realtor.com '
            + 'reports no sold price and comps silently fall back to the last ASKING price '
            + '— a list-to-list comparison wearing the language of a sale. Deals in '
            + 'those states are refused by the site’s validator and never published, '
            + 'which excludes over seven thousand stored Texas deals.',
    },
    funding: {
        title: 'Funding Rate Carry',
        tagline: 'Perpetual funding carry routes that stayed positive across a day of scans.',
        repo: 'funding-rate-arb',
        stack: ['Python', 'Click', 'Rich'],
        what: 'Cross-exchange funding carry: long one venue, short another, collecting the '
            + 'difference in funding. Each row shows the net return over one funding hold '
            + 'after costs, with the annualised figure as the derived number.',
        how: 'Fifteen perp venues are scanned hourly for spot+perp and perp+perp routes. '
            + 'Fees on both legs are netted out before ranking. A route is only published '
            + 'if it stayed positive across most of the last day of scans — so a short '
            + 'or empty board is the normal honest state, not a broken feed.',
        data: 'Public REST endpoints from Binance, Bybit, OKX, Bitget, KuCoin, Gate, HTX, '
            + 'Backpack, GRVT, Coinbase, Crypto.com, Hyperliquid, Aster, Lighter and '
            + 'Pacifica. No API keys.',
        limits: 'The board is deliberately NOT the scanner’s top rows. Those are '
            + 'whichever altcoin is mid funding spike at four-figure APRs — correct '
            + 'arithmetic and a false promise, because the rate reverts long before a hold '
            + 'completes. Even the persistent rows ignore execution, borrow limits and the '
            + 'capital tied up on both legs, and a quoted APR annualises a rate that '
            + 'reprices every few hours.',
    },
    opportunities: {
        title: 'Opportunities Board',
        tagline: 'Every scanner’s current best rows, merged into one board without a cross-source score.',
        repo: 'opportunities',
        stack: ['Python', 'launchd'],
        what: 'A merge of what each scanner repo already published on its own schedule. It '
            + 'runs no scanner itself, so a slow or broken source can only quiet its own '
            + 'section.',
        how: 'Two rules the aggregator exists to enforce. There is no cross-source score: a '
            + 'funding APR, an earnings yield and a federal contract cadence share no unit, '
            + 'and one leaderboard over them would be a number invented to make a '
            + 'leaderboard possible. And every caveat travels with its items rather than '
            + 'being collected into a footnote, because several of these generators exist '
            + 'mainly to warn about their own output.',
        data: 'The published payload of each source feed on disk. Nothing is fetched.',
        limits: 'The board can be fresh while a source beneath it is not, so every section '
            + 'carries its own age and its own status. A section past its freshness budget '
            + 'is marked stale and publishes no items at all — showing yesterday’s '
            + 'rows under today’s timestamp is the failure this guards against.',
    },
};

// --- Fuller renderers, for the feeds whose compact row drops real data ---------

function renderF1Full(data) {
    const rows = data.predictions.map((p, i) => {
        const win = p.win_prob != null ? `${(Number(p.win_prob) * 100).toFixed(0)}%` : '--';
        const pod = p.podium_prob != null ? `${(Number(p.podium_prob) * 100).toFixed(0)}%` : '--';
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams">
                        <span class="pick-team">P${i + 1}</span>
                        ${esc(p.driver_full || p.driver)}
                    </div>
                    <div class="nba-meta">${esc([p.team, p.driver_code].filter(Boolean).join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Win / podium</div>
                    <div class="nba-confidence confidence-med">${esc(win)} / ${esc(pod)}</div>
                    <div class="nba-pick-label">score ${Number(p.predicted_pos).toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join('');
    return `<div class="f1-race-name">${esc(data.race_name)} ${esc(data.year)}`
        + `${data.round ? ` -- round ${esc(data.round)}` : ''} -- predicted finishing order</div>`
        + rows
        + `<div class="prediction-note">Win and podium probabilities are the share of the `
        + `forest's trees that rank that driver first or top three. Predicted position is `
        + `a continuous score, so drivers separated by a tenth are effectively tied.</div>`;
}

function renderFundingFull(data) {
    const rows = data.opportunities.map(o => {
        const rate = Number(o.net_at_hold);
        const apr = Number(o.net_apr);
        const hitRate = o.scans ? o.hits / o.scans : 0;
        const confClass = hitRate >= 0.9 ? 'confidence-high' : 'confidence-med';
        const legs = o.long_instrument === 'spot'
            ? `long ${o.long_venue} spot, short ${o.short_venue} perp`
            : `long ${o.long_venue} perp, short ${o.short_venue} perp`;
        const meta = [o.type, legs];
        if (o.cost_bps != null) meta.push(`round trip ${Number(o.cost_bps).toFixed(0)}bp`);
        meta.push(`positive in ${o.hits}/${o.scans} scans`);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(o.base)}</span></div>
                    <div class="nba-meta">${esc(meta.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Net per ${esc(o.min_hold_h)}h hold</div>
                    <div class="nba-confidence ${confClass}">${rate >= 0 ? '+' : ''}${rate.toFixed(3)}%</div>
                    <div class="nba-meta">annualises to ~${apr.toLocaleString('en-US', { maximumFractionDigits: 0 })}%</div>
                </div>
            </div>
        `;
    }).join('');
    return rows + `<div class="prediction-note">The per-hold figure is what actually `
        + `happens over one funding period. The annualised figure extrapolates a rate `
        + `that reprices every few hours and is not a return you can lock in.</div>`;
}


// --- Measured history ----------------------------------------------------------
//
// Detail pages only: the home page shows what a model says now, this shows how it has
// actually done. Every number here is read off the payload -- nothing is computed in
// the browser and nothing is assumed. Five feeds have no measured record yet and say
// so, because "no track record published" and "a track record too weak to mention" are
// different statements and a blank panel would merge them.

const pct = v => `${(Number(v) * 100).toFixed(1)}%`;

const NO_RECORD = {
    nba: 'The 2025-26 backtest scored 65.5% over 1,075 games, and 77.1% on picks it '
       + 'called at 70%+ confidence -- but that is a backtest held in the repo, not an '
       + 'out-of-sample record of the picks published here, so it is not quoted as one. '
       + 'The NBA season restarts in late October; a live record starts accruing then.',
    f1: 'No out-of-sample record yet. This feed published for the first time on '
      + '2026-09-14 after five months of a broken CI workflow, so no prediction it made '
      + 'has had a race to be graded against. Finishing order is scored against the '
      + 'actual classification as each race completes, the same way the NFL picks are.',
    opportunities: 'Nothing to measure: this board merges what other feeds already '
       + 'published and makes no prediction of its own. Each source carries its own '
       + 'record on its own page.',
};

// Below this the accuracy is noise and the panel must say so beside the number. Same
// threshold the site's validator calls FRAGILE_SAMPLE.
const FRAGILE_SAMPLE = 100;

const HISTORY = {
    nfl: d => {
        const t = d.track_record;
        if (!t) return null;
        const rows = [
            ['Published picks graded', String(t.n_games)],
            ['Correct', `${pct(t.accuracy)} (${Math.round(t.accuracy * t.n_games)} of ${t.n_games})`],
            [t.baseline_label || 'baseline', pct(t.baseline_accuracy)],
            ['McNemar p', String(t.mcnemar_p_vs_baseline)],
            ['Beats that baseline', t.beats_baseline ? 'yes' : 'not established'],
        ];
        if (t.weeks_scored) rows.splice(1, 0, ['Weeks scored', t.weeks_scored.join(', ')]);
        if (t.mean_abs_spread_error != null) {
            rows.push(['Mean spread error', `${t.mean_abs_spread_error} pts`]);
        }
        if (t.high_conf_stated != null) {
            rows.push([`Picks at ${pct(t.high_conf_threshold)}+ stated`,
                       `${pct(t.high_conf_stated)} stated vs ${pct(t.high_conf_realized)} realised`]);
        }
        const fragile = t.n_games < FRAGILE_SAMPLE;
        return { rows, note: (t.basis ? `Scored from the ${t.basis}. ` : '')
            + (fragile
                ? `At ${t.n_games} games this is far too small a sample to mean anything `
                  + `-- one week of NFL football is noise, a good week and a real edge look `
                  + `identical here, and "beats the baseline" stays unestablished until the `
                  + `difference is significant. It is published because what was forecast `
                  + `and what happened are both facts; the accuracy is not yet a claim.`
                : 'Measured against always-picking-home, the only baseline worth the '
                  + 'comparison.') };
    },
    mlb: d => {
        const t = d.track_record;
        if (!t) return null;
        const rows = [
            [`${t.season} season accuracy`, `${pct(t.accuracy)} over ${t.n_games} games`],
            [t.baseline_label || 'baseline', pct(t.baseline_accuracy)],
            ['Beats that baseline', t.beats_baseline ? 'yes' : 'NO'],
            ['McNemar p', String(t.mcnemar_p_vs_baseline)],
        ];
        if (t.high_conf_stated != null) {
            rows.push([`Picks at ${pct(t.high_conf_threshold)}+ stated`, String(t.high_conf_n)]);
            rows.push(['Stated vs realised', `${pct(t.high_conf_stated)} vs ${pct(t.high_conf_realized)}`]);
        }
        const gap = t.high_conf_realized != null
            ? Number(t.high_conf_realized) - Number(t.high_conf_stated) : null;
        return { rows, note: 'Accuracy against the always-pick-home baseline is the only '
            + 'comparison that means anything in baseball. '
            + (gap != null && gap < 0
                ? `The confident picks are overconfident by ${(Math.abs(gap) * 100).toFixed(1)} `
                  + 'points: a high number there is matchup lopsidedness, which a book also '
                  + 'prices short, not an edge over the price.'
                : 'Model output, not a betting recommendation.') };
    },
    real_estate: d => {
        const t = d.track_record;
        if (!t) return null;
        return {
            rows: [
                ['Flagged listings since sold', String(t.resolved)],
                ['Mean discount to comp value', pct(t.mean_edge)],
                ['Median discount', pct(t.median_edge)],
                ['Sold below comp value', pct(t.share_below_comp_value)],
                ['Score-to-outcome correlation', `${Number(t.spearman).toFixed(3)} `
                    + `(95% CI ${Number(t.ci_low).toFixed(3)} to ${Number(t.ci_high).toFixed(3)})`],
            ],
            note: `The ranking carries real but modest information -- about `
                + `${(Number(t.spearman) ** 2 * 100).toFixed(0)}% of rank variance. Measured `
                + `against what the houses actually sold for, not against the model's own `
                + `scores. Screening output, not advice.`,
        };
    },
    magic_formula: d => {
        const p = d.portfolio;
        if (!p) return null;
        const sign = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
        const rows = [
            ['Positions', `${p.open_positions} open, ${p.closed_positions} closed`],
            ['Since', p.since],
            ['Invested', P.formatMoney(p.cost_basis)],
            ['Market value', P.formatMoney(p.market_value)],
            ['Return', sign(p.return_pct)],
        ];
        if (p.benchmark_return_pct != null) {
            rows.push([`${p.benchmark} over the same window`, sign(p.benchmark_return_pct)]);
            rows.push(['Excess', sign(p.excess_return_pct)]);
        }
        if (p.realized_pnl) rows.push(['Realised PnL', P.formatMoney(p.realized_pnl)]);
        return { rows, note: 'This is the book, not the screen: real entries at real '
            + 'prices, marked against live quotes. At '
            + `${p.open_positions + p.closed_positions} positions over `
            + `${Math.round((Date.now() - new Date(p.since)) / 86400000)} days it is far `
            + 'too small and too short to attribute to the formula rather than to luck, '
            + 'and Magic Formula is a multi-year strategy by construction. The benchmark '
            + 'runs from the first buy date so it is not an index that was already fully '
            + 'invested being compared to a book still being built.' };
    },
    business_hunter: d => {
        const t = d.track_record;
        if (!t) {
            return { rows: [], note: 'Track record not established yet -- fewer than 30 '
                + 'flagged listings have resolved. Small-business sales close slowly and '
                + 'many listings are withdrawn rather than sold, so this accrues over '
                + 'quarters rather than weeks.' };
        }
        return {
            rows: [
                ['Flagged listings since sold', String(t.resolved)],
                ['Mean acquisition discount', pct(t.mean_edge)],
                ['Sold below comparable value', pct(t.share_below_comp_value)],
                ['Score-to-outcome correlation', Number(t.spearman).toFixed(3)],
            ],
            note: 'Financials are self-reported throughout, so this measures the screen '
                + 'against reported numbers rather than audited ones.',
        };
    },
    // Persistence IS this feed's history: a route is only published because it held up
    // across a day of hourly scans, and each row carries its own hit count.
    funding: d => {
        const ops = d.opportunities || [];
        if (!ops.length) {
            return { rows: [], note: 'No route held a positive net carry across the last '
                + 'day of scans, so there is no persistence to report. That is the usual '
                + 'state and it is the finding, not a gap.' };
        }
        const hits = ops.reduce((a, o) => a + (o.hits || 0), 0);
        const scans = ops.reduce((a, o) => a + (o.scans || 0), 0);
        const perfect = ops.filter(o => o.hits === o.scans).length;
        const best = ops.reduce((a, o) => Math.max(a, Number(o.net_at_hold) || 0), 0);
        return {
            rows: [
                ['Hourly scans held', String(d.scans_seen)],
                ['Minimum hits to publish', `${d.min_hits} of ${d.window_scans}`],
                ['Published routes', String(ops.length)],
                ['Positive in every scan', `${perfect} of ${ops.length}`],
                ['Aggregate hit rate', scans ? pct(hits / scans) : 'n/a'],
                ['Best net per hold', `+${best.toFixed(3)}%`],
            ],
            note: 'This is persistence, not realised PnL: it says the spread kept being '
                + 'there, not that it was captured. Nothing here is traded, so there is no '
                + 'execution, slippage or borrow cost in these numbers.',
        };
    },
};

function historyPanel(key, data) {
    const build = HISTORY[key];
    const h = build ? build(data) : null;
    if (!h) {
        const why = NO_RECORD[key];
        if (!why) return '';
        return `<h3>Measured history</h3><p class="feed-norecord">${esc(why)}</p>`;
    }
    const body = h.rows.map(([k, v]) =>
        `<div class="feed-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    return `<h3>Measured history</h3>`
        + (body ? `<dl class="feed-facts">${body}</dl>` : '')
        + `<p class="feed-norecord">${esc(h.note)}</p>`;
}


// A played game renders its score and a hit/miss mark beside the pick it was given.
// `correct` comes off the payload rather than being recomputed here -- the validator
// already checks it against the score, and two places deciding it is two places to
// disagree.
function renderGamesWithResults(data) {
    const money = n => (n >= 0 ? '+' : '') + n;
    const rows = data.games.map(g => {
        const r = g.result;
        const conf = Number(g.confidence);
        const meta = [];
        if (g.pred_spread != null) meta.push(`spread ${g.pred_spread > 0 ? '+' : ''}${g.pred_spread}`);
        meta.push(`home win ${(Number(g.ml_win_prob) * 100).toFixed(0)}%`);
        if (g.away_starter && g.home_starter) meta.push(`${g.away_starter} vs ${g.home_starter}`);
        if (r) {
            meta.push(`final ${r.away_pts}-${r.home_pts}`);
            if (r.actual_spread != null && g.pred_spread != null) {
                meta.push(`missed the line by ${Math.abs(r.actual_spread - g.pred_spread).toFixed(1)}`);
            }
        } else if (g.kickoff) {
            meta.push(P.formatKickoff(g.kickoff));
        }
        const mark = r
            ? `<span class="game-mark ${r.correct ? 'game-hit' : 'game-miss'}">`
              + `${r.correct ? 'correct' : 'wrong'}</span>`
            : '<span class="game-mark game-pending">not played</span>';
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams">
                        <span class="${g.pick === g.away_team ? 'pick-team' : ''}">${esc(g.away_team)}</span>
                        @
                        <span class="${g.pick === g.home_team ? 'pick-team' : ''}">${esc(g.home_team)}</span>
                        ${r ? `<span class="game-score">${r.away_pts}-${r.home_pts}</span>` : ''}
                    </div>
                    <div class="nba-meta">${esc(meta.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Pick</div>
                    <div class="nba-confidence ${conf >= 0.6 ? 'confidence-high' : 'confidence-med'}">${esc(g.pick)} (${(conf * 100).toFixed(0)}%)</div>
                    ${mark}
                </div>
            </div>
        `;
    }).join('');
    const played = data.games.filter(g => g.result);
    const hits = played.filter(g => g.result.correct).length;
    const head = played.length
        ? `<div class="prediction-slate">${hits} of ${played.length} played so far this `
          + `slate</div>`
        : '';
    return head + rows;
}

// Per-instrument PnL and the book's own return. The screen is a ranking and a ranking
// has no outcome -- these are the entries actually taken off it, which is the only part
// that can be wrong in a way that costs something.
function renderPortfolio(port) {
    if (!port) return '';
    const sign = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
    const dollars = v => (v >= 0 ? '+' : '-') + P.formatMoney(Math.abs(v));
    const rows = port.positions.map(r => {
        const cls = r.price_unavailable ? 'confidence-med'
            : (r.return_pct >= 0 ? 'confidence-high' : 'confidence-low');
        const facts = [`${r.shares} sh at ${P.formatMoney(r.buy_price)}`,
                       `bought ${r.buy_date}`, `${r.days_held}d held`];
        if (!r.open) facts.push(`sold ${r.sell_date} (${r.sell_reason || 'manual'})`);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(r.ticker)}</span>
                        <span class="idea-name">${r.open ? 'open' : 'closed'}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">${r.open ? 'Unrealised' : 'Realised'}</div>
                    <div class="nba-confidence ${cls}">${r.price_unavailable
                        ? 'no quote' : sign(r.return_pct)}</div>
                    ${r.price_unavailable ? '' : `<div class="nba-meta">${esc(dollars(r.pnl))}</div>`}
                </div>
            </div>
        `;
    }).join('');
    const bench = port.benchmark_return_pct != null
        ? ` against ${sign(port.benchmark_return_pct)} for ${esc(port.benchmark)} over the `
          + `same window -- ${sign(port.excess_return_pct)} excess`
        : '';
    return `<h2 class="feed-sub feed-sub-spaced">The book</h2>`
        + `<div class="prediction-slate">${port.open_positions} open, `
        + `${port.closed_positions} closed since ${esc(port.since)} -- `
        + `${esc(P.formatMoney(port.cost_basis))} invested, now `
        + `${esc(P.formatMoney(port.market_value))} (${sign(port.return_pct)})${bench}</div>`
        + rows
        + `<div class="prediction-note">Real entries at real prices from the screen, `
        + `marked against live quotes. Five positions is far too few to attribute to the `
        + `formula rather than to luck, and the benchmark is measured from the first buy `
        + `date so it is not comparing a book being built against an index already fully `
        + `invested.</div>`;
}

function renderMagicFormulaFull(data) {
    return P.FEEDS.magic_formula.render(data) + renderPortfolio(data.portfolio);
}

// --- Panels -------------------------------------------------------------------

function projectPanel(proj) {
    const tags = proj.stack.map(t => `<span>${esc(t)}</span>`).join('');
    const para = (heading, body) =>
        `<h4>${esc(heading)}</h4><p>${esc(body)}</p>`;
    return `
        <h3>About this model</h3>
        <div class="project-tags">${tags}</div>
        ${para('What it predicts', proj.what)}
        ${para('How it works', proj.how)}
        ${para('Data', proj.data)}
        ${para('Where it falls down', proj.limits)}
        <p class="feed-repo">Repo: <code>${esc(proj.repo)}</code> (private)</p>
    `;
}

// Counters worth showing differ per feed, so each one names its own. Anything absent
// from the payload is skipped rather than rendered as "undefined".
const FACTS = {
    nfl: d => [['Season', d.season], ['Week', d.week], ['Games', len(d.games)]],
    nba: d => [['Slate', d.date], ['Games', len(d.games)]],
    mlb: d => [['Slate', d.date], ['Games', len(d.games)],
               ['Season record', d.track_record
                   ? `${(d.track_record.accuracy * 100).toFixed(1)}% over ${d.track_record.n_games}`
                   : null]],
    f1: d => [['Season', d.year], ['Round', d.round], ['Race', d.race_name],
              ['Drivers', len(d.predictions)]],
    magic_formula: d => [['Universe pulled', d.universe_pulled],
                         ['Universe size', d.universe_size],
                         ['Passed the screen', d.screened],
                         ['Published', len(d.ideas)]],
    business_hunter: d => [['Screened', d.screened], ['Scored', d.scored],
                           ['Refused', d.refused], ['Below band', d.flagged],
                           ['Published', len(d.businesses)]],
    real_estate: d => [['Markets', (d.markets || []).join(', ')],
                       ['Published', len(d.deals)],
                       ['Outcomes resolved', d.track_record ? d.track_record.resolved : null]],
    funding: d => [['Status', d.status], ['Scans held', d.scans_seen],
                   ['Minimum hits to publish', d.min_hits],
                   ['Routes', len(d.opportunities)]],
    opportunities: d => [['Sources', len(d.sources)],
                         ['Fresh sources', d.fresh_sources],
                         ['Rows', d.total_opportunities]],
};

function len(v) { return Array.isArray(v) ? v.length : null; }

function factsPanel(key, data, cfg) {
    const build = FACTS[key];
    const rows = (build ? build(data) : [])
        .filter(([, v]) => v !== null && v !== undefined && v !== '');
    rows.push(['Published', P.formatStamp(data.generated_at)]);
    rows.push(['Cadence', cfg.cadence]);
    // The staleness budget is the promise the page makes about this feed, so it belongs
    // where a reader can check it against the timestamp above.
    rows.push(['Shown as stale after', P.relativeAge(cfg.staleAfter).replace(' ago', '')]);
    const body = rows.map(([k, v]) =>
        `<div class="feed-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    return `<h3>This run</h3><dl class="feed-facts">${body}</dl>`;
}

function siblingNav(currentKey) {
    const links = Object.keys(PROJECTS)
        .filter(k => k !== currentKey && P.FEEDS[k])
        .map(k => `<a href="feed.html?feed=${encodeURIComponent(k)}">${esc(PROJECTS[k].title)}</a>`)
        .join('');
    return `<h3>Other feeds</h3><div class="feed-sibling-links">${links}</div>`;
}

// --- Boot ---------------------------------------------------------------------

const toggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
toggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('active');
    toggle.setAttribute('aria-expanded', String(open));
});

const yearEl = document.getElementById('footer-year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// The fuller renderers are attached to the shared registry rather than passed in, so
// the home page keeps its compact rows and this page gets the detailed ones from the
// same config object.
if (P.FEEDS.f1) P.FEEDS.f1.renderFull = renderF1Full;
if (P.FEEDS.funding) P.FEEDS.funding.renderFull = renderFundingFull;
if (P.FEEDS.nfl) P.FEEDS.nfl.renderFull = renderGamesWithResults;
if (P.FEEDS.nba) P.FEEDS.nba.renderFull = renderGamesWithResults;
if (P.FEEDS.mlb) P.FEEDS.mlb.renderFull = d =>
    P.FEEDS.mlb.render({ ...d, games: [] }) + renderGamesWithResults(d);
if (P.FEEDS.magic_formula) P.FEEDS.magic_formula.renderFull = renderMagicFormulaFull;

async function boot() {
    const key = new URLSearchParams(window.location.search).get('feed');
    const proj = PROJECTS[key];
    const cfg = P.FEEDS[key];

    if (!proj || !cfg) {
        document.getElementById('feed-title').textContent = 'Unknown feed';
        document.getElementById('feed-tagline').textContent =
            'That is not one of the published model feeds.';
        document.getElementById('feed-updated').textContent = '';
        document.getElementById('feed-content').innerHTML =
            P.note('prediction-error', 'Pick one from the list below.');
        document.getElementById('feed-nav').innerHTML = siblingNav(null);
        return;
    }

    document.title = `${proj.title} -- Amar Sehgal`;
    document.getElementById('feed-title').textContent = proj.title;
    document.getElementById('feed-tagline').textContent = proj.tagline;
    document.getElementById('feed-cadence').textContent = `Published ${cfg.cadence}`;
    document.getElementById('feed-project').innerHTML = projectPanel(proj);
    document.getElementById('feed-nav').innerHTML = siblingNav(key);

    const data = await P.load(key, {
        container: 'feed-content', stamp: 'feed-updated', full: true,
    });

    // The facts panel describes a run. With no payload there is no run to describe, and
    // an empty table under a heading reads as a rendering bug rather than a down feed.
    const factsEl = document.getElementById('feed-facts');
    const histEl = document.getElementById('feed-history');
    if (data && data.generated_at) {
        factsEl.innerHTML = factsPanel(key, data, cfg);
        const hist = historyPanel(key, data);
        if (hist) histEl.innerHTML = hist; else histEl.remove();
    } else {
        factsEl.remove();
        histEl.remove();
    }
}

boot();

})();
