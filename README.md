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
- `RESEND_API_KEY`: chiave API creata su Resend
- `CONTACT_TO_EMAIL`: indirizzo che ricevera i messaggi del modulo contatti
- `EMAIL_FROM`: mittente verificato, ad esempio `CRO Labs <contatti@tuodominio.it>`

Non inserire mai il token direttamente in `index.html` e non salvarlo nel repository.

Per ricavare il Chat ID, inviare prima un messaggio al bot e aprire nel browser:

```text
https://api.telegram.org/bot<IL_TUO_TOKEN>/getUpdates
```

Nel risultato cercare `message.chat.id`.

## Email con Resend

Il modulo contatti usa `/api/contact`, quindi non abbandona piu il sito dopo l'invio.
Per usare un indirizzo CRO Labs come mittente, verificare prima il dominio nella dashboard Resend e impostare `EMAIL_FROM` con un indirizzo di quel dominio.

Durante i primi test si puo omettere `EMAIL_FROM`: verra usato `CRO Labs <onboarding@resend.dev>`. Con il dominio di prova Resend, l'indirizzo destinatario puo essere soggetto alle limitazioni previste dall'account.
