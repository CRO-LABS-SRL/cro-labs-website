# CRO Labs

Sito aziendale con widget chat collegato a Telegram.

## Avvio locale

Richiede Node.js 24.x. Con nvm, eseguire `nvm install` e `nvm use` dalla cartella del progetto.

```bash
npm install
MYSQL_USER="utente" MYSQL_PASSWORD="password" MYSQL_DATABASE="nome_db" \
TELEGRAM_BOT_TOKEN="token-del-bot" TELEGRAM_CHAT_ID="id-della-chat" npm start
```

Il sito sara disponibile su `http://localhost:3000`.

## Configurazione su Hostinger

L'app Node e il database MySQL/MariaDB girano sullo stesso host.

- Node.js Version: `24.x` (selezionarla anche nel pannello Hostinger)
- Framework: `Other`
- Root Directory: `.`
- Build Command: `None` (nessuna compilazione richiesta)
- Package Manager: `npm`
- Output Directory: `.`
- Entry File: `server.js`
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
- `CONTACT_PHONE`: numero da mostrare dopo la verifica, in formato internazionale (es. `+39...`)
- `TURNSTILE_SITE_KEY`: chiave pubblica del widget Cloudflare Turnstile
- `TURNSTILE_SECRET_KEY`: chiave segreta Turnstile, da conservare solo sul server
- `TURNSTILE_EXPECTED_HOSTNAME`: hostname autorizzato restituito da Turnstile (consigliato, es. `cro-labs.it`)
- `HOSTINGER_API`: token API Hostinger (Bearer) per la verifica disponibilita dominio nella pagina STAI SENZA PENSIER'

Non inserire mai il token direttamente in `index.html` e non salvarlo nel repository.

## Landing Google Ads: Capri e Anacapri

La pagina `/servizi/siti-web-capri.html` è dedicata alla realizzazione di siti web per
le attività dell'isola. Usa il tag Google e il consenso condivisi, la chat Telegram
e il modulo `/api/contact` (richiede `RESEND_API_KEY`, `CONTACT_TO_EMAIL` e il mittente
`EMAIL_FROM` già usati dal sito). Le email riportano l'origine della landing nel messaggio.

Il pulsante WhatsApp usa `CONTACT_PHONE` tramite la stessa verifica Turnstile del
telefono: dopo la verifica mostra il link “Apri WhatsApp” con testo precompilato.
Il numero deve essere in formato internazionale e abilitato a WhatsApp. Nessun
messaggio WhatsApp viene inviato automaticamente. Servono anche le variabili
Turnstile descritte sotto. La conversione Google Ads della chat richiede ancora
la relativa etichetta di conversione prima di poter essere attivata.

## Protezione del numero di telefono

I pulsanti **Mostra numero** caricano Cloudflare Turnstile solo al clic. Il browser invia il token
al server tramite `POST /api/phone/reveal`; il server lo verifica con Siteverify e restituisce il
numero soltanto dopo una verifica valida. L'endpoint consente al massimo 5 tentativi ogni 10 minuti
per indirizzo IP. Senza `CONTACT_PHONE`, `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` la funzione
resta chiusa. Il numero è comunque accessibile tramite il collegamento WhatsApp della chat quando
`CONTACT_PHONE` è valido. Nel pannello Turnstile autorizzare il dominio pubblico del sito.

## Privacy, cookie e font locali

La pagina `/privacy-cookie.html` descrive i trattamenti e gli strumenti tecnici attualmente presenti.
Il relativo link compare nei footer, vicino ai moduli e nella chat. Aggiornare l'informativa prima di
aggiungere Google Analytics, pixel pubblicitari o nuovi fornitori che trattano dati dei visitatori.

Il tag Google Ads `AW-18450825976` è integrato in tutte le pagine pubbliche tramite
`assets/google-tag.js`. Il banner carica il tag solo dopo il consenso alla misurazione
(Consent Mode di base); analytics e personalizzazione pubblicitaria restano disattivati.
La scelta è valida per 180 giorni e modificabile da “Preferenze cookie” nel footer.
Il tag base non definisce eventi di conversione: per aggiungerli servono l'azione da
misurare e la relativa etichetta Google Ads, oppure una conversione configurata per URL.

Manrope e Space Grotesk sono serviti localmente tramite `/assets/fonts.css`; i file WOFF2 e le licenze
SIL Open Font License sono conservati in `assets/fonts/`. Le pagine non contattano Google Fonts.

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

Per ogni dominio libero il server consulta anche il catalogo Hostinger e confronta il prezzo del
primo anno e il prezzo ordinario di rinnovo. Il controllo del dominio usa USD, mentre prezzi mostrati
al cliente e pagamento Revolut restano in EUR:

```env
DOMAIN_MAX_ANNUAL_PRICE_CENTS=3000
DOMAIN_AUTO_EXTRA_MAX_ANNUAL_PRICE_CENTS=6000
DOMAIN_EXTRA_MARGIN_PERCENT=30
DOMAIN_USD_TO_EUR_RATE=1
```

Fino a 30 USD/anno il dominio e incluso. Tra 30 e 60 USD/anno il server stima il costo per la durata
scelta (`primo anno + rinnovo * anni restanti`), sottrae la quota gia inclusa e applica un margine
del 30%; dopo la conversione il supplemento viene arrotondato all'euro superiore e aggiunto al totale Revolut. Oltre
60 USD/anno, per domini premium o prezzi non verificabili viene proposto un preventivo. Il campo
Hostinger `restriction` descrive anche normali requisiti amministrativi del TLD: per esempio `.it`
richiede dati fiscali e anagrafici specifici. Queste indicazioni vengono mostrate come nota ma non
fanno scattare il preventivo, salvo che la restrizione identifichi esplicitamente un dominio premium.
La UI traduce il codice tecnico `v2.it_legal_documents` in una spiegazione comprensibile sui dati
aziendali e sulla verifica email richiesti per registrare un dominio `.it`.
L'eventuale differenza in USD viene convertita in euro usando `DOMAIN_USD_TO_EUR_RATE`, con valore
prudenziale predefinito `1`, prima di applicare il margine e aggiungerla al prezzo del pacchetto.

Il controllo viene ripetuto sul server subito prima della creazione del checkout Revolut, quindi
prezzi e supplementi non possono essere modificati dal browser. Il totale visualizzato viene inoltre
inviato come conferma: se non coincide piu con il calcolo autorevole del server, il checkout viene
bloccato e il cliente deve ripetere la ricerca per accettare il nuovo prezzo.
Il catalogo viene interrogato per la specifica estensione, evitando che la paginazione generale
faccia apparire un prezzo come mancante, e viene conservato in cache per un'ora. Prima dell'acquisto
Hostinger sara comunque necessario eseguire un'ultima verifica del prezzo.

Accanto a ogni dominio risultato "occupato" c'e un tasto **WHOIS** che chiama
`POST /api/domains/whois`; il server interroga RDAP (`https://rdap.org/domain/<dominio>`,
JSON via HTTPS, nessun token) e restituisce registrar, date di registrazione/scadenza,
stato, nameserver e DNSSEC. I risultati sono in cache per 6 ore; limite per IP 20/10 minuti.
RDAP non copre `.it` (il registro non lo espone): per quei domini il tasto mostra un avviso.

### Preventivi dominio via Telegram

I domini disponibili che richiedono una valutazione manuale mostrano **Richiedi preventivo**.
Il pulsante apre un modulo inline con nome, email, telefono e messaggio e chiama
`POST /api/domains/quote-request`. Il server ricalcola disponibilita e prezzo senza fidarsi del
browser, crea una normale conversazione nelle tabelle `chat_*` e invia il messaggio al bot Telegram
gia configurato con `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`.

Il messaggio Telegram include dominio, recapiti, prezzo catalogo del primo anno, rinnovo, stime
catalogo 5/10 anni, item ID, motivo del preventivo e un pulsante che apre la ricerca del dominio
direttamente su Hostinger. Il link permette di controllare il prezzo mostrato da Hostinger anche
quando il catalogo API non restituisce un importo utilizzabile. Questi dati interni non vengono
restituiti al browser: il cliente vede solo la propria richiesta. Rispondendo al messaggio con la funzione
**Rispondi** di Telegram, la risposta appare nella conversazione inline della pagina, aggiornata
ogni 3 secondi. Per un dominio premium il prezzo TLD viene segnalato come indicativo, perche potrebbe
non coincidere con il prezzo specifico finale del nome.

Non viene inviata alcuna email. Il recapito email e il telefono restano disponibili nel messaggio
Telegram per ricontattare il cliente se lascia la pagina.

### Verifica email prima dell'attivazione

Il pulsante **Attivalo con noi** richiede la verifica dell'indirizzo email prima di mostrare
il modulo con i dati aziendali:

Al clic viene chiamato anche `POST /api/domains/activation-interest`: il server ricontrolla il
dominio e invia su Telegram un avviso con prezzi Hostinger, stime 5/10 anni, supplementi in euro,
eventuali requisiti e pulsante di controllo Hostinger. In questa fase il cliente non ha ancora
fornito l'email. Le notifiche identiche da stesso IP e dominio vengono deduplicate per 30 minuti e
un errore Telegram non interrompe il percorso del cliente.

1. `POST /api/domains/activation/request-code` genera un codice numerico valido 15 minuti e lo invia tramite Resend.
2. `POST /api/domains/activation/verify-code` controlla il codice (massimo 5 tentativi) e restituisce una chiave di attivazione.
3. Il modulo aziendale viene sbloccato solo dopo la verifica. La chiave dovra essere validata nuovamente dal futuro endpoint di pagamento.

Il codice e salvato nel database solo sotto forma di hash. Per attivare la funzione, eseguire
la nuova `CREATE TABLE domain_activation_verifications` presente in `schema.sql` e configurare
le variabili MySQL e `RESEND_API_KEY` gia usate dal resto del sito.

### Checkout Revolut Sandbox

Dopo la verifica email, `POST /api/domains/checkout` valida nuovamente la chiave di attivazione,
salva i dati in `domain_service_orders`, crea un ordine Revolut e restituisce al browser solo
il relativo `checkout_url`. Gli importi sono determinati esclusivamente dal server:

- pacchetto 5 anni: `36000` centesimi EUR (360 EUR);
- pacchetto 10 anni: `69000` centesimi EUR (690 EUR).

Configurazione server:

```env
REVOLUT_SECRET_KEY=chiave_segreta_sandbox
REVOLUT_ENV=sandbox
PUBLIC_BASE_URL=https://cro-labs.it
```

`REVOLUT_ENV` usa `sandbox` come valore predefinito. Impostare `production` solo dopo i test e
insieme alla relativa chiave Production. `PUBLIC_BASE_URL` permette a Revolut di riportare il
cliente sulla pagina dopo il checkout. Eseguire anche la `CREATE TABLE domain_service_orders`
presente in `schema.sql`.
Se la tabella era gia stata creata, rieseguire anche l'ultima istruzione `ALTER TABLE` di
`schema.sql` per impostare EUR come valuta predefinita dei nuovi ordini. Gli ordini storici restano
registrati con la loro valuta originale.

Il ritorno del browser non costituisce prova del pagamento: lo stato definitivo viene gestito
dal webhook Revolut prima di acquistare il dominio tramite Hostinger.
Quando Revolut conferma lo stato `completed` e importo/valuta coincidono con l'ordine locale, il
server invia al cliente tramite Resend una conferma di pagamento e presa in carico. L'email precisa
che il dominio sara considerato attivo soltanto dopo la successiva conferma di registrazione.
Inoltre invia a `CONTACT_TO_EMAIL` e alla chat Telegram una notifica operativa con tutti i dati
necessari alla registrazione: azienda, partita IVA/codice fiscale, referente, recapiti, indirizzo,
dominio, pacchetto, importo e riferimenti CRO Labs/Revolut. Il messaggio Telegram include il pulsante
per aprire il dominio su Hostinger. I tre invii hanno indicatori separati nel database, così un
retry del webhook completa soltanto le notifiche mancanti senza ripetere quelle gia riuscite.
Anche il controllo stato eseguito dalla pagina sincronizza l'ordine con Revolut come recupero nel
caso in cui il webhook arrivi in ritardo.
La pagina controlla inoltre che le API restituiscano realmente JSON: un'eventuale pagina HTML di
errore del proxy/hosting viene trasformata in un messaggio leggibile, senza mostrare errori tecnici
come `Unexpected token '<'` al cliente.

Su un database gia esistente, prima di pubblicare questa versione, eseguire la migrazione
`migrations/2026-08-30-domain-order-notifications.sql`.

### Webhook Revolut

Registrare nel Merchant Sandbox il seguente URL pubblico:

```text
https://cro-labs.it/api/revolut/webhook
```

Eventi da abilitare:

- `ORDER_COMPLETED`
- `ORDER_AUTHORISED`
- `ORDER_CANCELLED`
- `ORDER_FAILED`

Alla creazione Revolut restituisce un `signing_secret`: salvarlo sul server e riavviare Node.

```env
REVOLUT_WEBHOOK_SECRET=signing_secret_del_webhook_sandbox
```

Il server rifiuta webhook con firma errata o timestamp distante piu di 5 minuti, supporta firme
multiple durante la rotazione del segreto e rilegge l'ordine dalla Merchant API prima di aggiornare
`domain_service_orders`. Per un ordine completato controlla anche che importo e valuta coincidano.
Le consegne duplicate sono sicure: l'aggiornamento dello stato e idempotente.

La pagina di ritorno interroga `GET /api/domains/order-status?order=<id>` per mostrare al cliente
lo stato confermato dal webhook. Il dominio non viene ancora acquistato automaticamente.

## Email con Resend

Il modulo contatti usa `/api/contact`, quindi non abbandona piu il sito dopo l'invio.
Per usare un indirizzo CRO Labs come mittente, verificare prima il dominio nella dashboard Resend e impostare `EMAIL_FROM` con un indirizzo di quel dominio.

Durante i primi test si puo omettere `EMAIL_FROM`: verra usato `CRO Labs <onboarding@resend.dev>`. Con il dominio di prova Resend, l'indirizzo destinatario puo essere soggetto alle limitazioni previste dall'account.

## Scelta del canale chat

Il widget condiviso tra home, servizi e pagina privacy propone Telegram (conversazione sul sito)
e WhatsApp (link esterno aperto in una nuova scheda/app). “Cambia canale” torna alla scelta senza
cancellare messaggi o bozze della chat sul sito.

Il widget usa `CONTACT_PHONE` con il numero WhatsApp completo di prefisso internazionale, ad esempio
`+39…`. `GET /api/chat/channels` restituisce il link pubblico `wa.me`; senza un numero valido
WhatsApp resta disabilitato con un messaggio, mentre Telegram continua a funzionare.
Il link WhatsApp rende il numero pubblico attraverso questo endpoint. Il flusso “Mostra numero”
continua a richiedere Turnstile.
