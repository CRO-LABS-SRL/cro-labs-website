(() => {
  'use strict';

  const tagId = 'AW-18450825976';
  const storageKey = 'croLabsAdsConsent';
  const maxAge = 180 * 24 * 60 * 60 * 1000;
  let loaded = false;
  let choice = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.accepted === 'boolean' &&
        Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < maxAge) {
      choice = saved.accepted;
    }
  } catch (_) { /* Storage unavailable: ask again without enabling the tag. */ }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  const consent = (accepted) => ({
    ad_storage: accepted ? 'granted' : 'denied',
    ad_user_data: accepted ? 'granted' : 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied'
  });
  window.gtag('consent', 'default', consent(false));

  function loadTag() {
    if (loaded) return;
    loaded = true;
    window.gtag('js', new Date());
    window.gtag('config', tagId, { allow_ad_personalization_signals: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + tagId;
    document.head.appendChild(script);
  }

  if (choice === true) {
    window.gtag('consent', 'update', consent(true));
    loadTag();
  }

  const banner = document.createElement('section');
  banner.id = 'cro-cookie-banner';
  banner.setAttribute('aria-label', 'Preferenze cookie');
  banner.hidden = choice !== null;
  banner.innerHTML = `
    <p><strong>Misurazione delle campagne</strong><br>Con il tuo consenso utilizziamo Google Ads e cookie pubblicitari per misurare i risultati delle campagne. Puoi rifiutare e continuare a navigare. <a href="/privacy-cookie.html">Privacy e Cookie</a></p>
    <div><button type="button" data-choice="reject">Rifiuta</button><button type="button" data-choice="accept">Accetta misurazione</button></div>`;
  document.body.appendChild(banner);

  const preferences = document.createElement('button');
  preferences.type = 'button';
  preferences.className = 'cro-cookie-preferences';
  preferences.textContent = 'Preferenze cookie';
  preferences.setAttribute('aria-controls', banner.id);
  (document.querySelector('footer') || document.body).appendChild(preferences);
  preferences.addEventListener('click', () => {
    banner.hidden = false;
    banner.querySelector('button').focus();
  });

  banner.addEventListener('click', (event) => {
    const button = event.target.closest('[data-choice]');
    if (!button) return;
    choice = button.dataset.choice === 'accept';
    try {
      localStorage.setItem(storageKey, JSON.stringify({ accepted: choice, at: Date.now() }));
    } catch (_) { /* The choice still applies to this page. */ }
    window.gtag('consent', 'update', consent(choice));
    banner.hidden = true;
    preferences.focus({ preventScroll: true });
    if (choice) loadTag();
    else if (loaded) window.location.reload();
  });

  // Apply changes made in another tab before further navigation or measurement.
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) window.location.reload();
  });
})();
