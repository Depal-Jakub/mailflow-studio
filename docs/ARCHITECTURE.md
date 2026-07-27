# Architektura MailFlow Studio

## Przepływ danych

```mermaid
flowchart LR
  A["Gmail / Outlook / IMAP / webhook"] --> B["Ingest i deduplikacja"]
  B --> C["Kolejka nowych wiadomości"]
  C --> D["Silnik wersjonowanych reguł"]
  D --> E["Kategoria, score, tagi lub review"]
  D --> F["Kolejka scrapingu"]
  D --> G["Kolejka akcji"]
  F --> H["Treść i metadane stron"]
  G --> I["Webhook, zadanie lub wiadomość wychodząca"]
  I --> J["Kolejka odbiorców"]
  J --> K["SMTP / Gmail / Outlook / SendGrid / Resend"]
  K --> L["Status każdego odbiorcy i raport"]
```

## Granice odpowiedzialności

- **Przeglądarka** ma wyłącznie klucz publikowalny Supabase i token zalogowanego
  użytkownika. Nie otrzymuje haseł, refresh tokenów ani `service_role`.
- **Admin API** sprawdza token, organizację i rolę przed każdą operacją. Sekrety
  szyfruje przed zapisaniem ich w prywatnym schemacie.
- **Konektor** pobiera ograniczoną partię wiadomości i zapisuje tylko nowe.
  Cofnięcie okna o godzinę chroni przed lukami, a hash chroni przed duplikatami.
- **Procesor** atomowo przejmuje wiadomości i zapisuje wersję każdej trafionej
  reguły oraz wynik każdego warunku.
- **Workery** wykonują krótkie partie. Błąd jednej akcji nie blokuje pozostałych.
- **PostgreSQL** jest źródłem prawdy dla stanów, liczników i historii.

## Wielofirmowość

Każdy rekord operacyjny ma `organization_id`. Polityki RLS dopuszczają odczyt
członkom organizacji, zapis operatorom, a usuwanie administratorom. Sekrety są
w schemacie `private` i dostępne wyłącznie przez RPC dla roli serwisowej.

## Skalowanie

- Widoki powinny używać paginacji po `received_at, id`, nie pobierać całych tabel.
- Kolejki mają indeksy częściowe tylko dla stanów oczekujących.
- `FOR UPDATE SKIP LOCKED` pozwala uruchamiać kilka workerów bez dublowania pracy.
- Limity partii są sterowane envami i można je zmniejszyć dla planu Netlify.
- Duże załączniki powinny trafiać do Supabase Storage, a w tabeli pozostają
  metadane i wynik ekstrakcji.
