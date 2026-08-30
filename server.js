const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

// Carica un eventuale file .env accanto a server.js (senza sovrascrivere variabili gia impostate).
try {
  const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // Nessun file .env: si usano solo le variabili d'ambiente del sistema.
}

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
const HOSTINGER_API = process.env.HOSTINGER_API || process.env.HOSTINGER_API_TOKEN;
const configuredDomainCurrency = String(process.env.DOMAIN_PRICE_CURRENCY || "EUR").toUpperCase();
const DOMAIN_PRICE_CURRENCY = /^[A-Z]{3}$/.test(configuredDomainCurrency) ? configuredDomainCurrency : "EUR";
const configuredDomainPriceLimit = Number(process.env.DOMAIN_MAX_ANNUAL_PRICE_CENTS);
const DOMAIN_MAX_ANNUAL_PRICE_CENTS = Number.isSafeInteger(configuredDomainPriceLimit) && configuredDomainPriceLimit > 0
  ? configuredDomainPriceLimit
  : 3000;
const configuredDomainExtraLimit = Number(process.env.DOMAIN_AUTO_EXTRA_MAX_ANNUAL_PRICE_CENTS);
const DOMAIN_AUTO_EXTRA_MAX_ANNUAL_PRICE_CENTS = Number.isSafeInteger(configuredDomainExtraLimit) &&
  configuredDomainExtraLimit >= DOMAIN_MAX_ANNUAL_PRICE_CENTS
  ? configuredDomainExtraLimit
  : 6000;
const configuredDomainExtraMargin = Number(process.env.DOMAIN_EXTRA_MARGIN_PERCENT);
const DOMAIN_EXTRA_MARGIN_PERCENT = Number.isFinite(configuredDomainExtraMargin) &&
  configuredDomainExtraMargin >= 0 && configuredDomainExtraMargin <= 100
  ? configuredDomainExtraMargin
  : 30;
const configuredDomainToEurRate = Number(process.env.DOMAIN_PRICE_TO_EUR_RATE);
const DOMAIN_PRICE_TO_EUR_RATE = DOMAIN_PRICE_CURRENCY === "EUR"
  ? 1
  : (Number.isFinite(configuredDomainToEurRate) && configuredDomainToEurRate > 0 ? configuredDomainToEurRate : null);
const REVOLUT_SECRET_KEY = process.env.REVOLUT_SECRET_KEY;
const REVOLUT_WEBHOOK_SECRET = process.env.REVOLUT_WEBHOOK_SECRET;
const REVOLUT_ENV = String(process.env.REVOLUT_ENV || "sandbox").toLowerCase();
const REVOLUT_API_BASE = REVOLUT_ENV === "production"
  ? "https://merchant.revolut.com"
  : "https://sandbox-merchant.revolut.com";
const REVOLUT_API_VERSION = process.env.REVOLUT_API_VERSION || "2026-04-20";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const DOMAIN_DEFAULT_TLDS = ["it", "com", "net", "eu"];
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

function sendEmpty(response, status = 204) {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
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

async function sendTelegramMessage(conversation, message, databaseMessageId, options = {}) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const telegramText = [
    "<b>Nuovo messaggio dalla chat CRO Labs</b>",
    `<b>Cliente:</b> ${escapeHtml(conversation.name)}`,
    `<b>Email:</b> ${escapeHtml(conversation.email)}`,
    `<b>Conversazione:</b> <code>${conversation.public_id.slice(0, 8)}</code>`,
    "", escapeHtml(message), "",
    "<i>Usa Rispondi su questo messaggio per rispondere al cliente sul sito.</i>"
  ].join("\n");
  const telegramPayload = { chat_id: CHAT_ID, text: telegramText, parse_mode: "HTML" };
  if (options.actionUrl && options.actionLabel) {
    telegramPayload.reply_markup = {
      inline_keyboard: [[{
        text: String(options.actionLabel).slice(0, 64),
        url: String(options.actionUrl)
      }]]
    };
  }
  const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(telegramPayload)
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

function normalizeDomainLabel(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
}

function isValidFullDomain(domain) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,63})+$/.test(domain);
}

const hostingerCatalogCache = { at: 0, items: null };
const HOSTINGER_CATALOG_TTL_MS = 60 * 60 * 1000;

async function fetchHostingerDomainCatalog() {
  if (hostingerCatalogCache.items && Date.now() - hostingerCatalogCache.at < HOSTINGER_CATALOG_TTL_MS) {
    return hostingerCatalogCache.items;
  }
  const catalogResponse = await fetch("https://developers.hostinger.com/api/billing/v1/catalog?category=DOMAIN", {
    headers: {
      "Authorization": `Bearer ${HOSTINGER_API}`,
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!catalogResponse.ok) {
    throw new Error(`Hostinger catalog ${catalogResponse.status}: ${await catalogResponse.text()}`);
  }
  const payload = await catalogResponse.json();
  const items = Array.isArray(payload) ? payload : (payload.data || []);
  hostingerCatalogCache.at = Date.now();
  hostingerCatalogCache.items = items;
  return items;
}

function annualDomainPriceForTld(items, tld) {
  const normalizedTld = String(tld || "").toLowerCase();
  const matchingItems = items.filter((item) => {
    const id = String(item.id || "").toLowerCase();
    const name = String(item.name || "").toLowerCase();
    return String(item.category || "").toUpperCase() === "DOMAIN" &&
      (id.includes(`-domain-${normalizedTld}-`) || name === `.${normalizedTld}` || name.startsWith(`.${normalizedTld} `));
  });
  const prices = matchingItems.flatMap((item) => (Array.isArray(item.prices) ? item.prices : []).map((price) => ({
    ...price,
    catalogItemId: item.id
  })));
  const annualPrices = prices.filter((price) => {
    const id = String(price.id || "").toLowerCase();
    const unit = String(price.period_unit || "").toLowerCase();
    return String(price.currency || "").toUpperCase() === DOMAIN_PRICE_CURRENCY &&
      Number(price.period) === 1 && (unit.startsWith("year") || id.endsWith("-1y"));
  });
  if (!annualPrices.length) return null;
  annualPrices.sort((a, b) => Number(a.price) - Number(b.price));
  const selected = annualPrices[0];
  return {
    itemId: selected.id,
    catalogItemId: selected.catalogItemId,
    currency: DOMAIN_PRICE_CURRENCY,
    firstYearPriceCents: Number(selected.first_period_price ?? selected.price),
    renewalPriceCents: Number(selected.price),
    maxAnnualPriceCents: DOMAIN_MAX_ANNUAL_PRICE_CENTS
  };
}

function domainExtraCatalogCents(quote, planYears) {
  if (!quote || ![5, 10].includes(Number(planYears))) return null;
  const years = Number(planYears);
  const estimatedCatalogCost = quote.firstYearPriceCents + quote.renewalPriceCents * (years - 1);
  const includedCatalogCost = DOMAIN_MAX_ANNUAL_PRICE_CENTS * years;
  return Math.max(0, estimatedCatalogCost - includedCatalogCost);
}

function domainSupplementForPlan(quote, planYears) {
  const differenceCatalogCents = domainExtraCatalogCents(quote, planYears);
  if (differenceCatalogCents === null || (differenceCatalogCents > 0 && !DOMAIN_PRICE_TO_EUR_RATE)) return null;
  if (differenceCatalogCents === 0) return 0;
  const differenceEurCents = differenceCatalogCents * DOMAIN_PRICE_TO_EUR_RATE;
  const withMargin = differenceEurCents * (1 + DOMAIN_EXTRA_MARGIN_PERCENT / 100);
  return Math.ceil(withMargin / 100) * 100;
}

function evaluateDomainEligibility(isAvailable, restriction, quote) {
  let reason = null;
  const extra5CatalogCents = quote ? domainExtraCatalogCents(quote, 5) : null;
  const extra10CatalogCents = quote ? domainExtraCatalogCents(quote, 10) : null;
  const needsCurrencyConversion = extra5CatalogCents > 0 || extra10CatalogCents > 0;
  if (!isAvailable) reason = "Dominio non disponibile.";
  else if (restriction) reason = "Dominio premium o soggetto a restrizioni: richiedi un preventivo personalizzato.";
  else if (!quote) reason = "Questa estensione richiede una verifica manuale e non è acquistabile online.";
  else if (
    quote.firstYearPriceCents > DOMAIN_AUTO_EXTRA_MAX_ANNUAL_PRICE_CENTS ||
    quote.renewalPriceCents > DOMAIN_AUTO_EXTRA_MAX_ANNUAL_PRICE_CENTS
  ) reason = "Dominio ad alto costo: richiedi un preventivo personalizzato.";
  else if (needsCurrencyConversion && !DOMAIN_PRICE_TO_EUR_RATE) {
    reason = `Conversione ${DOMAIN_PRICE_CURRENCY}/EUR non configurata: richiedi un preventivo personalizzato.`;
  }
  const supplements = !reason && quote ? {
    5: domainSupplementForPlan(quote, 5),
    10: domainSupplementForPlan(quote, 10)
  } : null;
  return {
    eligible: !reason,
    reason,
    supplements,
    requiresSupplement: Boolean(supplements && (supplements[5] > 0 || supplements[10] > 0))
  };
}

async function fetchHostingerAvailability(label, tlds) {
  const hostingerResponse = await fetch("https://developers.hostinger.com/api/domains/v1/availability", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HOSTINGER_API}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ domain: label, tlds, with_alternatives: false }),
    signal: AbortSignal.timeout(15000)
  });
  if (!hostingerResponse.ok) {
    throw new Error(`Hostinger ${hostingerResponse.status}: ${await hostingerResponse.text()}`);
  }
  const payload = await hostingerResponse.json();
  return Array.isArray(payload) ? payload : (payload.data || []);
}

async function getDomainEligibility(domain, availabilityItem = null) {
  const parts = domain.split(".");
  const tld = parts.pop();
  const label = parts.join(".");
  let availability = availabilityItem;
  if (!availability) {
    const rows = await fetchHostingerAvailability(label, [tld]);
    availability = rows.find((item) => String(item.domain || "").toLowerCase() === domain) || rows[0];
  }
  const isAvailable = Boolean(availability?.is_available ?? availability?.isAvailable);
  const restriction = availability?.restriction || null;
  const quote = annualDomainPriceForTld(await fetchHostingerDomainCatalog(), tld);
  return {
    ...evaluateDomainEligibility(isAvailable, restriction, quote),
    available: isAvailable,
    restriction,
    quote
  };
}

function activationCodeHash(code, salt) {
  return crypto.scryptSync(String(code), salt, 32).toString("hex");
}

function formatDomainCatalogPrice(cents, currency) {
  if (!Number.isFinite(Number(cents))) return "non disponibile";
  return `${(Number(cents) / 100).toFixed(2)} ${currency}`;
}

function hostingerDomainSearchUrl(domain) {
  const url = new URL("https://www.hostinger.com/domain-name-search");
  url.searchParams.set("domain", domain);
  return url.toString();
}

async function handleDomainQuoteRequest(request, response) {
  if (!databaseConfigured || !BOT_TOKEN || !CHAT_ID || !HOSTINGER_API) {
    return sendJson(response, 503, { error: "Richiesta preventivo momentaneamente non disponibile." });
  }
  if (isRateLimited(`domain-quote:${requestIp(request)}`, 5)) {
    return sendJson(response, 429, { error: "Troppe richieste. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  if (body.website) return sendJson(response, 200, { ok: true });
  const domain = normalizeDomainLabel(body.domain);
  const name = orderText(body.name, 80);
  const email = orderText(body.email, 120).toLowerCase();
  const phone = orderText(body.phone, 40);
  const note = orderText(body.note, 400);
  const consentAccepted = body.contact_consent === true || body.contact_consent === "on";
  if (!isValidFullDomain(domain) || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !consentAccepted) {
    return sendJson(response, 400, { error: "Compila correttamente nome, email e telefono." });
  }
  try {
    const eligibility = await getDomainEligibility(domain);
    if (!eligibility.available) {
      return sendJson(response, 409, { error: "Il dominio non risulta più disponibile." });
    }
    if (eligibility.eligible) {
      return sendJson(response, 409, { error: "Questo dominio può essere attivato direttamente online." });
    }
    const quote = eligibility.quote;
    const fiveYearEstimate = quote
      ? quote.firstYearPriceCents + quote.renewalPriceCents * 4
      : null;
    const tenYearEstimate = quote
      ? quote.firstYearPriceCents + quote.renewalPriceCents * 9
      : null;
    const rawRestrictionDetails = eligibility.restriction
      ? (JSON.stringify(eligibility.restriction) || String(eligibility.restriction))
      : "nessuna informazione aggiuntiva";
    const restrictionDetails = rawRestrictionDetails.slice(0, 250);
    const hostingerSearchUrl = hostingerDomainSearchUrl(domain);
    const telegramMessage = [
      "RICHIESTA PREVENTIVO DOMINIO",
      `Dominio: ${domain}`,
      `Telefono cliente: ${phone}`,
      `Motivo preventivo: ${eligibility.reason || "verifica manuale"}`,
      `Prezzo catalogo primo anno: ${quote ? formatDomainCatalogPrice(quote.firstYearPriceCents, quote.currency) : "non disponibile"}`,
      `Prezzo catalogo rinnovo: ${quote ? formatDomainCatalogPrice(quote.renewalPriceCents, quote.currency) : "non disponibile"}`,
      `Stima catalogo 5 anni: ${quote ? formatDomainCatalogPrice(fiveYearEstimate, quote.currency) : "non disponibile"}`,
      `Stima catalogo 10 anni: ${quote ? formatDomainCatalogPrice(tenYearEstimate, quote.currency) : "non disponibile"}`,
      `Voce catalogo Hostinger: ${quote?.itemId || "non disponibile"}`,
      `Restrizioni API: ${restrictionDetails}`,
      `Controllo diretto Hostinger: ${hostingerSearchUrl}`,
      "Nota: per domini premium il prezzo del catalogo TLD potrebbe non essere il prezzo specifico finale.",
      note ? `Messaggio cliente: ${note}` : "Messaggio cliente: nessuna nota"
    ].join("\n").slice(0, 2000);
    const visitorMessage = [
      `Richiesta preventivo per il dominio ${domain}.`,
      note ? `Messaggio: ${note}` : "Vorrei ricevere informazioni sui costi e sull'attivazione."
    ].join("\n").slice(0, 1200);

    const publicId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const accessToken = crypto.randomBytes(32).toString("hex");
    await dbQuery(
      "INSERT INTO chat_conversations (id, public_id, access_token_hash, name, email) VALUES (?, ?, ?, ?, ?)",
      [conversationId, publicId, hashToken(accessToken), name, email]
    );
    const saved = await dbQuery(
      "INSERT INTO chat_messages (conversation_id, sender, body) VALUES (?, 'visitor', ?)",
      [conversationId, visitorMessage]
    );
    await sendTelegramMessage(
      { id: conversationId, public_id: publicId, name, email },
      telegramMessage,
      saved.insertId,
      {
        actionLabel: `Controlla ${domain} su Hostinger`,
        actionUrl: hostingerSearchUrl
      }
    );
    return sendJson(response, 201, { ok: true, sessionId: publicId, accessToken });
  } catch (error) {
    console.error("Errore richiesta preventivo dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Non siamo riusciti a inviare la richiesta. Riprova." });
  }
}

async function handleDomainActivationRequest(request, response) {
  if (!databaseConfigured || !RESEND_API_KEY) {
    return sendJson(response, 503, { error: "Verifica email momentaneamente non disponibile." });
  }
  if (isRateLimited(`domain-activation-request:${requestIp(request)}`, 5)) {
    return sendJson(response, 429, { error: "Hai richiesto troppi codici. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  const domain = normalizeDomainLabel(body.domain);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
  if (!isValidFullDomain(domain) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(response, 400, { error: "Inserisci un dominio e un indirizzo email validi." });
  }

  try {
    const eligibility = await getDomainEligibility(domain);
    if (!eligibility.eligible) {
      return sendJson(response, 422, { error: eligibility.reason || "Questo dominio non è incluso nel pacchetto." });
    }
  } catch (error) {
    console.error("Errore controllo prezzo prima della verifica email:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Non riusciamo a verificare il prezzo del dominio. Riprova tra poco." });
  }

  const verificationId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = crypto.randomBytes(16).toString("hex");
  const codeHash = activationCodeHash(code, salt);
  try {
    await dbQuery(
      "INSERT INTO domain_activation_verifications (id, domain, email, code_salt, code_hash, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))",
      [verificationId, domain, email, salt, codeHash]
    );
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: `Codice di verifica CRO Labs per ${domain}`,
        text: `Il tuo codice di verifica CRO Labs è ${code}. Scade tra 15 minuti. Usalo per continuare l'attivazione del dominio ${domain}.`,
        html: `<h2>Verifica il tuo indirizzo email</h2><p>Usa questo codice per continuare l'attivazione del dominio <strong>${escapeHtml(domain)}</strong>:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Il codice scade tra 15 minuti. Se non hai richiesto tu l'attivazione, ignora questa email.</p>`
      })
    });
    if (!resendResponse.ok) throw new Error(`Resend ${resendResponse.status}: ${await resendResponse.text()}`);
    return sendJson(response, 201, { ok: true, verificationId, expiresInSeconds: 900 });
  } catch (error) {
    console.error("Errore invio codice attivazione dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Non siamo riusciti a inviare il codice. Riprova." });
  }
}

async function handleDomainActivationVerify(request, response) {
  if (!databaseConfigured) {
    return sendJson(response, 503, { error: "Verifica email momentaneamente non disponibile." });
  }
  if (isRateLimited(`domain-activation-verify:${requestIp(request)}`, 12)) {
    return sendJson(response, 429, { error: "Troppi tentativi. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  const verificationId = String(body.verificationId || "").trim();
  const code = String(body.code || "").trim();
  if (!/^[0-9]{6}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(verificationId)) {
    return sendJson(response, 400, { error: "Inserisci il codice a 6 cifre ricevuto via email." });
  }
  try {
    const rows = await dbQuery(
      "SELECT id, domain, email, code_salt, code_hash, attempts, expires_at, verified_at FROM domain_activation_verifications WHERE id = ? LIMIT 1",
      [verificationId]
    );
    const verification = rows[0];
    if (!verification || verification.verified_at || new Date(verification.expires_at).getTime() <= Date.now()) {
      return sendJson(response, 410, { error: "Codice scaduto. Richiedine uno nuovo." });
    }
    if (Number(verification.attempts) >= 5) {
      return sendJson(response, 429, { error: "Troppi tentativi errati. Richiedi un nuovo codice." });
    }
    const expectedHash = activationCodeHash(code, verification.code_salt);
    if (!safeEqual(expectedHash, verification.code_hash)) {
      await dbQuery("UPDATE domain_activation_verifications SET attempts = attempts + 1 WHERE id = ?", [verificationId]);
      return sendJson(response, 400, { error: "Codice non corretto." });
    }
    const activationToken = crypto.randomBytes(32).toString("hex");
    await dbQuery(
      "UPDATE domain_activation_verifications SET verified_at = UTC_TIMESTAMP(), activation_token_hash = ? WHERE id = ?",
      [hashToken(activationToken), verificationId]
    );
    return sendJson(response, 200, {
      ok: true,
      domain: verification.domain,
      email: verification.email,
      activationToken
    });
  } catch (error) {
    console.error("Errore verifica codice attivazione dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Verifica non riuscita. Riprova." });
  }
}

const DOMAIN_PLAN_PRICES = Object.freeze({ 5: 36000, 10: 69000 });

function orderText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function handleDomainCheckout(request, response) {
  if (!databaseConfigured || !REVOLUT_SECRET_KEY) {
    return sendJson(response, 503, { error: "Pagamento momentaneamente non disponibile." });
  }
  if (isRateLimited(`domain-checkout:${requestIp(request)}`, 6)) {
    return sendJson(response, 429, { error: "Troppi tentativi di pagamento. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;

  const verificationId = orderText(body.verification_id, 36);
  const activationToken = orderText(body.activation_token, 64);
  const domain = normalizeDomainLabel(body.domain);
  const planYears = Number(body.plan);
  const baseAmountCents = DOMAIN_PLAN_PRICES[planYears];
  const order = {
    companyName: orderText(body.company_name, 160),
    vatNumber: orderText(body.vat_number, 32).toUpperCase(),
    fiscalCode: orderText(body.fiscal_code, 32).toUpperCase() || null,
    firstName: orderText(body.contact_first_name, 80),
    lastName: orderText(body.contact_last_name, 80),
    email: orderText(body.email, 120).toLowerCase(),
    phone: orderText(body.phone, 40),
    address: orderText(body.address, 200),
    city: orderText(body.city, 100),
    province: orderText(body.province, 2).toUpperCase(),
    postalCode: orderText(body.postal_code, 16),
    country: orderText(body.country, 2).toUpperCase()
  };
  const required = [
    order.companyName, order.vatNumber, order.firstName, order.lastName, order.email,
    order.phone, order.address, order.city, order.province, order.postalCode, order.country
  ];
  if (
    !/^[0-9a-f-]{36}$/i.test(verificationId) || !/^[0-9a-f]{64}$/i.test(activationToken) ||
    !isValidFullDomain(domain) || !baseAmountCents || required.some((value) => !value) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email) || !/^[A-Z]{2}$/.test(order.province) ||
    order.country !== "IT" || body.registration_consent !== true
  ) {
    return sendJson(response, 400, { error: "Controlla i dati dell'azienda e accetta le condizioni del servizio." });
  }

  try {
    const verificationRows = await dbQuery(
      "SELECT id, domain, email, activation_token_hash, verified_at FROM domain_activation_verifications WHERE id = ? LIMIT 1",
      [verificationId]
    );
    const verification = verificationRows[0];
    const verifiedRecently = verification?.verified_at &&
      Date.now() - new Date(verification.verified_at).getTime() <= 30 * 60 * 1000;
    if (
      !verification || !verifiedRecently || !verification.activation_token_hash ||
      !safeEqual(hashToken(activationToken), verification.activation_token_hash) ||
      verification.domain !== domain || verification.email !== order.email
    ) {
      return sendJson(response, 401, { error: "La verifica email è scaduta. Richiedi un nuovo codice." });
    }

    const domainEligibility = await getDomainEligibility(domain);
    if (!domainEligibility.eligible) {
      return sendJson(response, 422, {
        error: domainEligibility.reason || "Questo dominio non è incluso nel pacchetto."
      });
    }
    const supplementCents = domainEligibility.supplements?.[planYears];
    if (!Number.isSafeInteger(supplementCents) || supplementCents < 0) {
      return sendJson(response, 422, { error: "Supplemento dominio non calcolabile: richiedi un preventivo personalizzato." });
    }
    const amountCents = baseAmountCents + supplementCents;
    if (Number(body.quoted_total_cents) !== amountCents) {
      return sendJson(response, 409, {
        error: "Il prezzo del dominio è stato aggiornato. Ripeti la ricerca per vedere il nuovo totale."
      });
    }

    const existingRows = await dbQuery(
      "SELECT id, status, checkout_url, plan_years, amount_cents FROM domain_service_orders WHERE verification_id = ? LIMIT 1",
      [verificationId]
    );
    const existing = existingRows[0];
    if (
      existing?.status === "pending" && existing.checkout_url &&
      Number(existing.plan_years) === planYears && Number(existing.amount_cents) === amountCents
    ) {
      return sendJson(response, 200, { ok: true, orderId: existing.id, checkoutUrl: existing.checkout_url });
    }
    if (existing?.status === "pending") {
      return sendJson(response, 409, { error: "Esiste già un pagamento aperto per questa richiesta." });
    }
    if (existing?.status === "completed") {
      return sendJson(response, 409, { error: "Questo ordine risulta già pagato." });
    }

    const orderId = existing?.id || crypto.randomUUID();
    const values = [
      domain, planYears, amountCents, order.companyName, order.vatNumber, order.fiscalCode,
      order.firstName, order.lastName, order.email, order.phone, order.address, order.city,
      order.province, order.postalCode, order.country
    ];
    if (existing) {
      await dbQuery(
        "UPDATE domain_service_orders SET status = 'draft', domain = ?, plan_years = ?, amount_cents = ?, company_name = ?, vat_number = ?, fiscal_code = ?, contact_first_name = ?, contact_last_name = ?, email = ?, phone = ?, address = ?, city = ?, province = ?, postal_code = ?, country = ?, checkout_url = NULL, revolut_order_id = NULL WHERE id = ?",
        [...values, orderId]
      );
    } else {
      await dbQuery(
        "INSERT INTO domain_service_orders (id, verification_id, domain, plan_years, amount_cents, company_name, vat_number, fiscal_code, contact_first_name, contact_last_name, email, phone, address, city, province, postal_code, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [orderId, verificationId, ...values]
      );
    }

    const revolutPayload = {
      amount: amountCents,
      currency: "EUR",
      description: `STAI SENZA PENSIER' ${planYears} anni - ${domain}`,
      capture_mode: "automatic",
      metadata: {
        cro_order_id: orderId,
        domain,
        plan_years: String(planYears),
        base_package_price: String(baseAmountCents),
        domain_supplement: String(supplementCents),
        domain_item_id: domainEligibility.quote.itemId,
        domain_first_year_price: String(domainEligibility.quote.firstYearPriceCents),
        domain_renewal_price: String(domainEligibility.quote.renewalPriceCents),
        domain_price_currency: domainEligibility.quote.currency
      }
    };
    if (/^https:\/\//.test(PUBLIC_BASE_URL) || /^http:\/\/localhost(?::\d+)?$/.test(PUBLIC_BASE_URL)) {
      revolutPayload.redirect_url = `${PUBLIC_BASE_URL}/servizi/stai-senza-pensier.html?payment=return&order=${encodeURIComponent(orderId)}`;
    }
    const revolutResponse = await fetch(`${REVOLUT_API_BASE}/api/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REVOLUT_SECRET_KEY}`,
        "Content-Type": "application/json",
        "Revolut-Api-Version": REVOLUT_API_VERSION,
        "Idempotency-Key": orderId
      },
      body: JSON.stringify(revolutPayload),
      signal: AbortSignal.timeout(15000)
    });
    const revolutText = await revolutResponse.text();
    let revolutOrder = {};
    try { revolutOrder = JSON.parse(revolutText); } catch { /* Risposta non JSON. */ }
    if (!revolutResponse.ok || !revolutOrder.id || !revolutOrder.checkout_url) {
      throw new Error(`Revolut ${revolutResponse.status}: ${revolutText.slice(0, 1000)}`);
    }
    await dbQuery(
      "UPDATE domain_service_orders SET status = 'pending', revolut_order_id = ?, checkout_url = ? WHERE id = ?",
      [revolutOrder.id, revolutOrder.checkout_url, orderId]
    );
    return sendJson(response, 201, {
      ok: true,
      orderId,
      checkoutUrl: revolutOrder.checkout_url,
      environment: REVOLUT_ENV
    });
  } catch (error) {
    console.error("Errore creazione checkout dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Non siamo riusciti ad aprire il pagamento. Riprova tra poco." });
  }
}

async function fetchRevolutOrder(revolutOrderId) {
  const revolutResponse = await fetch(`${REVOLUT_API_BASE}/api/orders/${encodeURIComponent(revolutOrderId)}`, {
    headers: {
      "Authorization": `Bearer ${REVOLUT_SECRET_KEY}`,
      "Accept": "application/json",
      "Revolut-Api-Version": REVOLUT_API_VERSION
    },
    signal: AbortSignal.timeout(15000)
  });
  const text = await revolutResponse.text();
  if (!revolutResponse.ok) throw new Error(`Revolut ${revolutResponse.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

function localStatusForRevolutState(state) {
  if (state === "completed") return "completed";
  if (state === "cancelled") return "cancelled";
  if (state === "failed") return "failed";
  return "pending";
}

async function syncRevolutOrder(revolutOrderId) {
  const rows = await dbQuery(
    "SELECT id, amount_cents, currency, status FROM domain_service_orders WHERE revolut_order_id = ? LIMIT 1",
    [revolutOrderId]
  );
  const localOrder = rows[0];
  if (!localOrder) return null;
  const revolutOrder = await fetchRevolutOrder(revolutOrderId);
  const nextStatus = localStatusForRevolutState(String(revolutOrder.state || "").toLowerCase());
  if (
    nextStatus === "completed" &&
    (Number(revolutOrder.amount) !== Number(localOrder.amount_cents) ||
      String(revolutOrder.currency || "").toUpperCase() !== String(localOrder.currency).toUpperCase())
  ) {
    throw new Error(`Importo o valuta Revolut non corrispondenti per ordine ${localOrder.id}`);
  }
  await dbQuery("UPDATE domain_service_orders SET status = ? WHERE id = ?", [nextStatus, localOrder.id]);
  return { id: localOrder.id, status: nextStatus };
}

async function readRevolutWebhookBody(request, response) {
  let rawBody = "";
  for await (const chunk of request) {
    rawBody += chunk;
    if (rawBody.length > 16_000) {
      sendJson(response, 413, { error: "Payload troppo grande." });
      return null;
    }
  }
  return rawBody;
}

function verifyRevolutWebhookSignature(rawBody, timestamp, signatureHeader) {
  if (!REVOLUT_WEBHOOK_SECRET || !/^\d{13}$/.test(timestamp || "")) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const payloadToSign = `v1.${timestamp}.${rawBody}`;
  const expected = `v1=${crypto.createHmac("sha256", REVOLUT_WEBHOOK_SECRET).update(payloadToSign).digest("hex")}`;
  return String(signatureHeader || "")
    .split(",")
    .map((signature) => signature.trim())
    .some((signature) => safeEqual(signature, expected));
}

async function handleRevolutWebhook(request, response) {
  if (!databaseConfigured || !REVOLUT_SECRET_KEY || !REVOLUT_WEBHOOK_SECRET) {
    return sendJson(response, 503, { error: "Webhook non configurato." });
  }
  const rawBody = await readRevolutWebhookBody(request, response);
  if (rawBody === null) return;
  const timestamp = String(request.headers["revolut-request-timestamp"] || "");
  const signature = String(request.headers["revolut-signature"] || "");
  if (!verifyRevolutWebhookSignature(rawBody, timestamp, signature)) {
    return sendJson(response, 401, { error: "Firma webhook non valida." });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return sendJson(response, 400, { error: "Payload webhook non valido." });
  }
  const eventName = String(event.event || "");
  const revolutOrderId = String(event.order_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(revolutOrderId)) {
    return sendJson(response, 400, { error: "Ordine webhook non valido." });
  }
  const relevantEvents = new Set([
    "ORDER_COMPLETED", "ORDER_CANCELLED", "ORDER_FAILED", "ORDER_AUTHORISED"
  ]);
  if (!relevantEvents.has(eventName)) return sendEmpty(response);
  try {
    await syncRevolutOrder(revolutOrderId);
    return sendEmpty(response);
  } catch (error) {
    console.error("Errore webhook Revolut:", error.message, error.cause || "");
    return sendJson(response, 500, { error: "Errore temporaneo." });
  }
}

async function handleDomainOrderStatus(request, response, url) {
  if (!databaseConfigured) return sendJson(response, 503, { error: "Stato ordine non disponibile." });
  const orderId = String(url.searchParams.get("order") || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return sendJson(response, 400, { error: "Ordine non valido." });
  try {
    const rows = await dbQuery(
      "SELECT status FROM domain_service_orders WHERE id = ? LIMIT 1",
      [orderId]
    );
    if (!rows[0]) return sendJson(response, 404, { error: "Ordine non trovato." });
    return sendJson(response, 200, { status: rows[0].status });
  } catch (error) {
    console.error("Errore stato ordine dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Stato ordine non disponibile." });
  }
}

async function handleDomainCheck(request, response) {
  if (!HOSTINGER_API) {
    return sendJson(response, 503, { error: "Verifica dominio momentaneamente non disponibile." });
  }
  if (isRateLimited(`domain-check:${requestIp(request)}`, 15)) {
    return sendJson(response, 429, { error: "Troppe verifiche. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  const input = normalizeDomainLabel(body.domain);
  const [label, typedTld] = input.split(".");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label || "")) {
    return sendJson(response, 400, { error: "Inserisci un nome dominio valido (lettere, numeri e trattini)." });
  }
  const tlds = [];
  for (const tld of [typedTld, ...DOMAIN_DEFAULT_TLDS]) {
    if (tld && /^[a-z]{2,20}$/.test(tld) && !tlds.includes(tld)) tlds.push(tld);
  }
  try {
    const rows = await fetchHostingerAvailability(label, tlds.slice(0, 5));
    const catalog = await fetchHostingerDomainCatalog();
    const results = rows
      .map((item, index) => {
        const domain = String(item.domain || `${label}.${tlds[index] || ""}`).toLowerCase();
        const tld = domain.split(".").pop();
        const available = Boolean(item.is_available ?? item.isAvailable);
        const restriction = item.restriction || null;
        const quote = available ? annualDomainPriceForTld(catalog, tld) : null;
        const eligibility = evaluateDomainEligibility(available, restriction, quote);
        return {
          domain,
          available,
          eligible: eligibility.eligible,
          requiresSupplement: eligibility.requiresSupplement,
          supplements: eligibility.supplements,
          alternative: Boolean(item.is_alternative ?? item.isAlternative),
          restriction,
          eligibilityReason: eligibility.reason
        };
      })
      .filter((item) => item.domain && !item.domain.endsWith("."));
    return sendJson(response, 200, { label, results });
  } catch (error) {
    console.error("Errore verifica dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "Verifica non riuscita. Riprova tra poco." });
  }
}

const whoisCache = new Map();
const WHOIS_TTL_MS = 6 * 60 * 60 * 1000;

function rdapEntityName(entity) {
  const card = entity && Array.isArray(entity.vcardArray) ? entity.vcardArray[1] : null;
  if (Array.isArray(card)) {
    const fn = card.find((field) => Array.isArray(field) && field[0] === "fn");
    if (fn && fn[3]) return String(fn[3]);
  }
  return entity && entity.handle ? String(entity.handle) : null;
}

function parseRdapDomain(json, fallbackDomain) {
  const events = Array.isArray(json.events) ? json.events : [];
  const eventDate = (action) => {
    const hit = events.find((event) => event.eventAction === action);
    return hit ? hit.eventDate : null;
  };
  const entities = Array.isArray(json.entities) ? json.entities : [];
  const registrar = entities
    .filter((entity) => Array.isArray(entity.roles) && entity.roles.includes("registrar"))
    .map(rdapEntityName)
    .find(Boolean) || null;
  return {
    ok: true,
    domain: (json.ldhName ? String(json.ldhName) : fallbackDomain).toLowerCase(),
    registrar,
    created: eventDate("registration"),
    updated: eventDate("last changed"),
    expires: eventDate("expiration"),
    status: Array.isArray(json.status) ? json.status : [],
    nameservers: Array.isArray(json.nameservers)
      ? json.nameservers.map((ns) => String(ns.ldhName || "").toLowerCase()).filter(Boolean)
      : [],
    dnssec: json.secureDNS ? Boolean(json.secureDNS.delegationSigned) : null
  };
}

async function handleDomainWhois(request, response) {
  if (isRateLimited(`domain-whois:${requestIp(request)}`, 20)) {
    return sendJson(response, 429, { error: "Troppe richieste WHOIS. Riprova tra qualche minuto." });
  }
  const body = await readJsonBody(request, response);
  if (!body) return;
  const domain = normalizeDomainLabel(body.domain);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,63})+$/.test(domain)) {
    return sendJson(response, 400, { error: "Dominio non valido." });
  }
  const cached = whoisCache.get(domain);
  if (cached && Date.now() - cached.at < WHOIS_TTL_MS) {
    return sendJson(response, 200, cached.data);
  }
  try {
    const rdapResponse = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { "Accept": "application/rdap+json", "User-Agent": "CRO-Labs-RDAP/1.0" },
      signal: AbortSignal.timeout(10000)
    });
    if (rdapResponse.status === 404) {
      const data = { ok: false, reason: "not_available" };
      whoisCache.set(domain, { at: Date.now(), data });
      return sendJson(response, 200, data);
    }
    if (!rdapResponse.ok) throw new Error(`RDAP ${rdapResponse.status}`);
    const data = parseRdapDomain(await rdapResponse.json(), domain);
    whoisCache.set(domain, { at: Date.now(), data });
    return sendJson(response, 200, data);
  } catch (error) {
    console.error("Errore WHOIS dominio:", error.message, error.cause || "");
    return sendJson(response, 502, { error: "WHOIS non disponibile per questo dominio." });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "POST" && url.pathname === "/api/chat/session") return handleStartChat(request, response);
  if (request.method === "POST" && url.pathname === "/api/chat/message") return handleChatMessage(request, response);
  if (request.method === "GET" && url.pathname === "/api/chat/messages") return handleChatMessages(request, response, url);
  if (request.method === "POST" && url.pathname === "/api/telegram/webhook") return handleTelegramWebhook(request, response);
  if (request.method === "POST" && url.pathname === "/api/contact") return handleContact(request, response);
  if (request.method === "POST" && url.pathname === "/api/domains/check") return handleDomainCheck(request, response);
  if (request.method === "POST" && url.pathname === "/api/domains/whois") return handleDomainWhois(request, response);
  if (request.method === "POST" && url.pathname === "/api/domains/quote-request") return handleDomainQuoteRequest(request, response);
  if (request.method === "POST" && url.pathname === "/api/domains/activation/request-code") return handleDomainActivationRequest(request, response);
  if (request.method === "POST" && url.pathname === "/api/domains/activation/verify-code") return handleDomainActivationVerify(request, response);
  if (request.method === "POST" && url.pathname === "/api/domains/checkout") return handleDomainCheckout(request, response);
  if (request.method === "POST" && url.pathname === "/api/revolut/webhook") return handleRevolutWebhook(request, response);
  if (request.method === "GET" && url.pathname === "/api/domains/order-status") return handleDomainOrderStatus(request, response, url);
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

server.listen(PORT, () => {
  console.log(`CRO Labs online sulla porta ${PORT}`);
  const mancanti = ["MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"].filter((name) => !process.env[name]);
  if (mancanti.length) {
    console.warn(`Chat DISATTIVA: variabili database mancanti -> ${mancanti.join(", ")}`);
  } else {
    console.log(`Chat attiva: DB ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
  }
  console.log(`Verifica dominio Hostinger: ${HOSTINGER_API ? "attiva" : "DISATTIVA (manca HOSTINGER_API)"}`);
  console.log(`Dominio incluso fino a ${(DOMAIN_MAX_ANNUAL_PRICE_CENTS / 100).toFixed(2)} ${DOMAIN_PRICE_CURRENCY}/anno; extra automatico fino a ${(DOMAIN_AUTO_EXTRA_MAX_ANNUAL_PRICE_CENTS / 100).toFixed(2)}`);
  console.log(`Checkout Revolut: ${REVOLUT_SECRET_KEY ? `attivo (${REVOLUT_ENV})` : "DISATTIVO (manca REVOLUT_SECRET_KEY)"}`);
  console.log(`Webhook Revolut: ${REVOLUT_WEBHOOK_SECRET ? "attivo" : "DISATTIVO (manca REVOLUT_WEBHOOK_SECRET)"}`);
});
