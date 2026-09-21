// ===== Prediction feeds: the shared engine =====
//
// Loaded by BOTH the home page (which renders every feed compactly) and feed.html
// (which renders one feed in full). It is one file because it was briefly two: the
// detail page started as a copy of these renderers, and a copy is how the two views
// drift into disagreeing about the same payload -- which on this site means one of
// them quietly showing a stale slate the other one refuses to show.
//
// Exposes window.Predictions. No build step, no modules: the rest of the site is
// plain script tags and this follows it.
// ===== Live Predictions =====
//
// Three states this has to get right, because a portfolio site asserting something
// false is worse than one asserting nothing:
//   off-season  -> say when the season starts; never claim "no games today"
//   stale       -> say when it was last published; do NOT show old numbers as current
//   fresh+empty -> "no games scheduled" is now a real statement, so make it
//
// Season windows are month/day so they recur every year without maintenance. They are
// approximate on purpose; a payload may override with season_status/next_season_start.

const MS_HOUR = 3600 * 1000;
const MS_DAY = 24 * MS_HOUR;

// The HEALTH vocabulary for a payload's top-level `status`, and the whole of it. Mirrors
// SOURCE_STATUS in .github/scripts/validate_predictions.py minus the two healthy values;
// test_status_vocabulary.py asserts the two stay in agreement. A feed is free to publish
// a DOMAIN state in the same field (some feeds publish a session state there,
// funding: ok/building_history) -- anything not listed here renders as normal content.
const HEALTH_STATUS = {
    stale: 'has gone quiet',
    missing: 'has not run yet',
    error: 'could not be read',
};

const SPORTS = {
    nba: {
        file: 'predictions/nba.json',
        container: 'nba-picks',
        stamp: 'nba-updated',
        cadence: 'daily',
        noun: 'picks',
        listKey: 'games',
        staleAfter: 36 * MS_HOUR,
        season: { startMonth: 10, startDay: 20, endMonth: 6, endDay: 30, startPhrase: 'late October' },
        emptyLabel: 'No games on the schedule today.',
        slate: d => {
            const day = parseIsoDay(d.date);
            return isNaN(day) ? '' : `${day.toLocaleDateString('en-US',
                { weekday: 'long', month: 'long', day: 'numeric' })} slate`;
        },
        render: renderTeamGames,
    },
    // MLB carries no pred_spread (win probability only) and its slate is published
    // in first-pitch order rather than sorted by confidence -- see the note rendered
    // under it, and predictions/README.md.
    mlb: {
        file: 'predictions/mlb.json',
        container: 'mlb-picks',
        stamp: 'mlb-updated',
        cadence: 'daily',
        noun: 'picks',
        listKey: 'games',
        staleAfter: 36 * MS_HOUR,
        season: { startMonth: 3, startDay: 20, endMonth: 11, endDay: 5, startPhrase: 'late March' },
        emptyLabel: 'No games on the schedule today.',
        slate: d => {
            const day = parseIsoDay(d.date);
            return isNaN(day) ? '' : `${day.toLocaleDateString('en-US',
                { weekday: 'long', month: 'long', day: 'numeric' })} slate`;
        },
        render: renderMlbGames,
    },
    nfl: {
        file: 'predictions/nfl.json',
        container: 'nfl-picks',
        stamp: 'nfl-updated',
        cadence: 'weekly',
        noun: 'picks',
        listKey: 'games',
                // 36h, not ten days. The slate only turns over weekly, but the job
        // publishes DAILY since 2026-09-15, and a ten-day window cannot tell a
        // healthy feed from one that died on a Tuesday -- which is exactly what
        // happened, unnoticed, until it was spotted by eye.
        staleAfter: 36 * MS_HOUR,
        season: { startMonth: 9, startDay: 4, endMonth: 2, endDay: 15, startPhrase: 'early September' },
        emptyLabel: 'No games on the schedule this week.',
        slate: d => {
            if (d.week == null) return '';
            const phase = { preseason: 'Preseason week', postseason: 'Postseason week' };
            const label = phase[d.season_type] || 'Week';
            return `${label} ${d.week}${d.season ? ` -- ${d.season} season` : ''}`;
        },
        render: renderTeamGames,
    },
    f1: {
        file: 'predictions/f1.json',
        container: 'f1-predictions',
        stamp: 'f1-updated',
        cadence: 'weekly',
        noun: 'predictions',
        listKey: 'predictions',
                // 36h: this publishes daily now, including between race weekends when it
        // says it is waiting on qualifying. A ten-day window was sized for the old
        // Thursday-only job and would hide a dead one for a week and a half.
        staleAfter: 36 * MS_HOUR,
        season: { startMonth: 3, startDay: 1, endMonth: 12, endDay: 10, startPhrase: 'March' },
        // Between race weekends there is nothing to forecast yet: the model's features
        // include the qualifying grid, and qualifying runs the day before the race. That
        // is a real state and distinct from "no race this weekend" -- saying the latter
        // while a named Grand Prix sits days away reads as a broken feed.
        emptyLabel: d => {
            if (d.awaiting === 'qualifying' && d.race_name) {
                // parseIsoDay first: formatDay takes a Date, and a bare YYYY-MM-DD
                // string reaches it as a string and throws.
                const day = d.race_date ? parseIsoDay(d.race_date) : null;
                const when = day && !isNaN(day) ? formatDay(day) : null;
                return `Next up: the ${d.race_name}${d.round ? ` (round ${d.round})` : ''}`
                    + `${when ? `, ${when}` : ''}. The grid is forecast from qualifying, so `
                    + `predictions land once qualifying has run -- not before.`;
            }
            return 'No race scheduled this weekend.';
        },
        render: renderF1,
    },
    // What the news is COVERING, ranked by how many independent outlets carry a topic.
    // Not a sentiment index: VADER mis-scores news language badly, so sentiment appears
    // as a coarse direction and only where the sample supports it. The payload's own
    // caveat says so and the contract refuses a payload that drops it.
    news: {
        file: 'predictions/news.json',
        container: 'news-topics',
        stamp: 'news-updated',
        cadence: 'hourly',
        noun: 'topics',
        listKey: 'topics',
        staleAfter: 12 * MS_HOUR,
        emptyLabel: 'No topic cleared the coverage threshold in this window.',
        slate: d => {
            const bits = [];
            if (d.articles_in_window) {
                bits.push(`${Number(d.articles_in_window).toLocaleString()} articles`);
            }
            if (d.window_hours) bits.push(`last ${d.window_hours}h`);
            if (d.collection_days) bits.push(`${d.collection_days} days collected`);
            return bits.join(' | ');
        },
        render: renderNews,
    },
    // A SNAPSHOT, not a forecast, and the only feed here that predicts nothing. It was
    // built to look for manipulation in Polymarket's 5-minute BTC markets and did not
    // find any; the repo deliberately carries no manipulation field and the verdict is
    // latency arbitrage. The page therefore leads with the traders and the disclaimer,
    // and never uses the word the project retired. No P&L: this measures other people's
    // trading, not ours, so there is nothing of ours to score.
    polymarket_whales: {
        file: 'predictions/polymarket_whales.json',
        container: 'whale-activity',
        stamp: 'whale-updated',
        cadence: 'daily',
        noun: 'traders',
        listKey: 'traders',
        staleAfter: 36 * MS_HOUR,
        emptyLabel: 'No wallet cleared the size threshold in this window.',
        slate: d => {
            const m = d.markets || {};
            const bits = [];
            if (m.resolved) bits.push(`${m.resolved} markets resolved`);
            if (m.late_flip != null && m.resolved) {
                bits.push(`${m.late_flip} flipped late (${(m.late_flip_rate * 100).toFixed(1)}%)`);
            }
            if (m.traded_notional) bits.push(`${formatMoney(m.traded_notional)} traded`);
            if (d.window && d.window.hours) bits.push(`last ${d.window.hours}h`);
            return bits.join(' | ');
        },
        render: renderWhales,
    },
    // Real estate has no season -- omitting `season` means never off-season. It is
    // also the one feed published from a local scheduled job rather than a GitHub
    // Action, because the scan scrapes Realtor.com and takes ~20 minutes; a weekly
    // cadence gives it a 10-day staleness window.
    real_estate: {
        file: 'predictions/real_estate.json',
        container: 'real-estate-deals',
        stamp: 'real-estate-updated',
        cadence: 'weekly',
        noun: 'candidates',
        listKey: 'deals',
        staleAfter: 10 * MS_DAY,
        emptyLabel: 'No listing currently clears the scoring threshold.',
        slate: d => {
            const markets = Array.isArray(d.markets) ? d.markets : [];
            return markets.length ? `Scanning ${markets.join(' | ')}` : '';
        },
        render: renderDeals,
    },
    // Cross-source board. No season. Published by a local aggregator job that merely
    // MERGES what each source repo already wrote, so it can be fresh while the sources
    // beneath it are not -- which is exactly why each section carries its own age and
    // the aggregator refuses to publish items for a section past its own budget.
    // `listKey` is 'sources': the list holds sections, not opportunities.
    opportunities: {
        file: 'predictions/opportunities.json',
        container: 'opportunities-board',
        stamp: 'opportunities-updated',
        cadence: 'daily',
        noun: 'sources',
        listKey: 'sources',
        staleAfter: 3 * MS_DAY,
        emptyLabel: 'No source has reported yet.',
        slate: d => {
            const fresh = Number(d.fresh_sources);
            const total = Array.isArray(d.sources) ? d.sources.length : 0;
            const n = Number(d.total_opportunities);
            if (!total) return '';
            return `${n} across ${fresh}/${total} live sources`;
        },
        render: renderOpportunities,
    },
    // Magic Formula stock screen. No season either, and published from a local weekly
    // job like real estate. The `warn` is the part that matters: this feed has two
    // independent staleness axes and `staleAfter` only covers one of them.
    magic_formula: {
        file: 'predictions/magicformula.json',
        container: 'magic-formula-ideas',
        stamp: 'magic-formula-updated',
        cadence: 'weekly',
        noun: 'ideas',
        listKey: 'ideas',
        staleAfter: 14 * MS_DAY,
        emptyLabel: 'No name currently clears the screen.',
        slate: d => {
            const n = Array.isArray(d.ideas) ? d.ideas.length : 0;
            const m = Number(d.min_market_cap_m);
            const cap = isFinite(m) && m > 0
                ? ` above ${m >= 1000 ? `$${m / 1000}B` : `$${m}M`} market cap`
                : '';
            return `Top ${n} of ${d.screened} ranked names${cap}`;
        },
        // The screen re-ranks weekly, so `generated_at` is always fresh. But the
        // universe it ranks is a list pasted in by hand from magicformulainvesting.com,
        // and that site only re-screens when new quarterly filings land. A weekly
        // re-rank of a two-quarter-old universe is a page that looks current and is
        // not, and no amount of freshness on `generated_at` would reveal it.
        //
        // This used to suppress the screen entirely. It no longer does: a hidden screen
        // and a broken feed look identical to a reader, the names are still real
        // rankings of real fundamentals, and the one thing actually at stake -- that
        // the universe behind them is old -- is better served by saying so loudly above
        // the list than by showing nothing and explaining the absence. The warning is
        // rendered above the rows, not instead of them.
        warn: (d, now) => {
            const pulled = parseIsoDay(d.universe_pulled);
            if (isNaN(pulled)) {
                return { cls: 'prediction-warn-hard', text: 'The screen did not report when '
                    + 'its universe was pulled, so the age of these names cannot be '
                    + 'established. Treat the ranking as undated.' };
            }
            const age = now - pulled;
            if (age > UNIVERSE_STALE) {
                return { cls: 'prediction-warn-hard', text: 'Universe last refreshed '
                    + `${relativeAge(age)} (${formatDay(pulled)}). The source re-screens `
                    + 'quarterly, so these names are ranked off filings that are no longer '
                    + 'current -- the ranking is real, the inputs are behind.' };
            }
            return { cls: 'prediction-warn', text: `Universe refreshed ${relativeAge(age)} `
                + `(${formatDay(pulled)}), within the quarterly re-screen window.` };
        },
        render: renderIdeas,
    },
    // Small-business acquisition screen. No season. Published nightly by a local
    // launchd job, and deliberately narrower than the screener's own CSVs: only the
    // marketplaces that answer plain HTTP are in this feed. BizBuySell is
    // Akamai-blocked and needs a manual pass, so its rows are months stale between
    // sweeps and would decay into dead links on a page claiming to be current.
    //
    // staleAfter matches the generator's own data-freshness gate (3 days). That gate
    // is why this feed needs no `warn` of its own: the generator refuses to write a
    // payload at all when the sweep behind it has gone stale, so a fresh
    // `generated_at` here really does imply fresh listings -- unlike the Magic Formula
    // feed, where the re-rank and the universe age independently.
    business_hunter: {
        file: 'predictions/businesses.json',
        container: 'business-hunter-deals',
        stamp: 'business-hunter-updated',
        cadence: 'daily',
        noun: 'candidates',
        listKey: 'businesses',
        staleAfter: 3 * MS_DAY,
        emptyLabel: 'Nothing currently prices below its fair-value band.',
        slate: d => {
            const names = (Array.isArray(d.sources) ? d.sources : [])
                .map(s => SOURCE_LABEL[s.name] || s.name).join(' | ');
            const shown = Array.isArray(d.businesses) ? d.businesses.length : 0;
            const parts = [`Top ${shown} of ${d.flagged} below band`];
            // The refused count is the honest part: those rows were looked at and
            // deliberately not scored, rather than quietly missing.
            parts.push(`${d.scored} scored, ${d.refused} refused of ${d.screened} screened`);
            return `${parts.join(' -- ')}${names ? ` | ${names}` : ''}`;
        },
        render: renderBusinesses,
    },
    // Cross-exchange funding carry, published hourly from a local job. The board is
    // deliberately NOT the scanner's top rows -- those are whichever altcoin is mid
    // funding spike, at four-figure APRs that are correct arithmetic and a false
    // promise, because the rate reverts long before the hold completes. Only routes
    // that stayed positive across most of the last day of scans are published, so a
    // short or empty board is the normal honest state rather than a broken feed.
    funding: {
        file: 'predictions/funding.json',
        container: 'funding-opportunities',
        stamp: 'funding-updated',
        cadence: 'hourly',
        noun: 'routes',
        listKey: 'opportunities',
        // Funding settles as often as hourly, so a board much older than this is
        // describing a market that has already turned over.
        staleAfter: 6 * MS_HOUR,
        emptyLabel: 'No route held a positive net carry across the last day of scans.',
        slate: d => {
            if (d.status === 'building_history') {
                return `Collecting scan history -- ${d.scans_seen || 0} hourly scans so far. `
                     + 'A route has to stay positive across most of a day before it is published.';
            }
            return `Positive in ${d.min_hits}+ of the last ${d.scans_seen} hourly scans`;
        },
        render: renderFunding,
    },
    // --- Board sections, promoted to panels of their own ---------------------
    //
    // These six live inside predictions/opportunities.json rather than in a file each:
    // the aggregator merges what every scanner published and writes one payload. They
    // used to render as one combined board, which meant six unrelated scanners shared a
    // single "Updated:" line -- so a scanner that had gone quiet for a week looked as
    // current as one that ran an hour ago.
    //
    // Split out, each panel reads its own section and uses that section's OWN `as_of`
    // and status. A quiet source now says so in its own header instead of hiding behind
    // the freshest one on the board. `section` is what tells the loader to unwrap.
    //
    // Sources whose repo already has a full panel here (magic_formula, real_estate,
    // funding_rate_arb) are deliberately NOT promoted -- they would be the same repo
    // twice, once in full and once as a three-row summary.
    funding_drift: boardSection('funding_drift', 'funding-drift',
        'No market currently shows a drift worth flagging.'),
    contracts: boardSection('contracts', 'contracts',
        'No recurring lane currently clears the evidence bar.'),
    stock_signals: boardSection('stock_signals', 'stock-signals',
        'No name currently carries a live swing signal.'),
    weather_risk: boardSection('weather_risk', 'weather-risk',
        'No city currently scores a severe-weather risk worth flagging.'),
    ad_capital: boardSection('ad_capital', 'ad-capital',
        'The scan ran and nothing cleared the bar.'),
    polymarket_btc: boardSection('polymarket_btc', 'polymarket-btc',
        'The model does not currently out-forecast the market, which is the finding.'),

    // The two live paper books. Both on their own dedicated Alpaca paper account, both
    // $100k, both publishing hourly-ish from a scheduled job. `staleAfter` is two
    // sessions: a book that has not reported since the day before last is a broken
    // job, not a quiet market.
    swing_book: {
        file: 'predictions/swing_book.json',
        container: 'swing-book',
        stamp: 'swing-book-updated',
        cadence: 'daily',
        noun: 'positions',
        listKey: 'positions',
        staleAfter: 4 * MS_DAY,
        emptyLabel: 'The book is in cash -- no signal currently clears the entry bar.',
        slate: d => bookSlate(d),
        render: renderBook,
    },
    mf_book: {
        file: 'predictions/mf_book.json',
        container: 'mf-book',
        stamp: 'mf-book-updated',
        cadence: 'daily',
        noun: 'positions',
        listKey: 'positions',
        staleAfter: 4 * MS_DAY,
        emptyLabel: 'No tranche has been bought yet.',
        slate: d => bookSlate(d),
        render: renderBook,
    },
    // Third paper book, and the honest one: the strategy behind it backtested NEGATIVE
    // before it was ever scheduled. It runs to gather out-of-sample evidence, not because
    // it is expected to make money -- the renderer says so on every load. Levels are
    // same-session only, so this expires overnight rather than after two days like the
    // position books.
    // Fourth paper book, successor to the options level feed. Five strategies in one
    // account, two of them funded at zero on purpose -- the roster is published so the
    // blended P&L cannot be read as though everything were live. Positions carry a cost
    // basis, so this expires after two sessions like the other books rather than
    // overnight like the levels feed it replaces.
    stock_levels: {
        file: 'predictions/stock_levels.json',
        container: 'stock-levels',
        stamp: 'stock-levels-updated',
        cadence: 'daily',
        noun: 'positions',
        listKey: 'positions',
        staleAfter: 4 * MS_DAY,
        emptyLabel: 'The book is flat -- no sleeve is holding.',
        slate: d => bookSlate(d),
        render: renderBook,
    }
};

// One section of the cross-source board, rendered as its own panel. `staleAfter` is
// generous because these scanners run on very different clocks -- the per-section
// status from the aggregator is the real freshness signal and it is rendered directly.
function boardSection(key, slug, emptyLabel) {
    return {
        file: 'predictions/opportunities.json',
        section: key,
        container: `${slug}-rows`,
        stamp: `${slug}-updated`,
        cadence: 'daily',
        noun: 'rows',
        listKey: 'opportunities',
        staleAfter: 7 * MS_DAY,
        emptyLabel,
        render: renderSectionRows,
    };
}

function renderSectionRows(data) {
    const rows = data.opportunities.map(o => {
        const link = o.link
            ? `<a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">${esc(o.title)}</a>`
            : esc(o.title);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams">${link}</div>
                    <div class="nba-meta">${esc(o.detail || '')}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-confidence confidence-med">${esc(o.metric_display)}</div>
                </div>
            </div>
        `;
    }).join('');
    // The caveat travels with the rows, exactly as it did on the combined board.
    // Several of these generators exist mainly to warn about their own output, and
    // splitting the board apart must not be how that warning gets dropped.
    return rows + (data.caveat
        ? `<div class="prediction-note">${esc(data.caveat)}</div>` : '');
}

const SOURCE_LABEL = { empireflippers: 'Empire Flippers', flippa: 'Flippa',
                       bizbuysell: 'BizBuySell' };

// A quarter plus a fortnight of slack. The source refreshes its fundamentals when its
// data provider delivers new filings, so a list older than this predates the current
// quarter's numbers entirely.
const UNIVERSE_STALE = 105 * MS_DAY;

const SPORT_LABEL = { swing_book: 'Swing book', mf_book: 'Magic Formula book',
                      funding_drift: 'Funding drift scan', contracts: 'Federal lanes scan',
                      stock_signals: 'Swing signals', weather_risk: 'Severe weather scan',
                      ad_capital: 'AD Capital scan', polymarket_btc: 'Polymarket BTC scan',
                      nba: 'NBA', nfl: 'NFL', mlb: 'MLB', f1: 'F1', real_estate: 'Real estate',
                      business_hunter: 'Business acquisitions',
                      magic_formula: 'Magic Formula', funding: 'Funding carry',
                      stock_levels: 'Stock levels book',
                      polymarket_whales: 'Polymarket whale watch',
                      news: 'News coverage' };

function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function formatStamp(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
}

function formatKickoff(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-US', {
        weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
}

function relativeAge(ms) {
    const days = Math.floor(ms / MS_DAY);
    if (days >= 60) return `${Math.round(days / 30)} months ago`;
    if (days >= 1) return days === 1 ? 'yesterday' : `${days} days ago`;
    const hours = Math.max(1, Math.floor(ms / MS_HOUR));
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

// Two traps in Date() that the contract's date fields hit directly:
//   - a bare YYYY-MM-DD is parsed as UTC midnight, so it renders as the PREVIOUS day
//     for every viewer west of Greenwich -- build it as a local date instead;
//   - Date() also happily parses loose prose ("September 2026" -> Sep 1), so a
//     malformed field yields a confident wrong date rather than a detectable one.
// Accept only the ISO forms the payload contract specifies; anything else is invalid.
function parseIsoDay(value) {
    const str = String(value == null ? '' : value);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return str.includes('T') ? new Date(str) : new Date(NaN);
}

function formatDay(d) {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

const mmdd = (m, d) => m * 100 + d;

function inSeason(win, now) {
    const cur = mmdd(now.getMonth() + 1, now.getDate());
    const start = mmdd(win.startMonth, win.startDay);
    const end = mmdd(win.endMonth, win.endDay);
    // A window that wraps the new year (NBA Oct->Jun) is the union of both ends.
    return start <= end ? (cur >= start && cur <= end) : (cur >= start || cur <= end);
}

function nextSeasonStart(win, now) {
    let d = new Date(now.getFullYear(), win.startMonth - 1, win.startDay);
    if (d <= now) d = new Date(now.getFullYear() + 1, win.startMonth - 1, win.startDay);
    return d;
}

function note(cls, text) {
    return `<p class="prediction-none ${cls}">${esc(text)}</p>`;
}

// --- Renderers ---

function renderTeamGames(data) {
    return data.games.map(g => {
        const conf = Number(g.confidence);
        const confClass = conf >= 0.6 ? 'confidence-high' : 'confidence-med';
        const awayCls = g.pick === g.away_team ? 'pick-team' : '';
        const homeCls = g.pick === g.home_team ? 'pick-team' : '';
        const meta = [];
        // Not every feed predicts a margin -- mlb.json has no pred_spread at all,
        // and Number(undefined) would render a confident "Spread: NaN".
        if (g.pred_spread != null) {
            const spread = Number(g.pred_spread);
            meta.push(`Spread: ${spread > 0 ? '+' : ''}${spread}`);
        }
        meta.push(`Home win: ${(Number(g.ml_win_prob) * 100).toFixed(0)}%`);
        if (g.pred_total != null) meta.push(`Total: ${g.pred_total}`);
        if (g._starters) meta.push(g._starters);
        if (g.kickoff) meta.push(formatKickoff(g.kickoff));
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams">
                        <span class="${awayCls}" title="${esc(g.away_team_full || g.away_team)}">${esc(g.away_team)}</span>
                        @
                        <span class="${homeCls}" title="${esc(g.home_team_full || g.home_team)}">${esc(g.home_team)}</span>
                    </div>
                    <div class="nba-meta">${esc(meta.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Pick</div>
                    <div class="nba-confidence ${confClass}">${esc(g.pick)} (${(conf * 100).toFixed(0)}%)</div>
                </div>
            </div>
        `;
    }).join('');
}

// MLB reuses the team-game rows and adds the two things that matter for a
// baseball slate: who is starting, and what the model's record actually is.
function renderMlbGames(data) {
    const withStarters = {
        ...data,
        games: data.games.map(g => {
            const sp = [g.away_starter, g.home_starter].filter(Boolean);
            if (sp.length !== 2) return g;
            return { ...g, pred_total: g.pred_total,
                     kickoff: g.kickoff, _starters: `${sp[0]} vs ${sp[1]}` };
        }),
    };
    return renderMlbRecord(data.track_record) + renderTeamGames(withStarters);
}

function renderMlbRecord(tr) {
    if (!tr) {
        return `<div class="deal-record">Track record not established for this `
            + `season yet.</div>`;
    }
    const pct = v => `${(Number(v) * 100).toFixed(1)}%`;
    const verdict = tr.beats_baseline
        ? `beats that baseline (McNemar p=${esc(String(tr.mcnemar_p_vs_baseline))})`
        : `does NOT beat that baseline (McNemar p=${esc(String(tr.mcnemar_p_vs_baseline))})`;
    let calib = '';
    // The confident picks are the number that looks good and is not an edge:
    // they are lopsided matchups a book prices at short odds, where break-even
    // is the model's own stated probability -- not the 52.4% of a pick-em game.
    if (tr.high_conf_stated != null && tr.high_conf_realized != null) {
        const gap = Number(tr.high_conf_realized) - Number(tr.high_conf_stated);
        calib = ` Its ${esc(String(tr.high_conf_n))} picks at `
            + `${esc(pct(tr.high_conf_threshold != null ? tr.high_conf_threshold : 0.6))}+ `
            + `stated confidence realized ${esc(pct(tr.high_conf_realized))} against `
            + `${esc(pct(tr.high_conf_stated))} stated -- `
            + `${gap < 0 ? 'overconfident' : 'well calibrated'} by `
            + `${esc((Math.abs(gap) * 100).toFixed(1))} points, so a high number `
            + `there is matchup lopsidedness, not an edge over the price.`;
    }
    return `
        <div class="deal-record">
            <strong>Measured track record, ${esc(String(tr.season))} season:</strong>
            ${esc(pct(tr.accuracy))} over ${esc(String(tr.n_games))} games against
            ${esc(pct(tr.baseline_accuracy))} for ${esc(tr.baseline_label || 'the baseline')},
            so it ${verdict}.${calib}
            Model output, not a betting recommendation.
        </div>
    `;
}

function renderF1(data) {
    const rows = data.predictions.map((p, i) => `
        <div class="f1-pos f1-pos-${i + 1}">P${i + 1}</div>
        <div class="f1-driver f1-pos-${i + 1}">${esc(p.driver)}</div>
        <div class="f1-score f1-pos-${i + 1}">${p.predicted_pos != null ? Number(p.predicted_pos).toFixed(1) : ''}</div>
    `).join('');
    return `
        <div class="f1-race-name">${esc(data.race_name)} ${esc(data.year)} -- Predicted finishing order</div>
        <div class="f1-grid">${rows}</div>
    `;
}

// Sign OUTSIDE the currency symbol. formatMoney(-23) gives "$-23", which reads as a
// typo rather than a loss, and every P&L on this site is signed.
function formatSigned(v) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return (n < 0 ? '-' : '+') + formatMoney(Math.abs(n));
}
function formatMoney(v) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
    return `$${Math.round(n)}`;
}

// The model explains 9.5% of rank variance. Publishing its picks without saying so
// would be the misrepresentation, so the track record renders above the list and the
// payload is refused by the validator if it quotes a record it cannot support.
function renderBusinesses(data) {
    const note = `
        <div class="deal-record">
            <strong>How to read this:</strong> the multiple is judged against a
            fair-value band for that listing's <em>earnings definition and size</em>,
            not a flat number -- SDE is EBITDA plus owner comp, so the same business
            prices at a higher multiple of one than the other. Bands come from IBBA
            Market Pulse and BizBuySell closed medians; online businesses get their own
            flat band. Financials are self-reported. "Vetted" means the marketplace
            screened the P&amp;L, <em>not</em> that anyone audited it. A cheap multiple
            is usually owner wages dressed as profit, so this is screening output for
            diligence -- not advice, and not a buy signal.
        </div>
    `;
    const rows = data.businesses.map(b => {
        const disc = Number(b.discount);
        const discClass = disc >= 0.5 ? 'confidence-high' : 'confidence-med';
        const facts = [SOURCE_LABEL[b.source] || b.source];
        if (b.vetted) facts.push('vetted P&L');
        if (b.state && b.state !== 'ONLINE') {
            facts.push([b.city, b.state].filter(Boolean).join(', '));
        } else {
            facts.push('online');
        }
        (Array.isArray(b.traits) ? b.traits : [])
            .filter(t => t !== 'online').forEach(t => facts.push(t));
        const title = b.url
            ? `<a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.title)}</a>`
            : esc(b.title);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams deal-address">${title}</div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                    <div class="nba-meta deal-prices">
                        ${esc(formatMoney(b.asking_price))} asking on
                        ${esc(formatMoney(b.cash_flow))} ${esc(b.cash_flow_type)}
                        -- ${esc(Number(b.multiple).toFixed(2))}x vs
                        ${esc(Number(b.fair_value).toFixed(2))}x band
                    </div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Below band</div>
                    <div class="nba-confidence ${discClass}">${(disc * 100).toFixed(0)}%</div>
                    <div class="nba-pick-label">score ${esc(Number(b.score).toFixed(0))}</div>
                </div>
            </div>
        `;
    }).join('');
    return note + rows;
}


function renderTrackRecord(tr) {
    if (!tr) {
        return `<div class="deal-record">Track record not established yet -- `
            + `fewer than 30 flagged listings have resolved.</div>`;
    }
    const pct = v => `${(Number(v) * 100).toFixed(1)}%`;
    return `
        <div class="deal-record">
            <strong>Measured track record:</strong>
            ${esc(String(tr.resolved))} flagged listings have since sold.
            Mean acquisition discount to comparable value ${esc(pct(tr.mean_edge))};
            ${esc(pct(tr.share_below_comp_value))} sold below it.
            Score-to-outcome rank correlation
            ${esc(Number(tr.spearman).toFixed(3))}
            (95% CI ${esc(Number(tr.ci_low).toFixed(3))} to ${esc(Number(tr.ci_high).toFixed(3))}),
            so the ranking carries real but modest information --
            about ${esc((Number(tr.spearman) ** 2 * 100).toFixed(0))}% of rank variance.
            Screening output, not advice.
        </div>
    `;
}

function renderDeals(data) {
    const rows = data.deals.map(d => {
        const disc = Number(d.discount_vs_comps);
        const discClass = disc >= 0.3 ? 'confidence-high' : 'confidence-med';
        const facts = [];
        if (d.beds != null && d.baths != null) facts.push(`${d.beds}bd/${d.baths}ba`);
        if (d.sqft != null) facts.push(`${Number(d.sqft).toLocaleString()} sqft`);
        if (d.year_built != null) facts.push(`built ${d.year_built}`);
        if (d.property_type) facts.push(String(d.property_type).replace(/_/g, ' ').toLowerCase());
        // Why it is cheap belongs next to how cheap it is: a big discount on a
        // full-gut candidate is not a big discount on move-in-ready.
        if (d.reno_scope) {
            facts.push(`${d.reno_scope} reno${d.reno_mid != null ? ` ~${formatMoney(d.reno_mid)}` : ''}`);
        }
        const addr = `${d.address}, ${d.city}, ${d.state} ${d.zip_code || ''}`.trim();
        const title = d.url
            ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(addr)}</a>`
            : esc(addr);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams deal-address">${title}</div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                    <div class="nba-meta deal-prices">
                        Listed ${esc(formatMoney(d.list_price))}
                        vs ${esc(formatMoney(d.comp_implied_value))} comparable value
                    </div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Below comps</div>
                    <div class="nba-confidence ${discClass}">${(disc * 100).toFixed(0)}%</div>
                    <div class="nba-pick-label">score ${esc(Number(d.score).toFixed(0))}</div>
                </div>
            </div>
        `;
    }).join('');
    return renderTrackRecord(data.track_record) + rows;
}

// The board is the only NESTED feed: each entry is a per-source section that carries
// its own freshness and its own caveat. The caveat is rendered as part of the section
// rather than tucked into a footnote, because several of these generators exist mainly
// to warn about their own output -- funding-drift's own study found its ranking is
// ~99% price momentum. A board that stripped that would be actively misleading.
function renderOpportunities(data) {
    const sections = Array.isArray(data.sources) ? data.sources : [];
    const quiet = { stale: 'went quiet', missing: 'has not run yet', error: 'could not be read' };

    const blocks = sections.map(s => {
        const items = Array.isArray(s.opportunities) ? s.opportunities : [];
        const age = s.age_hours != null ? `${Number(s.age_hours).toFixed(0)}h ago` : '';
        let body;
        if (items.length) {
            body = items.map(o => {
                const link = o.link
                    ? `<a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">${esc(o.title)}</a>`
                    : esc(o.title);
                return `
                    <div class="nba-game">
                        <div class="nba-matchup">
                            <div class="nba-teams">${link}</div>
                            <div class="nba-meta">${esc(o.detail || '')}</div>
                        </div>
                        <div class="nba-pick">
                            <div class="nba-confidence confidence-med">${esc(o.metric_display)}</div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            // Distinguish "scanned, found nothing" from "did not scan". They look the
            // same on a page that only shows an empty list, and they mean opposite things.
            const why = quiet[s.status] || 'found nothing that cleared the bar';
            body = `<p class="prediction-none">${esc(s.note || `This source ${why}.`)}</p>`;
        }
        return `
            <div class="opportunity-source">
                <div class="nba-meta opportunity-source-head">
                    <strong>${esc(s.label)}</strong>${age ? ` -- scanned ${esc(age)}` : ''}
                </div>
                ${body}
                <div class="prediction-note">${esc(s.caveat)}</div>
            </div>
        `;
    }).join('');

    return blocks + `<div class="prediction-note">${esc(data.methodology || '')}</div>`;
}

function renderIdeas(data) {
    return data.ideas.map(d => {
        const ey = Number(d.earnings_yield);
        const roc = Number(d.return_on_capital);
        // Earnings yield is the "how cheap" half of the formula, so it carries the
        // emphasis; 10% is roughly the line between cheap and merely reasonable.
        const eyClass = ey >= 0.10 ? 'confidence-high' : 'confidence-med';
        const facts = [];
        if (d.sector) facts.push(String(d.sector));
        if (d.market_cap != null) facts.push(`${formatMoney(d.market_cap)} mkt cap`);
        facts.push(`ROC ${(roc * 100).toFixed(0)}%`);
        if (d.ebit_basis) facts.push(`${d.ebit_basis} EBIT`);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(d.ticker)}</span>
                        <span class="idea-name">${esc(d.name)}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Earnings yield</div>
                    <div class="nba-confidence ${eyClass}">${(ey * 100).toFixed(1)}%</div>
                    <div class="nba-pick-label">rank ${esc(d.rank)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// Both books render identically -- they differ in strategy, not in shape, and a second
// renderer would be a second place for the "this is paper" framing to fall out of.
function bookSlate(d) {
    const pct = v => (v >= 0 ? '+' : '') + (Number(v) * 100).toFixed(2) + '%';
    const bits = [`${formatMoney(d.equity)} from ${formatMoney(d.starting_equity)}`];
    if (d.return_pct != null) bits.push(pct(d.return_pct));
    if (d.benchmark_return_pct != null) {
        bits.push(`SPY ${pct(d.benchmark_return_pct)}`);
    }
    if (d.excess_return_pct != null) bits.push(`${pct(d.excess_return_pct)} excess`);
    return bits.join(' | ');
}

// Topics ranked by BREADTH of coverage, not by volume and not by sentiment. A story
// carried by forty outlets is a story; the same count from one outlet's feed is not.
const NEWS_TONE = {
    positive: 'confidence-high',
    negative: 'confidence-low',
    mixed: '',
    unknown: '',
};

function renderNews(data) {
    const rows = data.topics.map(t => {
        const facts = [`${t.sources} outlets`, `${t.articles} articles`];
        if (t.surge != null) {
            // 1.0 is this topic's own recent norm, so the interesting part is the gap.
            const pct = (Number(t.surge) - 1) * 100;
            facts.push(`${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs its own norm`);
        }
        const head = t.headline
            ? `<div class="nba-meta">${t.headline_url
                ? `<a href="${esc(t.headline_url)}" target="_blank" rel="noopener">${esc(t.headline)}</a>`
                : esc(t.headline)}${t.headline_source ? ` &mdash; ${esc(t.headline_source)}` : ''}</div>`
            : '';
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(t.term)}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                    ${head}
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Tone</div>
                    <div class="nba-confidence ${NEWS_TONE[t.sentiment_direction] || ''}">${
                        esc(t.sentiment_direction)}</div>
                </div>
            </div>`;
    }).join('');
    // Printed from the payload rather than copied, so the page cannot drift from what
    // the tracker actually claims about its own sentiment scoring.
    return rows + `<div class="prediction-note">${esc(data.caveat || '')}</div>`;
}

// Wallets ranked by what they made in the window. `edge` is the audit verdict on the
// wallet's OWN full order flow, and "insufficient-history" is the common and honest
// answer -- a wallet seen for a day cannot be graded, and saying so beats a number.
const WHALE_EDGE_LABEL = {
    'late-window': 'edge in the final seconds',
    broad: 'profitable across the whole window',
    'unprofitable-overall': 'loses money across its full record',
    'insufficient-history': 'too little history to grade',
};

function renderWhales(data) {
    const rows = data.traders.map(t => {
        const roi = Number(t.net_roi);
        const facts = [`${Number(t.trades).toLocaleString()} trades`];
        if (t.markets_graded) facts.push(`${t.markets_graded} markets graded`);
        if (t.wins != null) facts.push(`${t.wins}W/${t.losses}L`);
        if (t.median_secs_before_close != null) {
            facts.push(`trades ${t.median_secs_before_close}s before close (median)`);
        }
        facts.push(WHALE_EDGE_LABEL[t.edge] || t.edge);
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(t.wallet)}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Window</div>
                    <div class="nba-confidence ${t.window_pnl >= 0 ? 'confidence-high' : 'confidence-low'}">${
                        esc((t.window_pnl >= 0 ? '+' : '-') + formatMoney(Math.abs(t.window_pnl || 0)))}</div>
                    <div class="nba-meta">${esc(`${(Number(t.win_rate) * 100).toFixed(1)}% wins, `
                        + `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}% ROI`)}</div>
                </div>
            </div>`;
    }).join('');
    // The disclaimer is rendered from the payload, not written here, so the page cannot
    // drift from the finding it is reporting.
    return rows + `<div class="prediction-note">${esc(data.disclaimer || '')}</div>`;
}

function renderBook(data) {
    const pct = v => (v >= 0 ? '+' : '') + (Number(v) * 100).toFixed(2) + '%';
    const rows = data.positions.map(p => {
        const cls = p.return_pct >= 0 ? 'confidence-high' : 'confidence-low';
        const facts = [`${p.qty} sh at ${formatMoney(p.avg_entry)}`,
                       `now ${formatMoney(p.price)}`,
                       `${formatMoney(p.market_value)} position`];
        if (p.dividends) facts.push(`${formatMoney(p.dividends)} dividends`);
        if (p.days_held != null) facts.push(`${p.days_held}d held`);
        if (p.sell_due) facts.push('SELL DUE');
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(p.ticker)}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Position</div>
                    <div class="nba-confidence ${cls}">${esc(pct(p.return_pct))}</div>
                    <div class="nba-meta">${esc((p.pnl >= 0 ? '+' : '-')
                        + formatMoney(Math.abs(p.pnl)))}</div>
                </div>
            </div>
        `;
    }).join('');
    return rows + `<div class="prediction-note">Paper account, simulated fills. Alpaca `
        + `paper does not model queue position or partial fills, so this is a large `
        + `improvement on a backtest and it is still not what a real book would have `
        + `done. Not advice, and nothing here is traded with real money.</div>`;
}

// The strategy this tracks was backtested to NEGATIVE expectancy before it was ever
// scheduled (1.29M triggers, 2021-2026). It runs forward anyway, in observe mode, to
// gather out-of-sample evidence -- so the page has to lead with that rather than bury it,
// or it becomes a portfolio site implying an edge that the author's own research denies.
function olMoney(v) {
    const n = Number(v) || 0;
    return (n >= 0 ? '+' : '-') + formatMoney(Math.abs(n));
}

function olBrief(data) {
    const b = data.brief;
    // Three states, and they are NOT the same thing. The brief is built once in the
    // pre-market window and there is no backfill, so a null brief means the window was
    // missed entirely -- on 2026-09-15 a four-hour DNS outage covered all of it, and the
    // session then opened at 13:25 ET with no brief and said nothing about it. Returning
    // '' here was the silent drop the `!b.ok` branch below was written to prevent.
    if (!b) {
        return note('prediction-note', 'No pre-market brief for this session -- it is '
            + 'built once before the open and was not built, so the screen below ran '
            + 'unfiltered. Nothing was excluded that a brief might have excluded.');
    }
    if (!b.ok) {
        // The brief is advisory and fails soft. Say so rather than showing nothing,
        // so a silently-missing brief is distinguishable from a quiet one.
        return note('prediction-note', 'Pre-market brief unavailable today; the session '
            + 'ran on the mechanical screen alone.');
    }
    const ev = (b.events || []).map(e =>
        `<li>${esc(e.time_et)} ET &mdash; <strong>${esc(e.name)}</strong> ${esc(e.detail)}</li>`
    ).join('');
    const ex = (b.exclusions || []).map(e =>
        `<li><strong>${esc(e.symbol)}</strong> excluded (${esc(e.reason)}) &mdash; ${esc(e.detail)}</li>`
    ).join('');
    return `
        <div class="nba-game">
            <div class="nba-matchup">
                <div class="nba-teams"><span class="pick-team">Pre-market read</span>
                    <span class="idea-name">${esc(b.regime || '')}</span></div>
                <div class="nba-meta">${esc(b.expectations || '')}</div>
                ${ev ? `<div class="nba-meta"><ul>${ev}</ul></div>` : ''}
                ${ex ? `<div class="nba-meta"><ul>${ex}</ul></div>`
                     : '<div class="nba-meta">No names excluded.</div>'}
            </div>
        </div>`;
}

function olLevels(data) {
    return (data.levels || []).map(l => {
        const t = (data.trades || []).find(x => x.symbol === l.symbol);
        const cls = t ? (t.status === 'rejected' ? 'confidence-low' : 'confidence-high')
                      : 'confidence-med';
        const state = t ? `${esc(t.status)} ${esc(t.side || '')}`.trim() : 'watching';
        const facts = [`OR ${Number(l.or_low).toFixed(2)}-${Number(l.or_high).toFixed(2)}`,
                       `${(Number(l.width_pct) * 100).toFixed(2)}% wide`,
                       `gap ${l.gap_pct >= 0 ? '+' : ''}${(Number(l.gap_pct) * 100).toFixed(2)}%`];
        // Where a break in each direction would be heading. Published before any trade
        // exists, so the page shows the idea rather than only reporting it afterwards.
        const aim = [];
        if (l.target_long != null) {
            aim.push(`up &rarr; ${Number(l.target_long).toFixed(2)} `
                   + `(${esc(l.target_long_name)}, ${(Number(l.target_long_pct) * 100).toFixed(2)}%)`);
        }
        if (l.target_short != null) {
            aim.push(`down &rarr; ${Number(l.target_short).toFixed(2)} `
                   + `(${esc(l.target_short_name)}, ${(Number(l.target_short_pct) * 100).toFixed(2)}%)`);
        }
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(l.symbol)}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                    ${aim.length ? `<div class="nba-meta">${aim.join(' &nbsp;|&nbsp; ')}</div>` : ''}
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">long above / short below</div>
                    <div class="nba-confidence ${cls}">${Number(l.long_trigger).toFixed(2)}
                        / ${Number(l.short_trigger).toFixed(2)}</div>
                    <div class="nba-pick-label">${esc(state)}</div>
                </div>
            </div>`;
    }).join('');
}

// What the bell decided for this position, and why. A close is as much a decision as a
// hold, so both are shown -- a page that only reports holds makes the gate look like it
// never fires.
function olHoldNote(t) {
    const h = t.hold_decision;
    if (!h) return '';
    const ev = h.event && h.event.kind && h.event.kind !== 'none'
        ? ` [${esc(h.event.kind)}: ${esc(h.event.detail || '')}]` : '';
    const label = h.hold ? 'held overnight' : 'closed at the bell';
    return `<div class="nba-meta">${esc(label)} &mdash; ${esc(h.reason || '')}${ev}</div>`;
}

function olTrades(data) {
    const taken = (data.trades || []).filter(t => t.status !== 'rejected');
    if (!taken.length) return '';
    const rows = taken.map(t => {
        const pnl = t.realized_pnl != null ? t.realized_pnl : t.unrealized_pnl;
        const settled = t.realized_pnl != null;
        const cls = (pnl || 0) >= 0 ? 'confidence-high' : 'confidence-low';
        const facts = [`${esc(t.side || '')} ${t.contracts || ''}x`,
                       esc(t.option_symbol || ''),
                       t.entry_fill != null ? `in ${Number(t.entry_fill).toFixed(2)}` : 'entry pending',
                       t.exit_fill != null ? `out ${Number(t.exit_fill).toFixed(2)}` : ''].filter(Boolean);
        const gate = t.rule_zero_passed ? 'Rule Zero passed' : 'Rule Zero FAILED';
        // The exit plan was fixed before the order went in and is never revised, so the
        // thesis shown here is the one the trade was actually taken on -- not a
        // reconstruction after the outcome was known.
        const plan = (t.plan_target != null && t.plan_stop != null)
            ? `target ${Number(t.plan_target).toFixed(2)}`
              + `${t.target_level ? ` (${esc(t.target_level)})` : ''}`
              + ` &middot; stop ${Number(t.plan_stop).toFixed(2)}`
              + `${t.reward_risk != null ? ` &middot; R:R ${Number(t.reward_risk).toFixed(2)}` : ''}`
            : '';
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(t.symbol)}</span>
                        <span class="idea-name">${esc(t.exit_reason || t.status)}</span></div>
                    <div class="nba-meta">${esc(facts.join(' | '))}</div>
                    ${plan ? `<div class="nba-meta">${plan}</div>` : ''}
                    ${t.thesis ? `<div class="nba-meta"><em>${esc(t.thesis)}</em></div>` : ''}
                    ${olHoldNote(t)}
                    <div class="nba-meta">${esc(gate)}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">${settled ? 'realised' : 'open mark'}</div>
                    <div class="nba-confidence ${cls}">${olMoney(pnl)}</div>
                </div>
            </div>`;
    }).join('');
    return `<div class="prediction-note"><strong>Trades today</strong></div>` + rows;
}

function olPerformance(data) {
    const p = data.performance || {};
    if (!p.sessions) return '';
    const rows = (p.history || []).slice().reverse().slice(0, 15).map(h => {
        const cls = (h.realized_pnl || 0) >= 0 ? 'confidence-high' : 'confidence-low';
        const bits = [`${h.taken || 0} taken`, `${h.closed || 0} closed`,
                      `${h.watchlist || 0} levels`];
        if (h.regime) bits.push(esc(h.regime));
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams"><span class="pick-team">${esc(h.session)}</span></div>
                    <div class="nba-meta">${esc(bits.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">realised</div>
                    <div class="nba-confidence ${cls}">${olMoney(h.realized_pnl)}</div>
                </div>
            </div>`;
    }).join('');
    const hit = p.hit_rate != null
        ? `${(p.hit_rate * 100).toFixed(0)}% hit rate on ${p.closed} closed`
        : `${p.closed || 0} closed &mdash; too few to quote a hit rate`;
    const head = `<div class="prediction-note"><strong>Performance</strong> &mdash; `
        + `${p.sessions} session${p.sessions === 1 ? '' : 's'} since ${esc(p.since)}, `
        + `${p.trades || 0} trades taken, ${hit}. Realised ${olMoney(p.realized_pnl)}; `
        + `equity ${formatMoney(p.equity)} from ${formatMoney(p.starting_equity)}.</div>`;
    return head + rows;
}

// The strategy this tracks was backtested to NEGATIVE expectancy before it was ever
// scheduled (1.29M triggers, 2021-2026). It runs forward anyway, in observe mode, to
// gather out-of-sample evidence -- so the page leads with that rather than burying it,
// or it becomes a portfolio implying an edge the author's own research denies.
function renderOptionsLevels(data) {
    const b = data.backtest || {};
    const g = data.gate_split || {};
    let gateLine = '';
    if (g.conclusive) {
        gateLine = ` Rule Zero split so far: ${olMoney(g.passed_avg)}/trade when the gate `
                 + `passed (n=${g.passed_n}) against ${olMoney(g.failed_avg)} when it failed `
                 + `(n=${g.failed_n}).`;
    } else if ((g.passed_n || 0) + (g.failed_n || 0) > 0) {
        gateLine = ` Too few closed trades (${(g.passed_n || 0) + (g.failed_n || 0)}) to say `
                 + `whether the Rule Zero gate discriminates.`;
    }
    const findings = (b.findings || []).map(f =>
        `<li><strong>${esc(f.constraint)}</strong> &mdash; ${esc(f.fix)}: ${esc(f.result)}</li>`
    ).join('');
    return olBrief(data) + olLevels(data) + olTrades(data) + olPerformance(data)
        + (findings ? `<div class="prediction-note"><strong>What the backtest found</strong>`
            + `<ul>${findings}</ul>Each fix is real and uncovers the next binding `
            + `constraint; the total never crosses zero. That is what a strategy with no `
            + `edge looks like from the inside.</div>` : '')
        + `<div class="prediction-note">`
        + `<strong>This strategy tested negative.</strong> A sweep of ${esc(b.sets_swept)} `
        + `parameter sets over ${esc(b.triggers_tested)} opening-range breaks (2021-2026) put `
        + `the signal at about ${esc(b.edge_pct)}% per trade against a ${esc(b.hurdle_pct)}% `
        + `option cost hurdle &mdash; short by ${esc(b.shortfall)}. Longer holds do not rescue `
        + `it; the edge stops at the closing bell. The book runs forward in observe mode to `
        + `collect out-of-sample evidence, which means trades are taken whether or not the `
        + `Rule Zero gate approves them, and the verdict is recorded either way.${gateLine}`
        + ` Intraday only, flat by 15:50 ET, expiries four weeks or less. Levels are computed `
        + `from consolidated data that arrives ${esc(data.data_lag_minutes)} minutes late, so `
        + `this is a deliberately lagged record, not a live signal. Alpaca paper account, `
        + `simulated fills, free-tier option quotes that are indicative rather than real `
        + `NBBO. Not advice, and nothing here is traded with real money.</div>`;
}

function renderFunding(data) {
    return data.opportunities.map(o => {
        // Lead with the per-hold return, not the annualised one. A funding carry is
        // held for hours, so "+0.038% over an 8h hold" is what actually happens and
        // "~42% APR" is the extrapolation from it. Showing the extrapolation first
        // is how a board of four-figure percentages stops reading as a claim.
        const hold = `${o.min_hold_h}h`;
        const legs = o.long_instrument === 'spot'
            ? `long ${o.long_venue} spot, short ${o.short_venue} perp`
            : `long ${o.long_venue}, short ${o.short_venue}`;
        const meta = [legs];
        if (o.cost_bps != null) meta.push(`round trip ${Number(o.cost_bps).toFixed(0)}bp`);
        const rate = Number(o.net_at_hold);
        const apr = Number(o.net_apr);
        // Persistence is the reason the row is on the page at all, so show it.
        const hitRate = o.scans ? o.hits / o.scans : 0;
        const confClass = hitRate >= 0.9 ? 'confidence-high' : 'confidence-med';
        return `
            <div class="nba-game">
                <div class="nba-matchup">
                    <div class="nba-teams">${esc(o.base)}</div>
                    <div class="nba-meta">${esc(meta.join(' | '))}</div>
                </div>
                <div class="nba-pick">
                    <div class="nba-pick-label">Net per ${esc(hold)} hold</div>
                    <div class="nba-confidence ${confClass}">${rate >= 0 ? '+' : ''}${rate.toFixed(3)}%</div>
                    <div class="nba-meta">~${apr.toFixed(0)}% APR | ${esc(o.hits)}/${esc(o.scans)} scans</div>
                </div>
            </div>
        `;
    }).join('');
}

// --- Loader ---

// opts.container / opts.stamp  -- render into different element ids (feed.html)
// opts.full                    -- use the feed's fuller renderer where it has one
// Returns the payload it rendered, or null. Callers on the detail page use that for
// their own header; the home page ignores it.
async function loadFeed(key, opts) {
    opts = opts || {};
    const cfg = SPORTS[key];
    if (!cfg) return null;
    const container = document.getElementById(opts.container || cfg.container);
    const stampEl = document.getElementById(opts.stamp || cfg.stamp);
    if (!container || !stampEl) return null;

    const label = SPORT_LABEL[key];
    const now = new Date();

    let data = null;
    // 404 and "the fetch blew up" are different facts and the page says different
    // things about them. A feed whose file does not exist yet has never published --
    // telling a reader it "may be down" invents an outage that is not happening.
    let missing = false;
    try {
        const resp = await fetch(cfg.file, { cache: 'no-cache' });
        if (resp.status === 404) { missing = true; throw new Error('404'); }
        if (!resp.ok) throw new Error(String(resp.status));
        data = await resp.json();
    } catch (e) {
        data = null;
    }

    // A section feed carries the whole board; unwrap to the one source this panel is
    // for, and adopt that section's OWN as_of. Using the board's generated_at here is
    // exactly the bug the split was made to fix -- the aggregator is fresh whenever it
    // last ran, regardless of how long ago the scanner beneath it stopped.
    if (data && cfg.section) {
        const sec = (data.sources || []).find(x => x && x.source === cfg.section);
        data = sec ? { ...sec, generated_at: sec.as_of || data.generated_at } : null;
        if (!data) missing = true;
    }

    // A payload may override the built-in (approximate) season window. A feed with
    // no season window at all (real estate) is never off-season.
    const status = data && data.season_status;
    const off = status ? status !== 'in_season'
        : (cfg.season ? !inSeason(cfg.season, now) : false);

    if (off) {
        // An unparseable next_season_start must fall back to the computed window --
        // the old code called getFullYear() on the Invalid Date and published
        // "resume when the season starts, early September NaN".
        const override = data && data.next_season_start
            ? parseIsoDay(data.next_season_start)
            : null;
        const usable = override && !isNaN(override);
        const when = usable
            ? formatDay(override)
            : `${cfg.season.startPhrase} ${nextSeasonStart(cfg.season, now).getFullYear()}`;
        stampEl.textContent = 'Off-season';
        container.innerHTML = note('prediction-offseason',
            `${label} is between seasons. ${cfg.cadence === 'daily' ? 'Daily' : 'Weekly'} ${cfg.noun} resume when the season starts, ${when}.`);
        return data;
    }

    if (!data) {
        if (missing) {
            stampEl.textContent = 'Not published yet';
            container.innerHTML = note('prediction-pending',
                `The ${label} has not published to this page yet.`);
            return null;
        }
        stampEl.textContent = 'Unavailable';
        container.innerHTML = note('prediction-error',
            `Could not load the ${label} model output. The feed may be down.`);
        return null;
    }

    if (!data.generated_at) {
        stampEl.textContent = 'Not published yet';
        container.innerHTML = note('prediction-pending',
            `The ${label} model has not published to this page yet.`);
        return data;
    }

    const generated = new Date(data.generated_at);
    if (isNaN(generated)) {
        stampEl.textContent = 'Unavailable';
        container.innerHTML = note('prediction-error', `The ${label} payload has an unreadable timestamp.`);
        return data;
    }

    const age = now - generated;
    stampEl.textContent = `Updated: ${formatStamp(data.generated_at)}`;

    // Stale handling differs by surface, and the difference is the whole point.
    //
    // The home page asserts "this is current", so it must NOT render stale numbers --
    // presenting an old slate as today's is the failure this block was written for.
    //
    // A detail page asserts nothing of the kind: it is that model's own page, where the
    // last run is the record of what was forecast and is worth keeping. So it renders
    // the rows under an explicit archive banner instead of throwing them away, up to a
    // much longer window (`archiveAfter`). Discarding a past forecast is also how a
    // model's history quietly stops being auditable.
    const stale = age > cfg.staleAfter;
    let archived = null;
    if (stale) {
        stampEl.textContent = `Last published ${relativeAge(age)}`;
        const archiveAfter = cfg.archiveAfter || (cfg.staleAfter * 12);
        if (!opts.full || age > archiveAfter) {
            container.innerHTML = note('prediction-stale',
                `${label} ${cfg.noun} are out of date -- last published ${relativeAge(age)} `
                + `(${formatStamp(data.generated_at)}). Showing nothing rather than a stale slate.`
                + (opts.full ? '' : ' The full run is kept on this feed\u2019s own page.'));
            return data;
        }
        archived = `This is the LAST PUBLISHED run, from ${formatStamp(data.generated_at)} `
            + `(${relativeAge(age)}) -- kept here as the record of what was forecast. It is `
            + `not current, and it is not on the home page for that reason.`;
    }

    // A warning sits ABOVE the content rather than replacing it. Suppressing a feed and
    // failing to load one look identical to a reader; saying what is wrong with output
    // that is still on screen tells them more than an empty panel with an excuse.
    // The aggregator already decided this section's status and publishes NO items for
    // anything past its own budget. Surface its words rather than second-guessing them.
    //
    // Match ONLY the health vocabulary (validate_predictions.py SOURCE_STATUS). `status`
    // is not reserved: some feeds publish a session state there
    // (armed/in_position/closed/no_session) and funding publishes ok/building_history.
    // Treating any unrecognised value as a health failure suppressed both feeds entirely
    // -- a book holding five live option positions rendered as "This scanner is not
    // reporting" while its own slate() was already written to describe that exact state.
    const unhealthy = HEALTH_STATUS[data.status];
    if (unhealthy) {
        stampEl.textContent = data.status === 'missing'
            ? 'Not published yet' : `Last scan ${relativeAge(age)}`;
        container.innerHTML = note('prediction-stale',
            data.note || `This scanner ${unhealthy}.`)
            + (data.caveat ? `<div class="prediction-note">${esc(data.caveat)}</div>` : '');
        return data;
    }

    const warned = cfg.warn ? cfg.warn(data, now) : null;
    const banner = (archived ? `<p class="prediction-banner prediction-archived">${esc(archived)}</p>` : '')
        + (warned ? `<p class="prediction-banner ${warned.cls}">${esc(warned.text)}</p>` : '');

    const items = data[cfg.listKey];
    if (!Array.isArray(items) || items.length === 0) {
        // A feed may compute its empty message from the payload: "nothing to show" and
        // WHY there is nothing to show are different statements, and the second one is
        // the useful one.
        const label = typeof cfg.emptyLabel === 'function'
            ? cfg.emptyLabel(data) : cfg.emptyLabel;
        container.innerHTML = banner + note('', label);
        return data;
    }

    const slate = cfg.slate ? cfg.slate(data) : '';
    const render = (opts.full && cfg.renderFull) ? cfg.renderFull : cfg.render;
    container.innerHTML = banner
        + (slate ? `<div class="prediction-slate">${esc(slate)}</div>` : '')
        + render(data);
    return data;
}

window.Predictions = {
    FEEDS: SPORTS,
    LABEL: SPORT_LABEL,
    load: loadFeed,
    esc, note, formatStamp, formatDay, formatMoney, formatKickoff,
    relativeAge, parseIsoDay, formatSigned,
    MS_HOUR, MS_DAY,
};
