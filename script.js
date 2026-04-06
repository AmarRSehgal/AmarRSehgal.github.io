// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

toggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

// Close mobile nav on link click
navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
    });
});

// Subtle nav shadow on scroll
const nav = document.querySelector('nav');
window.addEventListener('scroll', () => {
    nav.style.boxShadow = window.scrollY > 10
        ? '0 1px 12px rgba(0,0,0,0.5)'
        : 'none';
});

// ===== Live Predictions =====
const BASE = '';  // relative path, same repo

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
}

// --- NBA ---
async function loadNBAPicks() {
    const container = document.getElementById('nba-picks');
    const dateEl = document.getElementById('nba-updated');

    try {
        const resp = await fetch(`${BASE}/predictions/nba.json`);
        if (!resp.ok) throw new Error('not found');
        const data = await resp.json();

        dateEl.textContent = `Updated: ${formatDate(data.generated_at)}`;

        if (!data.games || data.games.length === 0) {
            container.innerHTML = '<p class="prediction-none">No games scheduled today.</p>';
            return;
        }

        container.innerHTML = data.games.map(g => {
            const confClass = g.confidence >= 0.6 ? 'confidence-high' : 'confidence-med';
            const awayBold = g.pick === g.away_team ? 'pick-team' : '';
            const homeBold = g.pick === g.home_team ? 'pick-team' : '';
            return `
                <div class="nba-game">
                    <div class="nba-matchup">
                        <div class="nba-teams">
                            <span class="${awayBold}">${g.away_team}</span> @ <span class="${homeBold}">${g.home_team}</span>
                        </div>
                        <div class="nba-meta">
                            Spread: ${g.pred_spread > 0 ? '+' : ''}${g.pred_spread} | Home win: ${(g.ml_win_prob * 100).toFixed(0)}%
                        </div>
                    </div>
                    <div class="nba-pick">
                        <div class="nba-pick-label">Pick</div>
                        <div class="nba-confidence ${confClass}">${g.pick} (${(g.confidence * 100).toFixed(0)}%)</div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        container.innerHTML = '<p class="prediction-none">No picks available yet. Check back soon.</p>';
        dateEl.textContent = '';
    }
}

// --- F1 ---
async function loadF1Predictions() {
    const container = document.getElementById('f1-predictions');
    const dateEl = document.getElementById('f1-updated');

    try {
        const resp = await fetch(`${BASE}/predictions/f1.json`);
        if (!resp.ok) throw new Error('not found');
        const data = await resp.json();

        dateEl.textContent = `Updated: ${formatDate(data.generated_at)}`;

        if (!data.predictions || data.predictions.length === 0) {
            container.innerHTML = '<p class="prediction-none">No upcoming race predictions available.</p>';
            return;
        }

        container.innerHTML = `
            <div class="f1-race-name">${data.race_name} ${data.year} -- Predicted finishing order</div>
            <div class="f1-grid">
                ${data.predictions.map((p, i) => `
                    <div class="f1-pos f1-pos-${i + 1}">P${i + 1}</div>
                    <div class="f1-driver f1-pos-${i + 1}">${p.driver}</div>
                    <div class="f1-score f1-pos-${i + 1}">${p.predicted_pos ? p.predicted_pos.toFixed(1) : ''}</div>
                `).join('')}
            </div>
        `;

    } catch (e) {
        container.innerHTML = '<p class="prediction-none">No predictions available yet. Check back before the next race weekend.</p>';
        dateEl.textContent = '';
    }
}

// Load on page ready
loadNBAPicks();
loadF1Predictions();
