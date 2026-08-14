const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
const EMAIL_FROM = process.env.EMAIL_FROM || "CRO Labs <onboarding@resend.dev>";
const indexPath = path.join(__dirname, "index.html");
const attempts = new Map();

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first || ""));
  const b = Buffer.from(String(second || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isRateLimited(key, limit = 10) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= limit) return true;
  recent.push(now);
  attempts.set(key, recent);
  return false;
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

async function readJsonBody(request, response) {
  let rawBody = "";
  for await (const chunk of request) {
    rawBody += chunk;
    if (rawBody.length > 16_000) {
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

async function supabaseRequest(table, { method = "GET", query = "", body, prefer } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase non configurato");
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { "Prefer": prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!result.ok) throw new Error(`Supabase ${result.status}: ${await result.text()}`);
  const text = await result.text();
  return text ? JSON.parse(text) : null;
}

async function findConversation(publicId, accessToken) {
  if (!publicId || !accessToken) return null;
  const query = new URLSearchParams({
    select: "id,public_id,name,email,status",
    public_id: `eq.${publicId}`,
    access_token_hash: `eq.${hashToken(accessToken)}`,
    limit: "1"
  });
  const conversations = await supabaseRequest("chat_conversations", { query: query.toString() });
  return conversations[0] || null;
}

async function sendTelegramMessage(conversation, message, databaseMessageId) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const telegramText = [
    "<b>Nuovo messaggio dalla chat CRO Labs</b>",
    `<b>Cliente:</b> ${escapeHtml(conversation.name)}`,
    `<b>Email:</b> ${escapeHtml(conversation.email)}`,
    `<b>Conversazione:</b> <code>${conversation.public_id.slice(0, 8)}</code>`,
    "", escapeHtml(message), "",
    "<i>Usa Rispondi su questo messaggio per rispondere al cliente sul sito.</i>"
  ].join("\n");
  const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: telegramText, parse_mode: "HTML" })
  });
  const telegramResult = await telegramResponse.json();
  if (!telegramResponse.ok || !telegramResult.ok) throw new Error(`Telegram: ${JSON.stringify(telegramResult)}`);
  const query = new URLSearchParams({ id: `eq.${databaseMessageId}` });
  await supabaseRequest("chat_messages", {
    method: "PATCH", query: query.toString(), body: { telegram_message_id: telegramResult.result.message_id }
  });
}

async function handleStartChat(request, response) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOT_TOKEN || !CHAT_ID) {
    return sendJson(response, 503, { error: "Chat momentaneamente non disponibile." });
  }
  if (isRateLimited(`chat-start:${requestIp(request)}`, 5)) {
    return sendJson(response, 429, { error: "Troppi tentativi. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  if (body.website) return sendJson(response, 200, { ok: true });
  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 120);
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return sendJson(response, 400, { error: "Compila correttamente tutti i campi." });
  }
  const publicId = crypto.randomUUID();
  const accessToken = crypto.randomBytes(32).toString("hex");
  try {
    const [conversation] = await supabaseRequest("chat_conversations", {
      method: "POST", prefer: "return=representation",
      body: { public_id: publicId, access_token_hash: hashToken(accessToken), name, email }
    });
    const [savedMessage] = await supabaseRequest("chat_messages", {
      method: "POST", prefer: "return=representation",
      body: { conversation_id: conversation.id, sender: "visitor", body: message }
    });
    await sendTelegramMessage(conversation, message, savedMessage.id);
    return sendJson(response, 201, { ok: true, sessionId: publicId, accessToken });
  } catch (error) {
    console.error("Errore apertura chat:", error.message);
    return sendJson(response, 502, { error: "Non siamo riusciti ad aprire la chat. Riprova." });
  }
}

async function handleChatMessage(request, response) {
  if (isRateLimited(`chat-message:${requestIp(request)}`, 20)) {
    return sendJson(response, 429, { error: "Troppi messaggi. Attendi qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  try {
    const message = String(body.message || "").trim().slice(0, 2000);
    const conversation = await findConversation(body.sessionId, body.accessToken);
    if (!conversation || conversation.status !== "open") {
      return sendJson(response, 401, { error: "Conversazione non valida o terminata." });
    }
    if (!message) return sendJson(response, 400, { error: "Scrivi un messaggio." });
    const [savedMessage] = await supabaseRequest("chat_messages", {
      method: "POST", prefer: "return=representation",
      body: { conversation_id: conversation.id, sender: "visitor", body: message }
    });
    await sendTelegramMessage(conversation, message, savedMessage.id);
    return sendJson(response, 201, { ok: true });
  } catch (error) {
    console.error("Errore messaggio chat:", error.message);
    return sendJson(response, 502, { error: "Invio non riuscito. Riprova." });
  }
}

async function handleChatMessages(request, response, url) {
  try {
    const conversation = await findConversation(url.searchParams.get("session"), request.headers["x-chat-token"]);
    if (!conversation) return sendJson(response, 401, { error: "Conversazione non valida." });
    const query = new URLSearchParams({
      select: "id,sender,body,created_at",
      conversation_id: `eq.${conversation.id}`,
      order: "created_at.asc", limit: "100"
    });
    const messages = await supabaseRequest("chat_messages", { query: query.toString() });
    return sendJson(response, 200, { messages });
  } catch (error) {
    console.error("Errore lettura chat:", error.message);
    return sendJson(response, 502, { error: "Impossibile aggiornare la conversazione." });
  }
}

async function handleTelegramWebhook(request, response) {
  if (!TELEGRAM_WEBHOOK_SECRET || !safeEqual(request.headers["x-telegram-bot-api-secret-token"], TELEGRAM_WEBHOOK_SECRET)) {
    return sendJson(response, 401, { error: "Non autorizzato." });
  }
  const update = await readJsonBody(request, response);
  if (!update) return;
  const telegramMessage = update.message;
  const replyToId = telegramMessage?.reply_to_message?.message_id;
  const replyText = String(telegramMessage?.text || "").trim().slice(0, 2000);
  if (!replyToId || !replyText || String(telegramMessage.chat.id) !== String(CHAT_ID)) {
    return sendJson(response, 200, { ok: true });
  }
  try {
    const lookup = new URLSearchParams({
      select: "conversation_id", telegram_message_id: `eq.${replyToId}`, limit: "1"
    });
    const [sourceMessage] = await supabaseRequest("chat_messages", { query: lookup.toString() });
    if (!sourceMessage) return sendJson(response, 200, { ok: true });
    await supabaseRequest("chat_messages", {
      method: "POST", body: { conversation_id: sourceMessage.conversation_id, sender: "operator", body: replyText }
    });
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Errore webhook Telegram:", error.message);
    return sendJson(response, 500, { error: "Errore interno." });
  }
}

async function handleContact(request, response) {
  if (!RESEND_API_KEY || !CONTACT_TO_EMAIL) {
    return sendJson(response, 503, { error: "Servizio email momentaneamente non disponibile." });
  }
  if (isRateLimited(`email:${requestIp(request)}`, 5)) {
    return sendJson(response, 429, { error: "Troppi messaggi. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  if (body.website) return sendJson(response, 200, { ok: true });
  const name = String(body.nome || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 120);
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return sendJson(response, 400, { error: "Compila correttamente tutti i campi." });
  }
  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM, to: [CONTACT_TO_EMAIL], reply_to: email,
        subject: `Nuovo contatto dal sito CRO Labs - ${name}`,
        html: `<h2>Nuovo messaggio dal sito CRO Labs</h2><p><strong>Nome:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Messaggio:</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`
      })
    });
    if (!resendResponse.ok) throw new Error(`Resend ${resendResponse.status}: ${await resendResponse.text()}`);
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Errore invio email:", error.message);
    return sendJson(response, 502, { error: "Invio non riuscito. Riprova tra poco." });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "POST" && url.pathname === "/api/chat/session") return handleStartChat(request, response);
  if (request.method === "POST" && url.pathname === "/api/chat/message") return handleChatMessage(request, response);
  if (request.method === "GET" && url.pathname === "/api/chat/messages") return handleChatMessages(request, response, url);
  if (request.method === "POST" && url.pathname === "/api/telegram/webhook") return handleTelegramWebhook(request, response);
  if (request.method === "POST" && url.pathname === "/api/contact") return handleContact(request, response);
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(indexPath).pipe(response);
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ok", database: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) });
  }
  return sendJson(response, 404, { error: "Pagina non trovata." });
});

server.listen(PORT, () => console.log(`CRO Labs online sulla porta ${PORT}`));
