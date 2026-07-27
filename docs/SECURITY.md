# Bezpieczeństwo

## Sekrety

- Do frontendu wolno przekazać tylko `VITE_SUPABASE_URL` i
  `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, hasła SMTP/IMAP i tokeny
  OAuth są wyłącznie po stronie funkcji.
- `APP_ENCRYPTION_KEY` musi mieć 32 losowe bajty zakodowane Base64:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

- Zmiana tego klucza wymaga kontrolowanej migracji i ponownego zaszyfrowania
  istniejących sekretów.

## OAuth

Refresh token nie ma gwarancji „nigdy nie wygasa”. Może zostać cofnięty przez
administratora, zmianę hasła, politykę dostawcy lub nieużywanie aplikacji.
Panel przechowuje stan i błąd konektora; alarm `invalid_grant` należy obsłużyć
ponownym połączeniem konta.

## Scraping i webhooki

- Scraper pobiera wyłącznie hosty z `SCRAPER_ALLOWED_HOSTS` lub
  `source_connectors.public_config.allowed_hosts`.
- Lokalne adresy i prywatne IPv4 są blokowane, odpowiedź ma limit 2 MB, a czas
  żądania 12 sekund.
- Webhooki wymagają HTTPS, listy `WEBHOOK_ALLOWED_HOSTS` i podpisu HMAC.
- Endpoint ingest przyjmuje `WORKER_SECRET` albo podpis
  `x-mailflow-signature: sha256=...`.

## Operacje

- Ustaw dokładną listę `ADMIN_ALLOWED_ORIGINS`; nie używaj `*`.
- Włącz MFA dla kont właścicieli i administratorów.
- Ogranicz rejestrację użytkowników w Supabase do zaproszeń.
- Monitoruj `audit_events`, błędy konektorów i martwe kolejki.
- Regularnie aktualizuj zależności i wykonuj `npm audit`.
