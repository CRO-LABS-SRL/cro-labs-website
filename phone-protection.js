(function () {
  "use strict";

  const buttons = document.querySelectorAll("[data-phone-reveal]");
  if (!buttons.length) return;

  let configPromise;
  let turnstilePromise;

  async function readJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("Servizio momentaneamente non disponibile.");
    return response.json();
  }

  function getConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/phone/config", { headers: { "Accept": "application/json" } })
        .then(async (response) => {
          const result = await readJson(response);
          if (!response.ok || !result.siteKey) throw new Error(result.error || "Numero momentaneamente non disponibile.");
          return result;
        });
    }
    return configPromise;
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstilePromise) {
      turnstilePromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve(window.turnstile);
        script.onerror = () => reject(new Error("Verifica di sicurezza non disponibile."));
        document.head.appendChild(script);
      });
    }
    return turnstilePromise;
  }

  function showError(button, message) {
    button.disabled = false;
    button.textContent = message;
    window.setTimeout(() => {
      if (button.isConnected && !button.disabled) button.textContent = "Mostra numero";
    }, 4000);
  }

  async function revealPhone(button, token) {
    const response = await fetch("/api/phone/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ token })
    });
    const result = await readJson(response);
    if (!response.ok || !result.display || !result.href) {
      throw new Error(result.error || "Numero momentaneamente non disponibile.");
    }
    const link = document.createElement("a");
    link.className = button.className;
    link.href = result.href;
    link.textContent = result.display;
    link.setAttribute("aria-label", `Chiama ${result.display}`);
    button.replaceWith(link);
  }

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "Verifica in corso…";
      let widgetId;
      const container = document.createElement("span");
      container.style.flexBasis = "100%";
      container.style.display = "flex";
      container.style.justifyContent = "center";
      button.parentElement.appendChild(container);
      try {
        const [config, turnstile] = await Promise.all([getConfig(), loadTurnstile()]);
        widgetId = turnstile.render(container, {
          sitekey: config.siteKey,
          action: "phone_reveal",
          execution: "execute",
          appearance: "interaction-only",
          theme: "dark",
          language: "it",
          callback: async (token) => {
            try {
              await revealPhone(button, token);
            } catch (error) {
              showError(button, error.message);
            } finally {
              container.remove();
              if (widgetId !== undefined) turnstile.remove(widgetId);
            }
          },
          "error-callback": () => {
            container.remove();
            showError(button, "Verifica non riuscita. Riprova");
          }
        });
        turnstile.execute(widgetId);
      } catch (error) {
        container.remove();
        showError(button, error.message || "Numero momentaneamente non disponibile.");
      }
    });
  });
})();
