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
    swing_book: {
        title: 'Swing Book (live paper)',
        tagline: 'MultiFactorV3 signals executed into a $100k Alpaca paper account -- a falsification test, not a showcase.',
        repo: 'stock_prediction',
        stack: ['Python', 'Alpaca', 'pandas', 'backtesting.py'],
        what: 'The MultiFactorV3 swing signals, actually executed. Signals are generated '
            + 'after the close and the orders go in at the next open, so no fill can '
            + 'precede the data that produced it.',
        how: 'Equal weight across the live signal set with an 8% per-name ceiling and a '
            + '2% cash buffer. Each session reconciles the account to the target book: '
            + 'exits first to free buying power, then entries. Order ids are derived from '
            + '(strategy, symbol, side, session) so a retry or a double-fire is a no-op '
            + 'rather than a doubled position.',
        data: 'Alpaca for fills, positions and equity; consolidated SIP daily bars, '
            + 'split- and dividend-adjusted, for the benchmark.',
        limits: 'This book exists because the strategy\u2019s own walk-forward says it '
            + 'LOSES: 3 of 17 windows beat the benchmark, average edge -3.2%, Sharpe '
            + '0.463 against 0.801 for buy-and-hold. The question it settles is whether '
            + 'that holds with real fills. It has 180 days to answer before the review '
            + 'is forced. And paper fills model no queue position and no partial fills, '
            + 'so this beats a backtest and is still not a real book.',
    },
    mf_book: {
        title: 'Magic Formula Book (live paper)',
        tagline: 'The value screen bought in monthly tranches into a $100k Alpaca paper account.',
        repo: 'magic-formula-portfolio',
        stack: ['Python', 'Alpaca', 'yfinance'],
        what: 'Greenblatt\u2019s construction, run properly: five names a month toward a '
            + '25-slot book, each held about a year, sold on a tax-aware date.',
        how: 'Tranches are sized off a fixed slot count rather than current equity -- '
            + 'sizing off equity makes every buy a function of how the book has done so '
            + 'far, which concentrates into a winner and starves a loser. One tranche per '
            + 'calendar month, enforced by the order id. Sells are surfaced, never placed '
            + 'automatically: a wrong-side-of-the-line realisation cannot be undone.',
        data: 'Alpaca for fills, positions, equity and dividend credits; the screen '
            + 'itself still comes from the hand-pasted magicformulainvesting.com universe.',
        limits: 'It replaces a hand-kept positions.json whose entry prices were typed in, '
            + 'which counted no dividends at all on a screen full of payers, and which '
            + 'had no corporate-action handling. Those are fixed here. What is not fixed: '
            + 'Magic Formula is a multi-year strategy, so a year of this says very little, '
            + 'and paper fills are simulated.',
    },
    stock_signals: {
        title: 'Swing-Trade Signals', tagline: 'Live MultiFactorV3 entries and holds across the S&P 500 top 100.',
        repo: 'stock_prediction', stack: ['Python', 'pandas', 'backtesting.py'],
        what: 'The signal side of the swing strategy: which names currently carry an '
            + 'entry or a hold, with the composite factor score behind each.',
        how: 'A six-factor composite -- trend, momentum, pullback depth, volume '
            + 'confirmation, volatility regime and a moving-average filter -- scored '
            + 'daily across the universe. The book that trades these is published '
            + 'separately as the Swing Book.',
        data: 'yfinance daily bars, cached as parquet.',
        limits: 'The walk-forward on this strategy beat its benchmark in 3 of 17 '
            + 'windows with an average edge of -3.2%. These are the signals; the Swing '
            + 'Book page is where they get marked to an actual account.',
    },
    funding_drift: {
        title: 'Perp Funding vs Realized Drift', tagline: 'Perp markets where cumulative funding and cumulative return have diverged.',
        repo: 'funding-drift', stack: ['Python', 'aiohttp', 'asyncio'],
        what: 'Compares cumulative funding paid against cumulative realized return over '
            + 'a rolling window across nine exchanges, looking for markets where the '
            + 'losing side is under pressure to close.',
        how: 'Binance supplies the universal return series; every exchange contributes '
            + 'its own funding rate. Hyperliquid and dYdX fund hourly against 8-hourly '
            + 'elsewhere, which is normalised before comparison.',
        data: 'Public REST endpoints from nine venues. No API keys.',
        limits: 'The repo\u2019s own study found this ranking is ~99% price momentum -- '
            + 'rank correlation 0.996 with plain return -- and that the convergence '
            + 'reading of the funding term is backwards. It is published as an '
            + 'observation, and the caveat travels with the rows for that reason.',
    },
    contracts: {
        title: 'Federal Resale Lanes', tagline: 'Recurring US federal commodity buys, from a daily SAM.gov snapshot store.',
        repo: 'sam-contracts', stack: ['Python', 'SQLite', 'Click'],
        what: 'Federal buys that RECUR -- the only kind worth the weeks a SAM '
            + 'registration takes -- ranked by how strong the evidence for recurrence is.',
        how: 'The SAM.gov extract carries only currently-active notices, so recurrence '
            + 'is invisible to a one-shot scrape. A daily job snapshots the extract into '
            + 'SQLite and recurrence is observed across snapshot days. Every lane '
            + 'carries its evidence tier, and only OBSERVED means the buy was actually '
            + 'watched to repeat.',
        data: 'SAM.gov public daily Contract Opportunities extract, ~230MB, no auth.',
        limits: 'Line-item quantities and specs live in PDF attachments the extract does '
            + 'not carry, so this finds and classifies lanes but cannot compute a '
            + 'retail-versus-bid margin. Set-asides needing formal certification are '
            + 'excluded -- they are not reachable without one.',
    },
    ad_capital: {
        title: 'AD Capital Universe Scan', tagline: 'The paper book\u2019s own signal, run across a 374-name universe.',
        repo: 'ad-capital-v0', stack: ['Python', 'yfinance', 'Click'],
        what: 'A scan of the AD Capital universe using the quant book\u2019s own '
            + 'MultiFactorV3 signal, with ATR-based exit bands attached.',
        how: 'Refuses to publish below 80% universe coverage, and runs weekdays only -- '
            + 'a weekend rerun would republish Friday under a fresher timestamp and make '
            + 'a stalled job look live.',
        data: 'yfinance. The portfolio state itself lives in the repo as JSON.',
        limits: 'The quant book here runs the same MultiFactorV3 as stock_prediction, so '
            + 'it is not independent evidence about that strategy. The sector fund '
            + 'alongside it is discretionary and LLM-driven, which means its results are '
            + 'not attributable to a reproducible process and are deliberately not '
            + 'published as a track record.',
    },
    polymarket_btc: {
        title: 'Polymarket BTC 5-Min Binaries', tagline: 'Black-Scholes against Polymarket\u2019s own prices -- and the model loses.',
        repo: 'polymarket-btc-options', stack: ['Python', 'websockets', 'Rich'],
        what: 'Prices Polymarket\u2019s 5-minute BTC binaries with a cash-or-nothing '
            + 'Black-Scholes model against real-time EWMA volatility, and compares the '
            + 'result to the market\u2019s own quote.',
        how: 'Binance aggTrade feed drives an EWMA vol estimate; N(d2) gives the model '
            + 'probability. The section is gated on the payload\u2019s own verdict rather '
            + 'than a hardcoded empty list, so the day the measurement flips it starts '
            + 'showing rows by itself.',
        data: 'Binance WebSocket and the Polymarket Gamma/CLOB APIs. No auth.',
        limits: 'Measured: Polymarket\u2019s price scores a BETTER Brier than the model. '
            + 'What survives costs is a latency effect that crosses break-even within a '
            + 'few seconds of feed staleness. Publishing a ranking off that would be '
            + 'publishing noise, so the honest output is an empty section.',
    },
    weather_risk: {
        title: 'Severe Weather Risk', tagline: 'Gradient-boosted severe-weather probability for ten US cities.',
        repo: 'weather_prediction', stack: ['Python', 'scikit-learn', 'Open-Meteo', 'NOAA'],
        what: 'Probability of a severe weather event in the next 24-72 hours per city, '
            + 'with current conditions scored against 30-year climate normals.',
        how: 'A gradient-boosting classifier trained on 400k+ NOAA Storm Events rows '
            + 'joined to historical weather at each event.',
        data: 'NOAA Storm Events bulk CSVs and the Open-Meteo archive API. No keys.',
        limits: 'The scheduled job is currently OFF. Open-Meteo archive requests fail for '
            + 'most cities while small requests to the same endpoint succeed, unresolved, '
            + 'and a 60% coverage floor now refuses to publish a partial scan rather than '
            + 'passing one city off as a ten-city run. The frequency model\u2019s R2 is '
            + '0.385 -- useful for seasonality, weak on year-to-year variance.',
    },
    options_levels: {
        title: 'Options Level Breaks (live paper)',
        tagline: 'Opening-range breakouts traded as options, on a third $100k paper account.',
        repo: 'options-levels',
        stack: ['Python', 'Alpaca', 'pandas'],
        what: 'Arms a level off each morning\u2019s opening range across a ~570-name '
            + 'universe, and takes an option position when one breaks.',
        how: 'A 45-minute opening range sets the level, offset by k=0.15 of the range '
            + 'with a 15bp floor. Entries target ~0.6 delta around 11 DTE, capped at '
            + '$2,000 of premium per trade and two concurrent positions, with stop and '
            + 'target as multiples of the range.',
        data: 'Alpaca consolidated SIP bars. The free plan cannot serve data less than '
            + '15 minutes old, which is why the payload reports its own data lag -- the '
            + 'book is honest about trading on delayed prices.',
        limits: 'Its own sweep says the edge does not clear costs: 1.29M triggers across '
            + '77,760 parameter sets, edge 0.019% per trade against a 0.09-0.12% option '
            + 'cost hurdle -- short by 5-6x -- and longer holds do not help because the '
            + 'edge stops at the closing bell. It runs forward to gather out-of-sample '
            + 'evidence against that, not because the backtest was encouraging.',
    },
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
    news: {
        title: 'News Coverage',
        tagline: 'What the press is actually covering right now, ranked by how many '
            + 'independent outlets are carrying each story.',
        repo: 'news-sentiment-tracker',
        stack: ['Python', 'feedparser', 'VADER', 'SQLite FTS5'],
        what: 'The topics with the broadest coverage in the last 24 hours across 40+ '
            + 'news feeds and 17 social sources, with a surge figure comparing each '
            + 'topic against its own recent norm.',
        data: '55+ public RSS feeds. RSS serves only the last 24-48h, so the archive is '
            + 'built by fetching continuously rather than backfilled.',
        states: 'Ranked by BREADTH, never by sentiment. VADER mis-scores news language, '
            + 'so tone is shown as a coarse direction and only where the sample '
            + 'supports it \u2014 it is context on a topic, not a signal.',
        cadence: 'hourly',
    },
    polymarket_whales: {
        title: 'Polymarket Whale Watch',
        tagline: 'Who is actually making money on Polymarket\u2019s 5-minute BTC markets, '
            + 'and whether any of them has an edge in the closing seconds.',
        repo: 'polymarket-whale-tracker',
        stack: ['Python', 'asyncio', 'SQLite', 'Polymarket Gamma + Data APIs'],
        what: 'A daily snapshot of the largest winners across every 5-minute BTC market '
            + 'that resolved in the last 24 hours, with the biggest audited against '
            + 'their own full order flow.',
        data: 'Polymarket Gamma and Data APIs for markets and trades, Binance 1s klines '
            + 'for the settlement price. No API key, no account, nothing private.',
        states: 'A wallet appears only if it cleared the size threshold in the window. '
            + '\u201cToo little history to grade\u201d is the usual verdict and is '
            + 'reported as such rather than guessed at.',
        cadence: 'daily',
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



// --- Equity curve -------------------------------------------------------------
//
// Two series (the book, and SPY over the same window), both INDEXED TO PERCENT RETURN
// FROM INCEPTION rather than plotted in dollars. That is deliberate and it is the one
// rule worth stating: a book in dollars and an index level are different scales, and
// putting them on two y-axes is the single most misleading thing a chart like this can
// do -- the crossover point becomes an artefact of where you chose to start each axis.
// Indexed to a common base there is one axis and the comparison is real.
//
// Palette is #4a90e2 / #c9679a, checked with the dataviz validator against this page's
// #0a0a0a surface: lightness band, chroma floor, CVD separation (protan dE 11.5),
// normal-vision separation (dE 20.7) and contrast all pass. Do not "tidy" these to the
// site accent without re-running it -- the obvious pairing (#6ea8fe with a grey) fails
// the normal-vision floor at dE 10.6.
// Bound once at load, after predictions.js has registered the feeds. Both books share
// one row renderer, so either feed's is the same function.
const BOOK_ROWS = d => P.FEEDS.swing_book.render(d);

const BOOK_COLOR = '#4a90e2';
const BENCH_COLOR = '#c9679a';

function equityChart(data) {
    const curve = (data.equity_curve || []).filter(p => p && p.equity);
    if (curve.length < 2) {
        return `<p class="prediction-none">${esc('The equity curve needs at least two '
            + 'sessions. It starts the day after the book opens.')}</p>`;
    }
    const base = Number(data.starting_equity) || Number(curve[0].equity);
    const book = curve.map(p => ({ date: p.date, v: Number(p.equity) / base - 1 }));

    // SPY is drawn as a straight line from 0 to its total return over the same window:
    // the payload carries the endpoint, not the path. Shown dashed and labelled as
    // such, because pretending to know its daily shape would be inventing data.
    const benchEnd = data.benchmark_return_pct;
    const hasBench = benchEnd != null;

    // r is wide enough for the direct labels ("Book +12.3%"), which sit OUTSIDE the
    // plot area. At r=56 they overflowed the viewBox and were clipped at the right edge.
    const W = 640, H = 220, PAD = { t: 14, r: 92, b: 26, l: 48 };
    const xs = (i) => PAD.l + i * (W - PAD.l - PAD.r) / (book.length - 1);
    const vals = book.map(p => p.v).concat(hasBench ? [0, Number(benchEnd)] : [0]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = (hi - lo) || 0.02;
    lo -= span * 0.12; hi += span * 0.12;
    const ys = (v) => PAD.t + (hi - v) * (H - PAD.t - PAD.b) / (hi - lo);

    const path = book.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.v).toFixed(1)}`).join('');
    const zeroY = ys(0).toFixed(1);
    const fmt = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

    // Recessive axis: the zero line (break-even) plus the two extremes. A full grid
    // would out-weigh two thin lines.
    const ticks = [hi, 0, lo].map(v => `
        <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}"
              stroke="#222" stroke-width="1" ${v === 0 ? '' : 'stroke-dasharray="2 4"'}/>
        <text x="${PAD.l - 8}" y="${(ys(v) + 4).toFixed(1)}" text-anchor="end"
              fill="#888" font-size="10">${esc(fmt(v))}</text>`).join('');

    const benchLine = hasBench ? `
        <line x1="${xs(0)}" y1="${zeroY}" x2="${xs(book.length - 1)}" y2="${ys(Number(benchEnd)).toFixed(1)}"
              stroke="${BENCH_COLOR}" stroke-width="2" stroke-dasharray="5 4"
              stroke-linecap="round"/>
        <text x="${W - PAD.r + 6}" y="${(ys(Number(benchEnd)) + 4).toFixed(1)}"
              fill="${BENCH_COLOR}" font-size="10">SPY ${esc(fmt(Number(benchEnd)))}</text>` : '';

    const last = book[book.length - 1];
    return `
        <figure class="equity-figure">
            <svg viewBox="0 0 ${W} ${H}" class="equity-chart" role="img"
                 aria-label="Cumulative return of the book against SPY, both indexed to
                 zero at inception. Book ${esc(fmt(last.v))}${hasBench
                     ? `, SPY ${esc(fmt(Number(benchEnd)))}` : ''}.">
                ${ticks}
                ${benchLine}
                <path d="${path}" fill="none" stroke="${BOOK_COLOR}" stroke-width="2"
                      stroke-linejoin="round" stroke-linecap="round"/>
                <circle cx="${xs(book.length - 1).toFixed(1)}" cy="${ys(last.v).toFixed(1)}"
                        r="3.5" fill="${BOOK_COLOR}" stroke="#0a0a0a" stroke-width="2"/>
                <text x="${W - PAD.r + 6}" y="${(ys(last.v) + 4).toFixed(1)}"
                      fill="${BOOK_COLOR}" font-size="10">Book ${esc(fmt(last.v))}</text>
                <text x="${PAD.l}" y="${H - 8}" fill="#888" font-size="10">${esc(book[0].date)}</text>
                <text x="${W - PAD.r}" y="${H - 8}" text-anchor="end" fill="#888"
                      font-size="10">${esc(last.date)}</text>
            </svg>
            <figcaption>
                <span class="chart-key"><i style="background:${BOOK_COLOR}"></i>This book</span>
                ${hasBench ? `<span class="chart-key"><i class="dashed"
                    style="background:${BENCH_COLOR}"></i>SPY, endpoint only</span>` : ''}
                <span class="chart-note">Both indexed to 0% at inception, so there is one
                    axis and the comparison is real. SPY is drawn straight to its total
                    return over the window -- the payload carries the endpoint, not the
                    daily path.</span>
            </figcaption>
        </figure>
        <details class="chart-table">
            <summary>Equity curve as a table</summary>
            <dl class="feed-facts">${book.map(p =>
                `<div class="feed-fact"><dt>${esc(p.date)}</dt><dd>${esc(fmt(p.v))}</dd></div>`
            ).join('')}</dl>
        </details>
    `;
}

function renderBookFull(data) {
    const extra = [];
    if (data.dividends_total) {
        extra.push(`${P.formatMoney(data.dividends_total)} of dividends credited`);
    }
    if (data.target_positions) {
        extra.push(`${data.open_positions} of ${data.target_positions} slots filled`);
    }
    if (data.sells_due && data.sells_due.length) {
        extra.push(`sell due: ${data.sells_due.join(', ')}`);
    }
    if (data.days_live != null) {
        extra.push(`${data.days_live} days live`
            + (data.verdict_due ? ' -- past the review window' : ''));
    }
    // The compact row renderer is shared with the home page, on purpose: the detail
    // page adds the curve and the book-level facts above it, it does not restate the
    // positions differently.
    return equityChart(data)
        + (extra.length ? `<div class="prediction-slate">${esc(extra.join(' | '))}</div>` : '')
        + BOOK_ROWS(data);
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
    stock_signals: 'The signals themselves carry no separate record -- what happens when '
       + 'they are traded is measured on the Swing Book page, against a real account.',
    funding_drift: 'No record, deliberately. The repo measured its own ranking as ~99% '
       + 'price momentum, so scoring it as a signal would be scoring plain return with '
       + 'extra steps.',
    contracts: 'Nothing to score yet: a lane is a claim that a buy recurs, and confirming '
       + 'one means watching a future solicitation appear. The snapshot store has 15 days '
       + 'of history; the shortest cadence here is biweekly.',
    ad_capital: 'The quant signal here is the same MultiFactorV3 measured on the Swing '
       + 'Book page. The discretionary sector fund is not published as a track record '
       + 'because its process changes every session and nothing would be attributable.',
    polymarket_btc: 'Measured, and negative: Polymarket\u2019s own price scores a better '
       + 'Brier than the model. That IS the result, and it is why the section is empty.',
    weather_risk: 'Severe-weather outcomes are scored against NOAA Storm Events after the '
       + 'fact, but the job is currently off and no forecast has been graded.',
    nba: 'The 2025-26 backtest scored 65.5% over 1,075 games, and 77.1% on picks it '
       + 'called at 70%+ confidence -- but that is a backtest held in the repo, not an '
       + 'out-of-sample record of the picks published here, so it is not quoted as one. '
       + 'The NBA season restarts in late October; a live record starts accruing then.',
    news: 'Nothing to measure: this reports what is being covered, and coverage is an '
       + 'observation rather than a forecast. There is no call here to be graded. The '
       + 'sentiment direction is deliberately not scored either \u2014 VADER mis-reads '
       + 'news language, and a track record for a number the project does not trust '
       + 'would be worse than none.',
    polymarket_whales: 'Nothing to measure, and deliberately so. This feed scores OTHER '
       + 'people\u2019s trading, not a forecast of ours, so there is no call here to be '
       + 'graded and no P&L to report. The project was built to look for manipulation '
       + 'and did not find any -- the verdict is latency arbitrage against slow makers, '
       + 'which is legal and unremarkable -- so it carries no manipulation field at all, '
       + 'and neither does this page.',
    opportunities: 'Nothing to measure: this board merges what other feeds already '
       + 'published and makes no prediction of its own. Each source carries its own '
       + 'record on its own page.',
};

// Below this the accuracy is noise and the panel must say so beside the number. Same
// threshold the site's validator calls FRAGILE_SAMPLE.
const FRAGILE_SAMPLE = 100;

const HISTORY = {
    options_levels: d => {
        const perf = d.performance;
        if (!perf) return null;
        const sign = v => (v >= 0 ? '+' : '') + (Number(v) * 100).toFixed(2) + '%';
        const rows = [
            ['Sessions', String(perf.sessions)],
            ['Trades taken', String(perf.trades)],
            ['Rejected', String(perf.rejected)],
            ['Starting equity', P.formatMoney(perf.starting_equity)],
            ['Equity now', P.formatMoney(perf.equity)],
            ['Realised PnL', P.formatMoney(perf.realized_pnl)],
            ['Return', sign(perf.return_pct)],
        ];
        let note = 'Live and out-of-sample, on simulated fills and 15-minute delayed data.';
        const b = d.backtest;
        if (b) {
            rows.push(['Backtest verdict', String(b.verdict)]);
            rows.push(['Measured edge', `${b.edge_pct}% per trade`]);
            rows.push(['Cost hurdle', `${b.hurdle_pct}%`]);
            note += ` The sweep behind it tested ${Number(b.triggers_tested).toLocaleString()}`
                 + ` triggers across ${Number(b.sets_swept).toLocaleString()} parameter sets`
                 + ` and returned "${b.verdict}" -- short of the hurdle by ${b.shortfall}.`
                 + ' This book runs forward to test that finding, not to showcase a result.';
        }
        return { rows, note };
    },
    f1: d => {
        const t = d.track_record;
        if (!t) return null;
        const rows = [
            ['Races scored', String(t.races_scored)],
            ['Winner called', `${t.winners_correct} of ${t.races_scored}`],
            ['Podium slots hit', `${t.podium_hits} of ${t.podium_slots}`],
            ['Mean position error', `${t.mean_abs_position_error} places`],
        ];
        if (t.mean_spearman != null) rows.push(['Rank correlation', String(t.mean_spearman)]);
        const fragile = t.races_scored < 5;
        return { rows, note: (t.basis ? `Scored from the ${t.basis}. ` : '')
            + (fragile
                ? `At ${t.races_scored} race${t.races_scored === 1 ? '' : 's'} this is far `
                  + `too small a sample to read as skill -- calling one winner and calling `
                  + `none look identical at this length. It is published because what was `
                  + `forecast and what happened are both facts; the hit rate is not yet a claim.`
                : 'Every grid was published before its race and is graded against the '
                  + 'official classification.') };
    },
    // Returns null until a published pick has been graded, so the panel falls through
    // to the NO_RECORD copy and switches itself over on the season's first result --
    // rather than needing someone to remember to edit this in October.
    nba: d => {
        const pr = d.published_record;
        if (!pr) return null;
        const rows = [
            ['Published picks graded', String(pr.n_games)],
            ['Correct', `${pct(pr.accuracy)} (${Math.round(pr.accuracy * pr.n_games)} of ${pr.n_games})`],
            [pr.baseline_label || 'baseline', pct(pr.baseline_accuracy)],
        ];
        rows.push(...bettingRows(pr.betting));
        const fragile = pr.n_games < FRAGILE_SAMPLE;
        return { rows, note: `Scored from the ${pr.basis}. `
            + (fragile
                ? `At ${pr.n_games} games this is far too small a sample to mean anything. `
                  + `It is published because what was forecast and what happened are both `
                  + `facts; the accuracy is not yet a claim.`
                : 'The repo also holds a backtest scoring 65.5%; this is not that. Only '
                  + 'picks that were on this page before tip-off are counted here.')
            + (pr.betting
                ? ` Priced ${pr.betting.basis}.`
                : '') };
    },
    swing_book: d => bookHistory(d),
    mf_book: d => bookHistory(d),
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
        // The number that matters more than accuracy: what the picks RETURNED once a
        // bookmaker charged for them.
        rows.push(...bettingRows(t.betting));
        const fragile = t.n_games < FRAGILE_SAMPLE;
        return { rows, note: (t.basis ? `Scored from the ${t.basis}. ` : '')
            + (fragile
                ? `At ${t.n_games} games this is far too small a sample to mean anything `
                  + `-- one week of NFL football is noise, a good week and a real edge look `
                  + `identical here, and "beats the baseline" stays unestablished until the `
                  + `difference is significant. It is published because what was forecast `
                  + `and what happened are both facts; the accuracy is not yet a claim.`
                : 'Measured against always-picking-home, the only baseline worth the '
                  + 'comparison.')
            + (t.betting
                ? ` Bets are placed only where the model's probability beats the price -- `
                  + `a pick is a view on who wins, a bet is a view on who wins relative `
                  + `to what it costs. Priced ${t.betting.basis}. `
                  + (t.betting.every_pick
                      ? `Backing every pick instead returns `
                        + `${(t.betting.every_pick.roi * 100).toFixed(1)}%, so the `
                        + `selection is doing real work here -- in which direction is `
                        + `not yet established at this sample size.`
                      : '')
                : '') };
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
        const pr = d.published_record;
        if (pr) {
            rows.push(['Published picks graded', String(pr.n_games)]);
            rows.push(['Accuracy on those', pct(pr.accuracy)]);
            rows.push(...bettingRows(pr.betting));
        }
        const gap = t.high_conf_realized != null
            ? Number(t.high_conf_realized) - Number(t.high_conf_stated) : null;
        return { rows, note: 'Accuracy against the always-pick-home baseline is the only '
            + 'comparison that means anything in baseball. '
            + (pr
                ? `The season figure is the model scored over ${t.n_games} games from our `
                  + `own database; the published figure is only the ${pr.n_games} picks `
                  + `that were on this page before first pitch. They are different claims `
                  + `and the second is the out-of-sample one. `
                : '')
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

function bookHistory(d) {
    const sign = v => (v >= 0 ? '+' : '') + (Number(v) * 100).toFixed(2) + '%';
    const rows = [
        ['Opened', d.started],
        ['Starting equity', P.formatMoney(d.starting_equity)],
        ['Equity now', P.formatMoney(d.equity)],
        ['Return', sign(d.return_pct)],
    ];
    if (d.benchmark_return_pct != null) {
        rows.push(['SPY, same window', sign(d.benchmark_return_pct)]);
        rows.push(['Excess', sign(d.excess_return_pct)]);
    }
    if (d.dividends_total) rows.push(['Dividends credited', P.formatMoney(d.dividends_total)]);
    if (d.days_live != null) rows.push(['Days live', String(d.days_live)]);

    let note = 'Live, out-of-sample, on simulated fills. The equity figure is Alpaca\u2019s '
        + 'own, so the curve above and this table cannot disagree.';
    if (d.backtest) {
        const b = d.backtest;
        rows.push(['Backtest return', sign(b.strategy_return)]);
        rows.push(['Backtest benchmark', sign(b.benchmark_return)]);
        note += ' The backtest rows are the claim this book was opened to test: it lost '
              + 'to buy-and-hold there, and the live number is the check on whether that '
              + 'was the strategy or the simulation.';
    }
    if (d.days_live != null && d.days_live < 30) {
        note += ' At ' + d.days_live + ' days this is far too short to read as anything; '
              + 'it is published from day one so the record cannot be started later and '
              + 'backdated to a good week.';
    }
    return { rows, note };
}

// --- Session-by-session record --------------------------------------------------
//
// `historyPanel` above is a summary: where a book stands now. This is the series behind
// it -- one row per session the book has traded, newest first -- because a single
// aggregate return cannot be checked and a run of them can. It is read straight off the
// payload, which already carries the series each book keeps for itself, so there is no
// second source to drift from what the book believes.
//
// Detail pages only. The home page asserts "this is what the model says now"; a ledger
// of past sessions is the opposite claim and does not belong beside it.

const SESSION_NOTE = 'Every row was published on the day it happened and is kept '
    + 'afterwards. Paper accounts on simulated fills -- the record is of the decisions, '
    + 'not of money made.';

// Per-session rows for the options book. It keeps its own history list, one entry per
// trading session, so the day's PnL is `equity` against that session's OWN open rather
// than a difference between two closes -- the two disagree whenever a session is missed,
// and a missed session is exactly when the number is worth reading.
function optionsSessions(data) {
    const hist = (data.performance || {}).history;
    if (!Array.isArray(hist) || !hist.length) return null;
    const rows = hist.slice().reverse().map(h => {
        const open = Number(h.equity_open) || 0;
        const chg = open ? (Number(h.equity) - open) / open : null;
        const facts = [];
        facts.push(`${h.taken || 0} taken`);
        if (h.closed) facts.push(`${h.closed} closed`);
        if (h.open) facts.push(`${h.open} still open at the bell`);
        if (h.rejected) facts.push(`${h.rejected} rejected`);
        if (h.unfilled) facts.push(`${h.unfilled} unfilled`);
        if (h.wins || h.losses) facts.push(`${h.wins || 0}W/${h.losses || 0}L`);
        if (h.watchlist) facts.push(`${h.watchlist} on the watchlist`);
        if (h.regime) facts.push(`regime ${h.regime}`);
        return {
            when: h.session,
            facts: facts.join(' | '),
            label: 'Day',
            value: chg == null ? '--' : (chg >= 0 ? '+' : '') + (chg * 100).toFixed(2) + '%',
            cls: chg == null ? '' : (chg >= 0 ? 'confidence-high' : 'confidence-low'),
            sub: P.formatMoney(h.equity),
        };
    });
    return { rows, note: SESSION_NOTE };
}

// Per-session rows for the two stock books, off the Alpaca equity curve. The day change
// is a difference between consecutive published points, so it spans whatever gap sits
// between them -- a weekend, or a session the job missed. Label it by both dates rather
// than calling it a day, which would be a quiet lie on exactly those rows.
function curveSessions(data) {
    const curve = data.equity_curve;
    if (!Array.isArray(curve) || curve.length < 1) return null;
    const base = Number(data.starting_equity) || null;
    const rows = curve.slice().reverse().map((pt, i, arr) => {
        const prev = arr[i + 1];
        const chg = prev && Number(prev.equity)
            ? (Number(pt.equity) - Number(prev.equity)) / Number(prev.equity) : null;
        const cum = base ? (Number(pt.equity) - base) / base : null;
        const facts = [];
        if (cum != null) {
            facts.push(`${(cum >= 0 ? '+' : '') + (cum * 100).toFixed(2)}% since inception`);
        }
        facts.push(prev ? `from ${prev.date}` : 'first published point');
        return {
            when: pt.date,
            facts: facts.join(' | '),
            label: prev ? 'Change' : 'Opened',
            value: chg == null ? '--' : (chg >= 0 ? '+' : '') + (chg * 100).toFixed(2) + '%',
            cls: chg == null ? '' : (chg >= 0 ? 'confidence-high' : 'confidence-low'),
            sub: P.formatMoney(pt.equity),
        };
    });
    return { rows, note: SESSION_NOTE + ' Equity points come from the broker\u2019s own '
        + 'portfolio history, so a closed day is the broker\u2019s close, not a number '
        + 'this site computed.' };
}

// One row per race already run, newest first: what was forecast beside what happened.
function f1Races(data) {
    const t = data.track_record;
    if (!t || !Array.isArray(t.races) || !t.races.length) return null;
    const rows = t.races.map(r => {
        const facts = [`predicted ${r.predicted_winner}, won by ${r.actual_winner}`,
                       `podium ${r.podium_hits}/3`,
                       `mean error ${r.mean_abs_position_error} places`];
        if (r.spearman != null) facts.push(`rho ${r.spearman}`);
        return {
            when: `R${r.round} ${r.race_name}`,
            facts: facts.join(' | '),
            label: 'Winner',
            value: r.winner_correct ? 'HIT' : 'miss',
            cls: r.winner_correct ? 'confidence-high' : 'confidence-low',
            sub: `${r.drivers_scored} drivers scored`,
        };
    });
    return { title: 'Race history', rows,
        note: 'Each grid was published to this page before its race and is '
        + 'graded against the official classification. Mean error is the average number '
        + 'of places between the forecast finishing position and the real one.' };
}

// Betting rows, shared by every sport that prices its picks. A bet is only taken when
// the model's probability beats the price, so the headline is the SELECTIVE record --
// and the every-pick arm sits beside it, because that comparison is what shows whether
// the selection is doing any work.
function bettingRows(b) {
    if (!b) return [];
    if (!b.bets) {
        return [['Bets placed', `none -- no side beat its price across `
                 + `${b.skipped_no_edge} game${b.skipped_no_edge === 1 ? '' : 's'}`]];
    }
    const rows = [
        [`Bet on edge, ${b.record}`,
         `${P.formatSigned(b.pnl)} on ${P.formatMoney(b.staked)} `
         + `(${(b.roi * 100).toFixed(1)}% ROI)`],
        ['Hit rate vs break-even',
         `${(b.hit_rate * 100).toFixed(1)}% against ${(b.break_even_hit_rate * 100).toFixed(1)}% needed`],
        ['Average edge claimed', `${(b.avg_edge * 100).toFixed(1)}% at ${b.avg_price} avg price`],
    ];
    if (b.skipped_no_edge) {
        rows.push(['Passed on', `${b.skipped_no_edge} game${b.skipped_no_edge === 1 ? '' : 's'} with no edge`]);
    }
    if (b.every_pick) {
        rows.push(['Backing every pick instead',
                   `${b.every_pick.record}, ${(b.every_pick.roi * 100).toFixed(1)}% ROI`]);
    }
    return rows;
}

// One row per week already played: the record, and what it returned.
function nflWeeks(data) {
    const t = data.track_record;
    if (!t || !Array.isArray(t.by_week) || !t.by_week.length) return null;
    const rows = t.by_week.map(w => {
        const facts = [`${w.correct} of ${w.games} correct`];
        if (w.bets != null) {
            facts.push(`${w.bets} bet${w.bets === 1 ? '' : 's'} priced`);
            facts.push(`${P.formatSigned(w.pnl)} flat`);
        }
        const roi = w.roi;
        return {
            when: `Week ${w.week}`,
            facts: facts.join(' | '),
            label: roi == null ? 'Accuracy' : 'Return',
            value: roi == null ? `${(w.accuracy * 100).toFixed(1)}%`
                               : `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}%`,
            cls: roi == null ? '' : (roi >= 0 ? 'confidence-high' : 'confidence-low'),
            sub: `${(w.accuracy * 100).toFixed(1)}% straight up`,
        };
    });
    return { title: 'Week by week', rows,
        note: 'Every pick was published to this page before kickoff. Accuracy counts all '
            + 'of them; return counts only the ones where the model\u2019s probability '
            + 'beat the price, flat $100 at the last quote before kickoff. A week can be '
            + 'won on accuracy and lost on price, and often is.' };
}

// One row per slate already played: the record, and what it returned. Shared by
// every daily-slate sport -- MLB and NBA publish an identical published_record.
function dailySlates(data) {
    const pr = data.published_record;
    if (!pr || !Array.isArray(pr.by_day) || !pr.by_day.length) return null;
    const rows = pr.by_day.map(d => {
        const facts = [`${d.correct} of ${d.games} correct`];
        if (d.bets != null) {
            facts.push(`${d.bets} priced`);
            facts.push(`${P.formatSigned(d.pnl)} flat`);
        }
        const roi = d.roi;
        return {
            when: P.formatDay(P.parseIsoDay(d.date)),
            facts: facts.join(' | '),
            label: roi == null ? 'Accuracy' : 'Return',
            value: roi == null ? `${(d.accuracy * 100).toFixed(0)}%`
                               : `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}%`,
            cls: roi == null ? '' : (roi >= 0 ? 'confidence-high' : 'confidence-low'),
            sub: `${(d.accuracy * 100).toFixed(0)}% straight up`,
        };
    });
    return { title: 'Slate by slate', rows,
        note: 'Every pick was published to this page before the game. Accuracy counts all '
            + 'of them; return counts only the ones where the model\u2019s probability '
            + 'beat the price, flat $100 at the last quote before the game.' };
}

const SESSIONS = {
    mlb: dailySlates,
    nba: dailySlates,
    nfl: nflWeeks,
    f1: f1Races,
    options_levels: optionsSessions,
    swing_book: curveSessions,
    mf_book: curveSessions,
};

function sessionsPanel(key, data) {
    const build = SESSIONS[key];
    const h = build ? build(data) : null;
    if (!h || !h.rows.length) return '';
    const rows = h.rows.map(r => `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${P.esc(r.when)}</span></div>
                    <div class="nba-meta">${P.esc(r.facts)}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">${P.esc(r.label)}</div>
                    <div class="nba-confidence ${r.cls}">${P.esc(r.value)}</div>
                    <div class="nba-meta">${P.esc(r.sub)}</div>
                </div>
            </div>`).join('');
    // Named by the feed: "sessions" is right for a book that trades a day at a time and
    // wrong for a race calendar, and a heading that misnames its own rows is the kind of
    // small dishonesty the rest of this page is careful to avoid.
    return `<h2 class="feed-sub">${P.esc(h.title || 'Session history')}</h2>`
        + `<div class="prediction-content">${rows}`
        + `<div class="prediction-note">${P.esc(h.note)}</div></div>`;
}


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
if (P.FEEDS.swing_book) P.FEEDS.swing_book.renderFull = renderBookFull;
if (P.FEEDS.mf_book) P.FEEDS.mf_book.renderFull = renderBookFull;

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
    const sessEl = document.getElementById('feed-sessions');
    if (data && data.generated_at) {
        factsEl.innerHTML = factsPanel(key, data, cfg);
        const hist = historyPanel(key, data);
        if (hist) histEl.innerHTML = hist; else histEl.remove();
        const sess = sessionsPanel(key, data);
        if (sess) sessEl.innerHTML = sess; else sessEl.remove();
    } else {
        factsEl.remove();
        histEl.remove();
        sessEl.remove();
    }
}

boot();

})();
