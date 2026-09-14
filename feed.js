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
    if (data && data.generated_at) {
        factsEl.innerHTML = factsPanel(key, data, cfg);
    } else {
        factsEl.remove();
    }
}

boot();

})();
