const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
const EMAIL_FROM = process.env.EMAIL_FROM || "CRO Labs <onboarding@resend.dev>";
const indexPath = path.join(__dirname, "index.html");
const attempts = new Map();

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 5) return true;
  recent.push(now);
  attempts.set(ip, recent);
  return false;
}

async function readJsonBody(request, response) {
  let rawBody = "";
  for await (const chunk of request) {
    rawBody += chunk;
    if (rawBody.length > 12_000) {
      sendJson(response, 413, { error: "Messaggio troppo lungo." });
      return null;
    }
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    sendJson(response, 400, { error: "Richiesta non valida." });
    return null;
  }
}

async function handleChat(request, response) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID non configurati");
    return sendJson(response, 503, { error: "Chat momentaneamente non disponibile." });
  }

  const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    return sendJson(response, 429, { error: "Troppi messaggi. Riprova tra qualche minuto." });
  }

  const body = await readJsonBody(request, response);
  if (!body) return;

  if (body.website) return sendJson(response, 200, { ok: true });

  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 120);
  const message = String(body.message || "").trim().slice(0, 2000);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || !validEmail || !message) {
    return sendJson(response, 400, { error: "Compila correttamente tutti i campi." });
  }

  const telegramText = [
    "<b>Nuovo messaggio dal sito CRO Labs</b>",
    "",
    `<b>Nome:</b> ${escapeHtml(name)}`,
    `<b>Email:</b> ${escapeHtml(email)}`,
    "",
    `<b>Messaggio:</b>\n${escapeHtml(message)}`
  ].join("\n");

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: telegramText, parse_mode: "HTML" })
    });
    if (!telegramResponse.ok) throw new Error(`Telegram ha risposto ${telegramResponse.status}`);
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Errore invio Telegram:", error.message);
    return sendJson(response, 502, { error: "Invio non riuscito. Riprova tra poco." });
  }
}

async function handleContact(request, response) {
  if (!RESEND_API_KEY || !CONTACT_TO_EMAIL) {
    console.error("RESEND_API_KEY o CONTACT_TO_EMAIL non configurati");
    return sendJson(response, 503, { error: "Servizio email momentaneamente non disponibile." });
  }

  const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(`email:${ip}`)) {
    return sendJson(response, 429, { error: "Troppi messaggi. Riprova tra qualche minuto." });
  }

  const body = await readJsonBody(request, response);
  if (!body) return;
  if (body.website) return sendJson(response, 200, { ok: true });

  const name = String(body.nome || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 120);
  const message = String(body.message || "").trim().slice(0, 4000);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || !validEmail || !message) {
    return sendJson(response, 400, { error: "Compila correttamente tutti i campi." });
  }

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [CONTACT_TO_EMAIL],
        reply_to: email,
        subject: `Nuovo contatto dal sito CRO Labs - ${name}`,
        html: [
          "<h2>Nuovo messaggio dal sito CRO Labs</h2>",
          `<p><strong>Nome:</strong> ${escapeHtml(name)}</p>`,
          `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
          `<p><strong>Messaggio:</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`
        ].join("")
      })
    });

    if (!resendResponse.ok) {
      const details = await resendResponse.text();
      throw new Error(`Resend ha risposto ${resendResponse.status}: ${details}`);
    }

    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Errore invio email:", error.message);
    return sendJson(response, 502, { error: "Invio non riuscito. Riprova tra poco." });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && url.pathname === "/api/chat") {
    return handleChat(request, response);
  }

  if (request.method === "POST" && url.pathname === "/api/contact") {
    return handleContact(request, response);
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(indexPath).pipe(response);
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ok" });
  }

  sendJson(response, 404, { error: "Pagina non trovata." });
});

server.listen(PORT, () => console.log(`CRO Labs online sulla porta ${PORT}`));
