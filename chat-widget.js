(function () {
  "use strict";

  if (document.getElementById("chat-panel")) return;

  document.body.insertAdjacentHTML("beforeend", `
    <button class="chat-launcher" id="chat-launcher" type="button" aria-label="Apri la chat" aria-controls="chat-panel" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
    </button>
    <aside class="chat-panel" id="chat-panel" aria-label="Contatta CRO Labs tramite Telegram" aria-hidden="true">
      <div class="chat-header">
        <div>
          <strong>Scrivi a CRO Labs</strong>
          <span class="chat-channel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.9 2.6 18.6 21c-.2 1.3-1 1.6-2 1l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.8 14.6l-5-1.6c-1.1-.3-1.1-1.1.2-1.6L20.5 2c.9-.3 1.7.2 1.4.6z"/></svg>
            Messaggi ricevuti su Telegram
          </span>
        </div>
        <button class="chat-close" id="chat-close" type="button" aria-label="Chiudi la chat">&times;</button>
      </div>
      <div class="chat-body" id="chat-body">
        <p class="chat-welcome">Ciao! Il tuo messaggio arriva subito al nostro team su Telegram. Puoi leggere la risposta direttamente qui.</p>
        <form class="chat-form" id="chat-form">
          <input type="text" name="name" placeholder="Il tuo nome" maxlength="80" autocomplete="name" required>
          <input type="email" name="email" placeholder="La tua email" maxlength="120" autocomplete="email" required>
          <textarea name="message" placeholder="Scrivi il tuo messaggio..." maxlength="2000" required></textarea>
          <input class="chat-honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <p class="chat-privacy">I dati sono usati per rispondere alla richiesta. <a href="/privacy-cookie.html">Privacy e Cookie</a></p>
          <button class="chat-submit" type="submit">Invia messaggio</button>
          <p class="chat-status" id="chat-status" role="status" aria-live="polite"></p>
        </form>
        <div class="chat-conversation" id="chat-conversation" hidden>
          <div class="chat-thread" id="chat-thread" aria-live="polite" aria-label="Messaggi della conversazione"></div>
          <form class="chat-message-form" id="chat-message-form">
            <textarea name="message" maxlength="2000" rows="1" aria-label="Nuovo messaggio" placeholder="Scrivi un altro messaggio..." required></textarea>
            <button class="chat-send-button" type="submit" aria-label="Invia messaggio">Invia</button>
          </form>
          <p class="chat-status" id="chat-conversation-status" role="status" aria-live="polite"></p>
        </div>
      </div>
    </aside>
  `);

  const launcher = document.getElementById("chat-launcher");
  const panel = document.getElementById("chat-panel");
  const closeButton = document.getElementById("chat-close");
  const form = document.getElementById("chat-form");
  const status = document.getElementById("chat-status");
  const body = document.getElementById("chat-body");
  const conversation = document.getElementById("chat-conversation");
  const thread = document.getElementById("chat-thread");
  const messageForm = document.getElementById("chat-message-form");
  const conversationStatus = document.getElementById("chat-conversation-status");
  const storageKey = "croLabsChatSession";
  const openStorageKey = "croLabsChatOpen";
  let session = null;
  let renderedMessageIds = "";

  try {
    session = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    localStorage.removeItem(storageKey);
  }

  async function readApiJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("Servizio momentaneamente non disponibile.");
    return response.json();
  }

  function showConversation() {
    body.classList.add("is-conversation");
    conversation.hidden = false;
  }

  function renderMessages(messages) {
    const signature = messages.map((message) => message.id).join(",");
    if (signature === renderedMessageIds) return;
    renderedMessageIds = signature;
    thread.replaceChildren();
    messages.forEach((message) => {
      const bubble = document.createElement("div");
      bubble.className = `chat-message is-${message.sender}`;
      bubble.textContent = message.body;
      thread.appendChild(bubble);
    });
    thread.scrollTop = thread.scrollHeight;
  }

  async function refreshChat() {
    if (!session) return;
    try {
      const response = await fetch(`/api/chat/messages?session=${encodeURIComponent(session.sessionId)}`, {
        headers: { "X-Chat-Token": session.accessToken }
      });
      const result = await readApiJson(response);
      if (response.status === 401) {
        localStorage.removeItem(storageKey);
        session = null;
        return;
      }
      if (!response.ok) throw new Error(result.error || "Chat non disponibile.");
      showConversation();
      renderMessages(result.messages);
      conversationStatus.textContent = "Connesso · le risposte arrivano qui automaticamente";
      conversationStatus.className = "chat-status is-success";
    } catch {
      conversationStatus.textContent = "Riconnessione in corso...";
      conversationStatus.className = "chat-status";
    }
  }

  function setOpen(open, focus = true) {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    launcher.setAttribute("aria-expanded", String(open));
    sessionStorage.setItem(openStorageKey, String(open));
    if (!open) return;
    if (session) {
      showConversation();
      refreshChat();
      if (focus) messageForm.elements.message.focus();
    } else if (focus) {
      form.elements.name.focus();
    }
  }

  launcher.addEventListener("click", () => setOpen(!panel.classList.contains("is-open")));
  closeButton.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;
    status.className = "chat-status";
    status.textContent = "Invio in corso...";
    try {
      const response = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const result = await readApiJson(response);
      if (!response.ok) throw new Error(result.error || "Invio non riuscito");
      session = { sessionId: result.sessionId, accessToken: result.accessToken };
      localStorage.setItem(storageKey, JSON.stringify(session));
      form.reset();
      showConversation();
      await refreshChat();
    } catch (error) {
      status.className = "chat-status is-error";
      status.textContent = error.message || "Qualcosa non ha funzionato. Riprova.";
    } finally {
      submitButton.disabled = false;
    }
  });

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!session) return;
    const submitButton = messageForm.querySelector("button[type='submit']");
    const messageInput = messageForm.elements.message;
    const message = messageInput.value.trim();
    if (!message) return;
    messageInput.value = "";
    submitButton.disabled = true;
    conversationStatus.textContent = "Invio in corso...";
    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...session, message })
      });
      const result = await readApiJson(response);
      if (!response.ok) throw new Error(result.error || "Invio non riuscito");
      await refreshChat();
    } catch (error) {
      if (!messageInput.value) messageInput.value = message;
      conversationStatus.className = "chat-status is-error";
      conversationStatus.textContent = error.message || "Invio non riuscito. Riprova.";
    } finally {
      submitButton.disabled = false;
      messageInput.focus();
    }
  });

  if (session) refreshChat();
  setOpen(sessionStorage.getItem(openStorageKey) === "true", false);
  window.setInterval(() => {
    if (session && !document.hidden) refreshChat();
  }, 3000);
})();
