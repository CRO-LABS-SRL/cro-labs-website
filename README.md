# CRO Labs

Sito aziendale con widget chat collegato a Telegram.

## Avvio locale

Richiede Node.js 18 o superiore.

```bash
TELEGRAM_BOT_TOKEN="token-del-bot" TELEGRAM_CHAT_ID="id-della-chat" npm start
```

Il sito sara disponibile su `http://localhost:3000`.

## Configurazione su Render

Creare (o aggiornare) un **Web Service** con:

- Build Command: lasciare vuoto oppure `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

In **Environment**, aggiungere queste variabili segrete:

- `TELEGRAM_BOT_TOKEN`: token ricevuto da BotFather
- `TELEGRAM_CHAT_ID`: ID della chat Telegram che ricevera i messaggi
- `TELEGRAM_WEBHOOK_SECRET`: stringa casuale lunga usata per verificare le chiamate Telegram
- `SUPABASE_URL`: URL del progetto Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: chiave service role Supabase, solo backend
- `RESEND_API_KEY`: chiave API creata su Resend
- `CONTACT_TO_EMAIL`: indirizzo che ricevera i messaggi del modulo contatti
- `EMAIL_FROM`: mittente verificato, ad esempio `CRO Labs <contatti@tuodominio.it>`

Non inserire mai il token direttamente in `index.html` e non salvarlo nel repository.

Per ricavare il Chat ID, inviare prima un messaggio al bot e aprire nel browser:

```text
https://api.telegram.org/bot<IL_TUO_TOKEN>/getUpdates
```

Nel risultato cercare `message.chat.id`.

## Chat bidirezionale sito e Telegram

1. Creare un progetto Supabase in una regione europea.
2. Aprire **SQL Editor** ed eseguire tutto il file `supabase/schema.sql`.
3. Copiare da Supabase l'URL progetto e la chiave `service_role` nelle variabili Hostinger.
4. Generare `TELEGRAM_WEBHOOK_SECRET` con una stringa casuale di almeno 32 caratteri.
5. Dopo che il sito Node e online, registrare il webhook Telegram:

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://cro-labs.it/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Il parametro `secret_token` deve essere identico alla variabile configurata su Hostinger.
Quando arriva un messaggio in Telegram, usare la funzione **Rispondi** sul messaggio del bot:
la risposta verra associata alla conversazione corretta e apparira nel widget del cliente.

La `SUPABASE_SERVICE_ROLE_KEY` non deve mai essere aggiunta a `index.html`, inviata al browser o salvata nel repository.

## Email con Resend

Il modulo contatti usa `/api/contact`, quindi non abbandona piu il sito dopo l'invio.
Per usare un indirizzo CRO Labs come mittente, verificare prima il dominio nella dashboard Resend e impostare `EMAIL_FROM` con un indirizzo di quel dominio.

Durante i primi test si puo omettere `EMAIL_FROM`: verra usato `CRO Labs <onboarding@resend.dev>`. Con il dominio di prova Resend, l'indirizzo destinatario puo essere soggetto alle limitazioni previste dall'account.
