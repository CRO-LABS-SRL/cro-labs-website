(() => {
  'use strict';
  document.querySelector('.chat-trigger').addEventListener('click', () => {
    const launcher = document.getElementById('chat-launcher');
    if (launcher && launcher.getAttribute('aria-expanded') !== 'true') launcher.click();
  });
  const form = document.getElementById('landing-contact-form');
  const status = document.getElementById('form-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Invio in corso…';
    const payload = Object.fromEntries(new FormData(form));
    const source = form.dataset.campaign || 'siti web Capri e Anacapri';
    payload.message = '[Landing: ' + source + ']\n\n' + payload.message;
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('Servizio momentaneamente non disponibile. Riprova o contattaci in chat.');
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Invio non riuscito. Riprova.');
      form.reset();
      status.textContent = 'Grazie! Abbiamo ricevuto la tua richiesta. Ti risponderemo via email.';
    } catch (error) {
      status.textContent = error.message || 'Invio non riuscito. Riprova o contattaci in chat.';
    } finally {
      button.disabled = false;
    }
  });
})();
