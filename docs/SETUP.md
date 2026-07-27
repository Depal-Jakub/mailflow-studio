# Wdrożenie Supabase + Netlify

## 1. Supabase

1. Utwórz nowy projekt i zapisz jego `project ref`.
2. Zainstaluj lub uruchom Supabase CLI.
3. Z katalogu projektu wykonaj:

```bash
supabase login
supabase link --project-ref TWOJ_PROJECT_REF
supabase db push
```

Migracja tworzy tabele, indeksy, funkcje kolejkowe i polityki RLS. Następnie
wdroż funkcje:

```bash
supabase functions deploy ingest-message --no-verify-jwt
supabase functions deploy process-message --no-verify-jwt
supabase functions deploy scrape-worker --no-verify-jwt
supabase functions deploy action-worker --no-verify-jwt
```

Wygeneruj trzy różne losowe sekrety i ustaw je po stronie Supabase:

```bash
supabase secrets set \
  WORKER_SECRET="LOSOWY_DLUGI_SEKRET" \
  INGEST_SIGNING_SECRET="INNY_LOSOWY_SEKRET" \
  WEBHOOK_SIGNING_SECRET="KOLEJNY_LOSOWY_SEKRET" \
  WEBHOOK_ALLOWED_HOSTS="crm.twojafirma.pl,hooks.slack.com" \
  SCRAPER_ALLOWED_HOSTS="twojafirma.pl,partner.pl"
```

`SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` są automatycznie dostępne w Edge
Functions projektu Supabase.

## 2. Uwierzytelnianie

W Supabase przejdź do **Authentication → URL Configuration**:

- Site URL: docelowy adres Netlify;
- Redirect URLs: `https://TWOJA-NAZWA.netlify.app/**`;
- lokalnie: `http://localhost:8888/**` i `http://localhost:4173/**`.

Wyłącz publiczne rejestracje, jeżeli dostęp ma być wyłącznie z zaproszeń.

## 3. Pierwszy administrator

Ustaw zmienne tylko w lokalnym terminalu i uruchom skrypt:

```bash
export SUPABASE_URL="https://PROJECT_REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="SERVICE_ROLE_TYLKO_LOKALNIE"
export BOOTSTRAP_ADMIN_EMAIL="admin@twojafirma.pl"
export BOOTSTRAP_ORGANIZATION_NAME="Twoja firma"
export BOOTSTRAP_ORGANIZATION_SLUG="twoja-firma"
export PUBLIC_APP_URL="https://TWOJA-NAZWA.netlify.app"
npm run bootstrap-admin
```

Skrypt zaprosi użytkownika, utworzy organizację i nada rolę `owner`. Po użyciu
usuń `SUPABASE_SERVICE_ROLE_KEY` z historii powłoki i lokalnego środowiska.

## 4. Netlify

W **Site configuration → Environment variables** ustaw:

```dotenv
VITE_APP_NAME=MailFlow Studio
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SB_PUBLISHABLE_KEY
VITE_DEMO_MODE=false

SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SERVICE_ROLE_KEY
APP_ENCRYPTION_KEY=32_LOSOWE_BAJTY_BASE64
ADMIN_ALLOWED_ORIGINS=https://TWOJA-NAZWA.netlify.app
WORKER_SECRET=TEN_SAM_SEKRET_CO_W_SUPABASE
INGEST_SIGNING_SECRET=TEN_SAM_INGEST_SECRET
WEBHOOK_SIGNING_SECRET=TEN_SAM_WEBHOOK_SECRET
WEBHOOK_ALLOWED_HOSTS=crm.twojafirma.pl,hooks.slack.com
SCRAPER_ALLOWED_HOSTS=twojafirma.pl,partner.pl

CONNECTORS_PER_RUN=3
PROCESSING_BATCH_SIZE=50
ORGANIZATIONS_PER_RUN=10
OUTBOUND_BATCH_SIZE=20
```

Ustawienia budowania są już w `netlify.toml`:

- build command: `npm run build`;
- publish directory: `dist`;
- functions directory: `netlify/functions`;
- SPA redirect i `/api/*` są skonfigurowane;
- konektory uruchamiają się co 5 minut;
- pipeline i wysyłka uruchamiają się co minutę.

## 5. Dodawanie kont

### IMAP

Sekret konta:

```json
{
  "host": "imap.example.com",
  "port": 993,
  "secure": true,
  "username": "skrzynka@example.com",
  "password": "HASLO_APLIKACJI"
}
```

### SMTP

```json
{
  "host": "smtp.example.com",
  "port": 587,
  "secure": false,
  "requireTLS": true,
  "username": "powiadomienia@example.com",
  "password": "HASLO_APLIKACJI"
}
```

### Gmail / Google Workspace

Użyj klienta OAuth typu **Web application**. Refresh token powinien zawierać
odpowiedni zakres:

- odbiór: `https://www.googleapis.com/auth/gmail.readonly`;
- wysyłka: `https://www.googleapis.com/auth/gmail.send`.

Sekret:

```json
{
  "clientId": "...apps.googleusercontent.com",
  "clientSecret": "...",
  "refreshToken": "...",
  "username": "konto@firma.pl"
}
```

### Microsoft 365

Wymagane są zgody `Mail.Read`, `Mail.Send` i `offline_access`.

```json
{
  "tenantId": "common-lub-id-tenanta",
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "...",
  "username": "konto@firma.pl"
}
```

## 6. Test odbioru i pipeline

Po dodaniu aktywnego źródła można ręcznie wywołać worker:

```bash
curl -X POST \
  -H "Authorization: Bearer $WORKER_SECRET" \
  "https://TWOJA-NAZWA.netlify.app/.netlify/functions/connector-worker"
```

Następnie:

```bash
curl -X POST \
  -H "Authorization: Bearer $WORKER_SECRET" \
  "https://TWOJA-NAZWA.netlify.app/.netlify/functions/pipeline-worker"
```

Sprawdź `connector_sync_runs`, `messages`, `message_rule_matches`,
`action_jobs` i `audit_events`. Pierwsze reguły warto uruchomić w trybie
nieaktywnym, przetestować na przykładowych wiadomościach, a dopiero potem
opublikować.
