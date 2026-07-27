# Changelog

Wszystkie istotne zmiany projektu są opisywane w tym pliku. Format jest zgodny
z [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), a wersje z
Semantic Versioning.

## [0.1.0] - 2026-07-27

### Dodano

- wielofirmowy panel operacyjny z trzynastoma osobnymi modułami;
- źródła Gmail, Microsoft 365, IMAP, webhook, web scraper, RSS i sitemap;
- wizualne reguły, scoring, kategorie, review oraz wersjonowanie;
- automatyzacje zdarzeniowe i harmonogramowe z retry, delay i historią kroków;
- wysyłkę przez SMTP, Gmail, Outlook, Resend, SendGrid i Amazon SES;
- granularne role, zaproszenia, RLS i audyt operacji;
- publiczne API v1 z kluczami per organizacja, scope, CIDR i rate limitingiem;
- OpenAPI 3.1, interaktywną dokumentację oraz kolekcję Postman;
- serwerowe raporty odporne na domyślny limit 1000 rekordów PostgREST;
- pełny tryb demonstracyjny bez backendu.

### Bezpieczeństwo

- szyfrowanie sekretów AES-256-GCM;
- podpis HMAC webhooków i idempotentny ingest;
- ochrona scrapera przed SSRF, prywatnym DNS i niebezpiecznymi redirectami;
- automatyczny skan sekretów;
- atomowe tworzenie kampanii i odbiorców;
- atomowy limiter publicznego API.

### Weryfikacja

- test migracji na pustym PostgreSQL;
- testy frontendu, backendu, providerów HTTP i Edge Functions;
- walidacja OpenAPI, TypeScript, ESLint i build produkcyjny;
- QA panelu na desktopie i urządzeniu mobilnym.

[0.1.0]: https://github.com/Depal-Jakub/mailflow-studio/releases/tag/v0.1.0
