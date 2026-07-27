# Gotowość produkcyjna

Ten dokument rozdziela to, co jest weryfikowane automatycznie w repozytorium,
od testów, które muszą zostać wykonane z prawdziwymi kontami i infrastrukturą
docelową.

## Macierz funkcji

| Obszar | Implementacja | Kontrola automatyczna | Test przed startem |
| --- | --- | --- | --- |
| routing SPA i responsywny panel | gotowe | lint, TypeScript, build, ręczny Browser QA | smoke test Netlify |
| Supabase Auth i członkostwa | gotowe | kontrola typów i RLS w migracji | logowanie, zaproszenie i MFA |
| role per firma | gotowe | test uprawnień | dwie firmy i różne role |
| Gmail API | gotowe | walidacja konfiguracji | prawdziwy OAuth i pobranie maila |
| Microsoft Graph | gotowe | walidacja konfiguracji | tenant testowy i shared mailbox |
| IMAP | gotowe | walidacja payloadu | konto testowe TLS |
| webhook HMAC/Bearer | gotowe | parser, deduplikacja | podpisane żądanie z systemu klienta |
| scraper/RSS/sitemap | gotowe | parser, DNS/SSRF, robots.txt i próg zmian | dozwolony host i realna strona |
| reguły i scoring | gotowe | testy silnika | próbka reprezentatywnych wiadomości |
| SMTP/Gmail/Outlook/Resend/SendGrid/SES | gotowe | typy oraz testy kontraktów Resend/SendGrid | wysyłka do kontrolowanego odbiorcy |
| publiczne API i klucze | gotowe | testy hashy, scope, IP i kursorów | klucz produkcyjny i `/v1/me` |
| rate limiting | gotowe | funkcja atomowa w migracji | równoległy test na stagingu |
| audyt operacji API | gotowe | kontrola składni | wpis po operacji testowej |
| retry i kolejki | gotowe | bezpieczne claimy `SKIP LOCKED` | wymuszony błąd dostawcy |
| harmonogram Netlify | skonfigurowany | `netlify.toml` | sprawdzenie Scheduled Functions |
| backup i odtworzenie | procedura gotowa | nie dotyczy | próbne odtworzenie bazy |

## Co oznacza „gotowe”

Kod i kontrakty są kompletne, kompilują się, przechodzą testy i mają
zabezpieczenia wielofirmowe. Nie oznacza to gwarancji działania dowolnego
dostawcy bez jego prawdziwych danych. OAuth, polityki Microsoft 365, sandbox
SES, reputacja domeny, limity Gmail i firewalle IMAP są zewnętrznym stanem,
którego CI repozytorium nie może zasymulować w pełni.

`npm run check` uruchamia testy frontendu, backendu i Edge Functions, skan
sekretów, lint OpenAPI, instalację wszystkich migracji na pustym PostgreSQL,
test krytycznych RPC, kontrolę składni funkcji oraz build produkcyjny.

## Bramka wdrożeniowa

Przed pierwszym ruchem produkcyjnym wykonaj:

```bash
npm ci
npm run check
npm audit --audit-level=high
```

Następnie:

1. zastosuj wszystkie migracje na pustym projekcie staging;
2. utwórz administratora skryptem bootstrap;
3. przetestuj zaproszenie, zawieszenie i zmianę roli użytkownika;
4. dodaj po jednym testowym źródle każdego faktycznie używanego typu;
5. pobierz jedną wiadomość i potwierdź brak duplikatu po drugiej synchronizacji;
6. uruchom regułę testową i sprawdź `message_rule_matches`;
7. wyślij do kontrolowanego odbiorcy każdym używanym providerem;
8. utwórz klucz tylko z `messages:read` i potwierdź odrzucenie zapisu;
9. sprawdź retry po kontrolowanym błędzie i wpis w audycie;
10. wykonaj próbny backup oraz odtworzenie.

## Kryteria startu

- brak błędów wysokiego poziomu w `npm audit`;
- brak nieobsłużonych błędów w logach funkcji przez 24 godziny stagingu;
- wszystkie używane konektory mają status aktywny;
- DNS wysyłkowy ma SPF, DKIM i DMARC;
- administratorzy mają MFA;
- `ADMIN_ALLOWED_ORIGINS` i allowlisty scraperów nie używają wildcardów;
- alarmy obejmują błędy synchronizacji, martwe kolejki i wzrost `failed`;
- właściciel procesu zna procedurę rotacji sekretów i odtworzenia backupu.

## Znane granice

- serwerowa funkcja ma limit czasu narzucony przez plan Netlify; dlatego workery
  przetwarzają małe partie i kontynuują w kolejnym przebiegu;
- odbiorcy masowej wysyłki są ograniczeni do 10 000 na jedno żądanie API;
- treść pojedynczego żądania publicznego API ma limit 1 MB;
- access tokeny OAuth są krótkotrwałe, a refresh token może zostać cofnięty
  przez dostawcę; system raportuje `invalid_grant`, ale nie może temu zapobiec;
- dostarczenie i otwarcie wiadomości zależy od funkcji danego dostawcy.
