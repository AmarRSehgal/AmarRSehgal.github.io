// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

toggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('active');
    toggle.setAttribute('aria-expanded', String(open));
});

// Close mobile nav on link click
navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
    });
});

// Subtle nav shadow on scroll
const nav = document.querySelector('nav');
window.addEventListener('scroll', () => {
    nav.style.boxShadow = window.scrollY > 10
        ? '0 1px 12px rgba(0,0,0,0.5)'
        : 'none';
});

// Footer year, so it never goes stale
const yearEl = document.getElementById('footer-year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

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
    nfl: {
        file: 'predictions/nfl.json',
        container: 'nfl-picks',
        stamp: 'nfl-updated',
        cadence: 'weekly',
        noun: 'picks',
        listKey: 'games',
        staleAfter: 10 * MS_DAY,
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
        staleAfter: 10 * MS_DAY,
        season: { startMonth: 3, startDay: 1, endMonth: 12, endDay: 10, startPhrase: 'March' },
        emptyLabel: 'No race scheduled this weekend.',
        render: renderF1,
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
    // job like real estate. The `gate` is the part that matters: this feed has two
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
        gate: (d, now) => {
            // The screen re-ranks weekly, so `generated_at` is always fresh. But the
            // universe it ranks is a list pasted in by hand from
            // magicformulainvesting.com, and that site only re-screens when new
            // quarterly filings land. A weekly re-rank of a two-quarter-old universe is
            // a page that looks current and is not, and no amount of freshness on
            // `generated_at` would reveal it.
            const pulled = parseIsoDay(d.universe_pulled);
            if (isNaN(pulled)) {
                return { cls: 'prediction-stale', text: 'The screen did not report when its '
                    + 'universe was pulled, so its age cannot be shown. Not publishing '
                    + 'names without it.' };
            }
            const age = now - pulled;
            if (age > UNIVERSE_STALE) {
                return { cls: 'prediction-stale', text: 'The candidate universe was last '
                    + `pulled ${relativeAge(age)} (${formatDay(pulled)}), and the source `
                    + 're-screens quarterly -- so these names are behind the current '
                    + 'filings. Showing nothing rather than a stale screen.' };
            }
            return null;
        },
        render: renderIdeas,
    },
};

// A quarter plus a fortnight of slack. The source refreshes its fundamentals when its
// data provider delivers new filings, so a list older than this predates the current
// quarter's numbers entirely.
const UNIVERSE_STALE = 105 * MS_DAY;

const SPORT_LABEL = { nba: 'NBA', nfl: 'NFL', f1: 'F1', real_estate: 'Real estate',
                      magic_formula: 'Magic Formula' };

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
        const spread = Number(g.pred_spread);
        const meta = [
            `Spread: ${spread > 0 ? '+' : ''}${spread}`,
            `Home win: ${(Number(g.ml_win_prob) * 100).toFixed(0)}%`,
        ];
        if (g.pred_total != null) meta.push(`Total: ${g.pred_total}`);
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

// --- Loader ---

async function loadSport(key) {
    const cfg = SPORTS[key];
    const container = document.getElementById(cfg.container);
    const stampEl = document.getElementById(cfg.stamp);
    if (!container) return;

    const label = SPORT_LABEL[key];
    const now = new Date();

    let data = null;
    try {
        const resp = await fetch(cfg.file, { cache: 'no-cache' });
        if (!resp.ok) throw new Error(String(resp.status));
        data = await resp.json();
    } catch (e) {
        data = null;
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
        return;
    }

    if (!data) {
        stampEl.textContent = 'Unavailable';
        container.innerHTML = note('prediction-error',
            `Could not load the ${label} model output. The feed may be down.`);
        return;
    }

    if (!data.generated_at) {
        stampEl.textContent = 'Not published yet';
        container.innerHTML = note('prediction-pending',
            `The ${label} model has not published to this page yet.`);
        return;
    }

    const generated = new Date(data.generated_at);
    if (isNaN(generated)) {
        stampEl.textContent = 'Unavailable';
        container.innerHTML = note('prediction-error', `The ${label} payload has an unreadable timestamp.`);
        return;
    }

    const age = now - generated;
    stampEl.textContent = `Updated: ${formatStamp(data.generated_at)}`;

    // Deliberately do NOT render stale numbers -- presenting an old slate as today's
    // is the failure mode this whole block exists to prevent.
    if (age > cfg.staleAfter) {
        stampEl.textContent = `Last published ${relativeAge(age)}`;
        container.innerHTML = note('prediction-stale',
            `${label} ${cfg.noun} are out of date -- last published ${relativeAge(age)} `
            + `(${formatStamp(data.generated_at)}). Showing nothing rather than a stale slate.`);
        return;
    }

    const gated = cfg.gate ? cfg.gate(data, now) : null;
    if (gated) {
        container.innerHTML = note(gated.cls, gated.text);
        return;
    }

    const items = data[cfg.listKey];
    if (!Array.isArray(items) || items.length === 0) {
        container.innerHTML = note('', cfg.emptyLabel);
        return;
    }

    const slate = cfg.slate ? cfg.slate(data) : '';
    container.innerHTML = (slate ? `<div class="prediction-slate">${esc(slate)}</div>` : '')
        + cfg.render(data);
}

Object.keys(SPORTS).forEach(loadSport);
