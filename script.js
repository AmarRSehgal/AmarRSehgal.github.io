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

// The feed registry and every renderer live in predictions.js, shared with feed.html.
// This page renders each feed compactly; feed.html renders one in full.
Object.keys(Predictions.FEEDS).forEach(key => Predictions.load(key));
