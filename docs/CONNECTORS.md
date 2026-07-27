# Konfiguracja źródeł i wysyłki

Panel prowadzi przez te same kroki w **Źródła i scraping → Dodaj źródło**.
Przycisk **Testuj połączenie** wykonuje w produkcji prawdziwe żądanie z funkcji
Netlify. Sekrety są szyfrowane po stronie serwera i nie wracają do przeglądarki.

## Gmail API

1. W Google Cloud utwórz projekt i włącz **Gmail API**.
2. Skonfiguruj ekran zgody OAuth.
3. Utwórz OAuth Client ID typu **Web application**.
4. Dla odbioru nadaj `https://www.googleapis.com/auth/gmail.readonly`.
5. Dla wysyłki dodaj `https://www.googleapis.com/auth/gmail.send`.
6. Uzyskaj refresh token przez własny callback albo OAuth Playground.
7. Wprowadź Client ID, Client Secret, Refresh Token, skrzynkę i etykiety.

Worker odświeża krótko żyjący access token automatycznie. Archiwum jest
pobierane partiami z kursorem `nextPageToken`; limit na przebieg chroni funkcję
przed timeoutem, ale nie ucina kolejnych stron. Dokumentacja Google:
[server-side OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server).

## Microsoft 365

1. W Microsoft Entra ID utwórz **App registration**.
2. Dodaj redirect URI typu Web.
3. Dodaj delegowane uprawnienia `offline_access`, `User.Read`, `Mail.Read`.
4. Jeżeli konto ma wysyłać, dodaj `Mail.Send`.
5. Utwórz sekret aplikacji i wykonaj authorization code flow.
6. Wprowadź Tenant ID, Client ID, Client Secret i Refresh Token.
7. Opcjonalnie podaj adres skrzynki współdzielonej.

Microsoft Graph zwraca kolejne strony przez `@odata.nextLink`; worker zachowuje
ten kursor do następnego przebiegu. Oficjalny opis:
[Microsoft identity platform authorization code flow](https://learn.microsoft.com/en-us/graph/auth-v2-user).

## IMAP

1. Włącz IMAP u dostawcy poczty.
2. Przy 2FA wygeneruj hasło aplikacji.
3. Wprowadź host, port, TLS/STARTTLS, login i hasło.
4. Podaj foldery rozdzielone przecinkami, np. `INBOX, Sent, Archive`.
5. Nie wyłączaj sprawdzania certyfikatu poza kontrolowanym środowiskiem.

Test otwiera rzeczywiste połączenie, uwierzytelnia użytkownika i listuje
foldery. Synchronizacja używa UID folderu, okna czasowego i deduplikacji.

## Webhook

Po zapisaniu źródła endpoint ma postać:

```text
https://TWOJA-APLIKACJA.netlify.app/hooks/SOURCE_ID
```

Wyślij `POST` z JSON-em i jedną z metod autoryzacji:

```text
Authorization: Bearer SEKRET_WEBHOOKA
```

albo podpisz surowe body HMAC SHA-256:

```text
X-MailFlow-Signature: sha256=HEX_HMAC
```

Przykładowy payload:

```json
{
  "event": { "id": "crm-12345" },
  "sender": { "email": "kontakt@example.com", "name": "Jan Kowalski" },
  "recipients": [{ "email": "sales@firma.pl" }],
  "subject": "Nowe zapytanie",
  "body": { "text": "Treść wiadomości", "html": "<p>Treść wiadomości</p>" },
  "created_at": "2026-07-27T15:00:00Z"
}
```

`externalId` jest obowiązkowy po zastosowaniu mapowania i gwarantuje
idempotencję. Przyjęcia, duplikaty i odrzucenia trafiają do
`webhook_deliveries`.

## Web scraper, RSS i sitemap

1. Podaj publiczny adres HTTP/HTTPS.
2. Wybierz główną treść, selektor CSS, RSS/Atom lub sitemap.
3. Dla selektora wpisz stabilny fragment, np. `main .article-list`.
4. Ustaw interwał co najmniej tak łagodny, jak pozwala regulamin serwisu.
5. Ustaw rozpoznawalny User-Agent z adresem kontaktowym.

Adresy lokalne i prywatne są blokowane zarówno przed żądaniem, jak i po
rozwiązaniu rekordów A/AAAA. Każde przekierowanie jest sprawdzane ponownie.
Odpowiedź ma limit 2 MB, a host musi znajdować się na allowliście źródła lub
w `SCRAPER_ALLOWED_HOSTS`. Gdy włączono tę opcję, worker respektuje
`robots.txt`. Porównanie podobieństwa treści pozwala ustawić minimalny procent
zmiany, więc drobna data lub licznik nie muszą tworzyć wiadomości. Pierwszy
odczyt może pozostać stanem bazowym albo wygenerować wiadomość zależnie od
ustawienia **Powiadom przy pierwszym odczycie**.

## Konta wysyłkowe

- **Gmail / Workspace**: refresh token z zakresem `gmail.send`.
- **Microsoft 365**: token z `Mail.Send`.
- **SMTP**: host, port, TLS, login i hasło aplikacji.
- **Resend**: klucz API i zweryfikowana domena nadawcy.
- **SendGrid**: klucz API z prawem wysyłki i zweryfikowany sender identity.
- **Amazon SES**: Access Key ID, Secret Access Key, region i zweryfikowana
  domena. Konto w sandboxie może wysyłać tylko do zweryfikowanych odbiorców.

Każdy odbiorca ma osobny rekord kolejki, maksymalnie trzy próby i własny status.
Workery pilnują limitu dziennego konta, a zaplanowane kampanie nie są pobierane
przed `scheduled_at`.
