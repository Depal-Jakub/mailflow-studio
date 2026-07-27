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

## Klucze publicznego API

- Pełny klucz `mfs_live_...` jest generowany kryptograficznie i wyświetlany
  tylko raz. Baza przechowuje wyłącznie SHA-256 oraz krótki prefiks.
- Każdy klucz jest przypisany do jednej organizacji, ma zakresy, status, limit
  na minutę, opcjonalne wygaśnięcie i allowlistę IP/CIDR.
- Limit jest zużywany atomowo w PostgreSQL, więc nie da się go ominąć przez
  równoległe instancje funkcji.
- Rotacja i unieważnienie są audytowane. Klucza nie wolno przekazywać do
  `VITE_*`, localStorage, adresu URL ani repozytorium.
- Log wywołań zapisuje metodę, ścieżkę, status, czas, IP i `request_id`, ale
  nie zapisuje nagłówka `Authorization` ani body.

## OAuth

Refresh token nie ma gwarancji „nigdy nie wygasa”. Może zostać cofnięty przez
administratora, zmianę hasła, politykę dostawcy lub nieużywanie aplikacji.
Panel przechowuje stan i błąd konektora; alarm `invalid_grant` należy obsłużyć
ponownym połączeniem konta.

## Scraping i webhooki

- Scraper pobiera wyłącznie hosty z `SCRAPER_ALLOWED_HOSTS` lub
  `source_connectors.public_config.allowed_hosts`.
- Lokalne adresy, prywatne IPv4 i prywatne IPv6 są blokowane przed pobraniem
  oraz po rozwiązaniu DNS. Każde przekierowanie przechodzi tę samą kontrolę.
  Odpowiedź ma limit 2 MB, czas żądania 12 sekund, a opcjonalne `robots.txt`
  jest respektowane.
- Webhooki wymagają HTTPS, listy `WEBHOOK_ALLOWED_HOSTS` i podpisu HMAC.
- Endpoint ingest przyjmuje `WORKER_SECRET` albo podpis
  `x-mailflow-signature: sha256=...`.

## Operacje

- Ustaw dokładną listę `ADMIN_ALLOWED_ORIGINS`; nie używaj `*`.
- Włącz MFA dla kont właścicieli i administratorów.
- Ogranicz rejestrację użytkowników w Supabase do zaproszeń.
- Monitoruj `audit_events`, błędy konektorów i martwe kolejki.
- Regularnie aktualizuj zależności i wykonuj `npm audit`.
- Uruchamiaj `npm run check:secrets` przed każdym pushem; skaner nie zastępuje
  rotacji sekretu, który kiedykolwiek został ujawniony.
