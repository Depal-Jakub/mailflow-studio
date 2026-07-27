# Operacje i utrzymanie

## Harmonogram

Netlify uruchamia:

| Funkcja | Interwał | Cel |
| --- | --- | --- |
| `connector-worker` | co 5 min | Gmail, Microsoft 365 i IMAP |
| `scrape-dispatcher` | co 5 min | źródła WWW, RSS i sitemap |
| `pipeline-worker` | co 1 min | reguły, scraping z wiadomości i akcje |
| `outbound-worker` | co 1 min | kolejka odbiorców i retry wysyłki |
| `maintenance-worker` | codziennie 02:15 UTC | retencja logów API i limiterów |

Wywołanie ręczne wymaga `WORKER_SECRET`:

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $WORKER_SECRET" \
  "https://APP.netlify.app/.netlify/functions/pipeline-worker"
```

## Codzienna kontrola

1. sprawdź źródła ze statusem `warning` lub `error`;
2. sprawdź wiadomości `failed` i `review`;
3. sprawdź odbiorców wysyłki `failed`;
4. sprawdź ostatnie zdarzenia audytowe o poziomie `error`;
5. porównaj czas ostatniej synchronizacji z oczekiwanym interwałem.

## Diagnostyka kolejki

Najpierw rozdziel problem na ingest, klasyfikację, akcję lub dostarczenie:

```sql
select status, count(*) from messages group by status order by status;
select status, count(*) from scrape_jobs group by status order by status;
select status, count(*) from action_jobs group by status order by status;
select status, count(*) from outbound_recipients group by status order by status;
```

Rekord długo pozostający w `processing` może oznaczać zakończenie funkcji po
przejęciu zadania. Funkcje claimujące mają timeout i kolejne przebiegi powinny
odzyskać pracę. Nie zmieniaj statusów ręcznie bez zapisania kopii rekordu i
ustalenia przyczyny.

## Błąd 504

HTTP `504` zwykle oznacza przekroczenie czasu funkcji, a nie utratę danych:

1. odczytaj log funkcji i `request_id`;
2. zmniejsz odpowiedni limit partii env, np. `PROCESSING_BATCH_SIZE`;
3. sprawdź, czy zewnętrzny provider odpowiada wolno;
4. uruchom worker ręcznie z małą partią;
5. potwierdź, że claim/retry nie utworzył duplikatu.

Nie zwiększaj wszystkich partii równocześnie. System celowo kontynuuje pracę
między przebiegami.

## OAuth `invalid_grant`

Refresh token może zostać cofnięty po zmianie hasła, polityce administratora,
usunięciu aplikacji lub długim okresie bez użycia.

1. w panelu otwórz źródło lub konto wysyłkowe;
2. wygeneruj nowy refresh token z właściwymi scope;
3. zapisz sekret i uruchom **Testuj połączenie**;
4. wykonaj synchronizację lub kontrolowaną wysyłkę;
5. sprawdź, czy `last_error` został wyczyszczony.

## Rotacja sekretów

- klucze publicznego API: drugi klucz, przełączenie klienta, unieważnienie;
- refresh token OAuth: podmiana w panelu i test;
- hasło SMTP/IMAP: nowe hasło aplikacji i test;
- `WORKER_SECRET`: podmiana równocześnie w Supabase i Netlify;
- `APP_ENCRYPTION_KEY`: wymaga kontrolowanego odszyfrowania i ponownego
  zaszyfrowania wszystkich sekretów, nie wolno zmieniać go w ciemno;
- `SUPABASE_SERVICE_ROLE_KEY`: po rotacji zaktualizuj wyłącznie funkcje
  serwerowe.

Każdą rotację zapisz w audycie i wykonuj najpierw na stagingu.

## Retencja API

Procedura porządkująca usuwa stare logi żądań i krótkie koszyki limitów:

```sql
select public.cleanup_api_history(
  request_log_retention_days := 90,
  rate_bucket_retention_hours := 24
);
```

Uruchamiaj ją codziennie przez Supabase Cron albo kontrolowany job
administracyjny. Dziennik biznesowy `audit_events` ma osobną retencję.

## Backup i odtworzenie

Minimum:

- codzienny backup zarządzany Supabase;
- okresowy eksport schematu i danych krytycznych;
- osobna kopia konfiguracji DNS i dostawców OAuth;
- zaszyfrowany backup klucza `APP_ENCRYPTION_KEY`;
- kwartalny test odtworzenia do innego projektu.

Po odtworzeniu trzeba zaktualizować URL projektu, klucze Netlify, redirect URI
OAuth i endpointy webhooków. Następnie wykonaj bramkę z
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Alarmy

Zalecane progi:

- źródło bez udanej synchronizacji dłużej niż 2 oczekiwane interwały;
- więcej niż 5% wiadomości `failed` w ciągu 15 minut;
- więcej niż 3 kolejne błędy jednego providera;
- odbiorcy `pending` starsi niż 10 minut;
- API `5xx` powyżej 1% przez 5 minut;
- wykorzystanie limitu wysyłkowego powyżej 80%;
- nagły wzrost `429`, `401` lub `invalid_grant`.

Każdy alert powinien zawierać organizację, funkcję, rekord, `request_id` i
bezpośredni link do odpowiedniego widoku panelu.
