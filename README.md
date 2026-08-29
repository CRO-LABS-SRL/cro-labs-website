# CRO Labs

Sito aziendale con widget chat collegato a Telegram.

## Avvio locale

Richiede Node.js 18 o superiore.

```bash
npm install
MYSQL_USER="utente" MYSQL_PASSWORD="password" MYSQL_DATABASE="nome_db" \
TELEGRAM_BOT_TOKEN="token-del-bot" TELEGRAM_CHAT_ID="id-della-chat" npm start
```

Il sito sara disponibile su `http://localhost:3000`.

## Configurazione su Hostinger

L'app Node e il database MySQL/MariaDB girano sullo stesso host.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health` (restituisce `"database": true` solo se la connessione al DB funziona davvero)

Variabili d'ambiente da impostare:

- `MYSQL_HOST`: di norma `localhost` (valore predefinito)
- `MYSQL_PORT`: di norma `3306` (valore predefinito)
- `MYSQL_USER`: utente del database creato in hPanel
- `MYSQL_PASSWORD`: password di quell'utente
- `MYSQL_DATABASE`: nome del database
- `TELEGRAM_BOT_TOKEN`: token ricevuto da BotFather
- `TELEGRAM_CHAT_ID`: ID della chat Telegram che ricevera i messaggi
- `TELEGRAM_WEBHOOK_SECRET`: stringa casuale lunga usata per verificare le chiamate Telegram
- `RESEND_API_KEY`: chiave API creata su Resend
- `CONTACT_TO_EMAIL`: indirizzo che ricevera i messaggi del modulo contatti
- `EMAIL_FROM`: mittente verificato, ad esempio `CRO Labs <contatti@tuodominio.it>`
- `HOSTINGER_API`: token API Hostinger (Bearer) per la verifica disponibilita dominio nella pagina STAI SENZA PENSIER'

Non inserire mai il token direttamente in `index.html` e non salvarlo nel repository.

Per ricavare il Chat ID, inviare prima un messaggio al bot e aprire nel browser:

```text
https://api.telegram.org/bot<IL_TUO_TOKEN>/getUpdates
```

Nel risultato cercare `message.chat.id`.

## Chat bidirezionale sito e Telegram

1. In hPanel creare un database MySQL/MariaDB e un utente con tutti i privilegi su quel database.
2. Importare il file `schema.sql` (da phpMyAdmin oppure `mysql -u UTENTE -p NOME_DB < schema.sql`).
3. Impostare `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (e se serve `MYSQL_HOST` / `MYSQL_PORT`) tra le variabili dell'app Node.
4. Generare `TELEGRAM_WEBHOOK_SECRET` con una stringa casuale di almeno 32 caratteri.
5. Dopo che il sito Node e online, registrare il webhook Telegram:

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://cro-labs.it/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Il parametro `secret_token` deve essere identico alla variabile configurata su Hostinger.
Quando arriva un messaggio in Telegram, usare la funzione **Rispondi** sul messaggio del bot:
la risposta verra associata alla conversazione corretta e apparira nel widget del cliente.

Le credenziali `MYSQL_*` non devono mai essere aggiunte a `index.html`, inviate al browser o salvate nel repository.

## Verifica disponibilita dominio (Hostinger API)

La pagina `servizi/stai-senza-pensier.html` ha un modulo che interroga
`POST /api/domains/check`; il server inoltra la richiesta all'endpoint Hostinger
`POST https://developers.hostinger.com/api/domains/v1/availability` con
`Authorization: Bearer $HOSTINGER_API`.

- Il token va SOLO tra le variabili d'ambiente del server, mai in `index.html` o nelle pagine.
- Il token si genera da hPanel: *API* &rarr; crea un token con permesso sui domini.
- Limite Hostinger: 90 richieste/minuto. Il server limita anche per IP (15 verifiche ogni 10 minuti).
- Estensioni controllate: quella eventualmente digitata dall'utente + `it`, `com`, `net`, `eu`.
- Senza `HOSTINGER_API` l'endpoint risponde 503 e il modulo mostra "non disponibile".

Accanto a ogni dominio risultato "occupato" c'e un tasto **WHOIS** che chiama
`POST /api/domains/whois`; il server interroga RDAP (`https://rdap.org/domain/<dominio>`,
JSON via HTTPS, nessun token) e restituisce registrar, date di registrazione/scadenza,
stato, nameserver e DNSSEC. I risultati sono in cache per 6 ore; limite per IP 20/10 minuti.
RDAP non copre `.it` (il registro non lo espone): per quei domini il tasto mostra un avviso.

## Email con Resend

Il modulo contatti usa `/api/contact`, quindi non abbandona piu il sito dopo l'invio.
Per usare un indirizzo CRO Labs come mittente, verificare prima il dominio nella dashboard Resend e impostare `EMAIL_FROM` con un indirizzo di quel dominio.

Durante i primi test si puo omettere `EMAIL_FROM`: verra usato `CRO Labs <onboarding@resend.dev>`. Con il dominio di prova Resend, l'indirizzo destinatario puo essere soggetto alle limitazioni previste dall'account.
