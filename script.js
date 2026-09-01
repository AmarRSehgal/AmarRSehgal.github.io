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
        staleAfter: 36 * MS_HOUR,
        season: { startMonth: 10, startDay: 20, endMonth: 6, endDay: 30, startPhrase: 'late October' },
        emptyLabel: 'No games on the schedule today.',
        render: renderTeamGames,
    },
    nfl: {
        file: 'predictions/nfl.json',
        container: 'nfl-picks',
        stamp: 'nfl-updated',
        cadence: 'weekly',
        noun: 'picks',
        staleAfter: 10 * MS_DAY,
        season: { startMonth: 9, startDay: 4, endMonth: 2, endDay: 15, startPhrase: 'early September' },
        emptyLabel: 'No games on the schedule this week.',
        render: renderTeamGames,
    },
    f1: {
        file: 'predictions/f1.json',
        container: 'f1-predictions',
        stamp: 'f1-updated',
        cadence: 'weekly',
        noun: 'predictions',
        staleAfter: 10 * MS_DAY,
        season: { startMonth: 3, startDay: 1, endMonth: 12, endDay: 10, startPhrase: 'March' },
        emptyLabel: 'No race scheduled this weekend.',
        render: renderF1,
    },
};

const SPORT_LABEL = { nba: 'NBA', nfl: 'NFL', f1: 'F1' };

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

    // A payload may override the built-in (approximate) season window.
    const status = data && data.season_status;
    const off = status ? status !== 'in_season' : !inSeason(cfg.season, now);

    if (off) {
        const start = data && data.next_season_start
            ? new Date(data.next_season_start)
            : nextSeasonStart(cfg.season, now);
        const when = data && data.next_season_start && !isNaN(start)
            ? start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : `${cfg.season.startPhrase} ${start.getFullYear()}`;
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

    const items = cfg.render === renderF1 ? data.predictions : data.games;
    if (!Array.isArray(items) || items.length === 0) {
        container.innerHTML = note('', cfg.emptyLabel);
        return;
    }

    container.innerHTML = cfg.render(data);
}

Object.keys(SPORTS).forEach(loadSport);
