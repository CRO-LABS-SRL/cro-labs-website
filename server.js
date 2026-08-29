const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const MYSQL_HOST = process.env.MYSQL_HOST || "localhost";
const MYSQL_PORT = Number(process.env.MYSQL_PORT) || 3306;
const MYSQL_USER = process.env.MYSQL_USER;
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD;
const MYSQL_DATABASE = process.env.MYSQL_DATABASE;
const databaseConfigured = Boolean(MYSQL_USER && MYSQL_PASSWORD && MYSQL_DATABASE);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
const EMAIL_FROM = process.env.EMAIL_FROM || "CRO Labs <onboarding@resend.dev>";
const indexPath = path.join(__dirname, "index.html");
const serviziDir = path.join(__dirname, "servizi");
const attempts = new Map();

function serveHtmlFile(response, filePath) {
  const stream = fs.createReadStream(filePath);
  stream.once("error", () => sendJson(response, 404, { error: "Pagina non trovata." }));
  stream.once("open", () => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    stream.pipe(response);
  });
}

function serveServiziPage(response, pathname) {
  const relative = pathname === "/servizi" || pathname === "/servizi/"
    ? "index.html"
    : pathname.slice("/servizi/".length);
  const filePath = path.normalize(path.join(serviziDir, relative));
  if (!filePath.startsWith(serviziDir + path.sep) || !filePath.endsWith(".html")) {
    return sendJson(response, 404, { error: "Pagina non trovata." });
  }
  return serveHtmlFile(response, filePath);
}

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

let pool = null;
function getPool() {
  if (!databaseConfigured) throw new Error("Database non configurato");
  if (!pool) {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      charset: "utf8mb4",
      timezone: "Z",
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true
    });
  }
  return pool;
}

async function dbQuery(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function findConversation(publicId, accessToken) {
  if (!publicId || !accessToken) return null;
  const rows = await dbQuery(
    "SELECT id, public_id, name, email, status FROM chat_conversations WHERE public_id = ? AND access_token_hash = ? LIMIT 1",
    [publicId, hashToken(accessToken)]
  );
  return rows[0] || null;
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
  await dbQuery(
    "UPDATE chat_messages SET telegram_message_id = ? WHERE id = ?",
    [telegramResult.result.message_id, databaseMessageId]
  );
}

async function handleStartChat(request, response) {
  if (!databaseConfigured || !BOT_TOKEN || !CHAT_ID) {
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
  const conversationId = crypto.randomUUID();
  const accessToken = crypto.randomBytes(32).toString("hex");
  try {
    await dbQuery(
      "INSERT INTO chat_conversations (id, public_id, access_token_hash, name, email) VALUES (?, ?, ?, ?, ?)",
      [conversationId, publicId, hashToken(accessToken), name, email]
    );
    const saved = await dbQuery(
      "INSERT INTO chat_messages (conversation_id, sender, body) VALUES (?, 'visitor', ?)",
      [conversationId, message]
    );
    const conversation = { id: conversationId, public_id: publicId, name, email };
    await sendTelegramMessage(conversation, message, saved.insertId);
    return sendJson(response, 201, { ok: true, sessionId: publicId, accessToken });
  } catch (error) {
    console.error("Errore apertura chat:", error.message, error.cause || "");
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
    const saved = await dbQuery(
      "INSERT INTO chat_messages (conversation_id, sender, body) VALUES (?, 'visitor', ?)",
      [conversation.id, message]
    );
    await sendTelegramMessage(conversation, message, saved.insertId);
    return sendJson(response, 201, { ok: true });
  } catch (error) {
    console.error("Errore messaggio chat:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Invio non riuscito. Riprova." });
  }
}

async function handleChatMessages(request, response, url) {
  try {
    const conversation = await findConversation(url.searchParams.get("session"), request.headers["x-chat-token"]);
    if (!conversation) return sendJson(response, 401, { error: "Conversazione non valida." });
    const messages = await dbQuery(
      "SELECT id, sender, body, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT 100",
      [conversation.id]
    );
    return sendJson(response, 200, { messages });
  } catch (error) {
    console.error("Errore lettura chat:", error.message, error.cause || "");
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
    const rows = await dbQuery(
      "SELECT conversation_id FROM chat_messages WHERE telegram_message_id = ? LIMIT 1",
      [replyToId]
    );
    const sourceMessage = rows[0];
    if (!sourceMessage) return sendJson(response, 200, { ok: true });
    await dbQuery(
      "INSERT INTO chat_messages (conversation_id, sender, body) VALUES (?, 'operator', ?)",
      [sourceMessage.conversation_id, replyText]
    );
    return sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Errore webhook Telegram:", error.message, error.cause || "");
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
  if (request.method === "GET" && (url.pathname === "/servizi" || url.pathname.startsWith("/servizi/"))) {
    return serveServiziPage(response, url.pathname);
  }
  if (request.method === "GET" && url.pathname === "/health") {
    let database = false;
    if (databaseConfigured) {
      try {
        await dbQuery("SELECT 1");
        database = true;
      } catch (error) {
        console.error("Health check database:", error.message, error.cause || "");
      }
    }
    return sendJson(response, 200, { status: "ok", database });
  }
  return sendJson(response, 404, { error: "Pagina non trovata." });
});

server.listen(PORT, () => console.log(`CRO Labs online sulla porta ${PORT}`));
