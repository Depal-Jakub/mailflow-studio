# MailFlow Studio

Uniwersalne centrum operacyjne do odbierania, klasyfikacji, wzbogacania i
wysyłania wiadomości. Projekt jest niezależną aplikacją i nie korzysta z
danych ani sekretów systemu źródłowego.

## Co jest gotowe

- osobne trasy dla dashboardu, wiadomości, źródeł, kategorii, reguł,
  automatyzacji, wysyłki, kont, użytkowników, raportów, audytu i ustawień;
- wizualny edytor reguł `all/any`, priorytety, wersje i test na wiadomości;
- konektory Gmail, Microsoft 365 i IMAP oraz konta SMTP/Gmail/Outlook,
  SendGrid i Resend;
- kolejki bezpieczne na równoległe workery (`SKIP LOCKED`);
- uniwersalny webhook ingest z deduplikacją i podpisem HMAC;
- scraper HTML z parserem DOM, limitem rozmiaru i listą dozwolonych hostów;
- wysyłka seryjna z limitami, retry i historią każdego odbiorcy;
- organizacje, role, RLS, audyt i szyfrowanie sekretów AES-256-GCM;
- tryb demonstracyjny bez backendu oraz tryb produkcyjny z logowaniem Supabase.

## Start lokalny

```bash
cd "/Users/jakub/Desktop/mailflow-studio"
cp .env.example .env.local
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Domyślnie `VITE_DEMO_MODE=true`, więc można obejrzeć i przetestować cały panel
bez bazy. Produkcyjne uruchomienie opisuje [SETUP.md](docs/SETUP.md).

## Kontrole jakości

```bash
npm run lint
npm test
npm run build
npm audit
```

## Architektura

- `src/` - React/Vite, routing, interakcje i komponenty panelu;
- `netlify/functions/admin-api.mjs` - autoryzowane API panelu;
- `netlify/functions/connector-worker.mjs` - cykliczny Gmail/Outlook/IMAP;
- `netlify/functions/pipeline-worker.mjs` - klasyfikacja, scraping i akcje;
- `netlify/functions/outbound-worker.mjs` - kolejka wysyłkowa;
- `supabase/functions/` - ingest, procesor reguł i izolowane workery;
- `supabase/migrations/` - pełny model danych, indeksy, RLS i RPC;
- `docs/design/` - zaakceptowane koncepcje ekranów odniesienia.

Szczegóły przepływu są w [ARCHITECTURE.md](docs/ARCHITECTURE.md), a zasady
bezpieczeństwa w [SECURITY.md](docs/SECURITY.md).
