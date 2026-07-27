# Publiczne API MailFlow Studio

Publiczne API v1 pozwala integrować MailFlow Studio z CRM, ERP, hurtownią
danych, własnym portalem oraz automatyzacjami. Każdy klucz należy dokładnie do
jednej organizacji, więc klient nie przesyła i nie może podmienić
`organization_id`.

- adres bazowy: `https://TWOJA-APLIKACJA.netlify.app/v1`;
- format: JSON UTF-8;
- maksymalny rozmiar body: 1 MB;
- specyfikacja maszynowa: [`/openapi.yaml`](../public/openapi.yaml);
- gotowe żądania: [`/postman_collection.json`](../public/postman_collection.json).

## Generowanie klucza

1. Zaloguj się jako właściciel lub administrator.
2. Otwórz **API dla deweloperów → Nowy klucz API**.
3. Nadaj nazwę odpowiadającą jednej integracji i środowisku.
4. Wybierz tylko potrzebne zakresy.
5. Opcjonalnie ustaw datę wygaśnięcia i allowlistę IPv4, IPv6 lub CIDR.
6. Skopiuj sekret `mfs_live_...`. System pokaże go tylko raz.

W bazie jest zapisywany wyłącznie hash SHA-256 oraz krótki prefiks
identyfikacyjny. Utraconego sekretu nie da się odczytać; należy wykonać rotację.

## Uwierzytelnianie

Zalecany nagłówek:

```http
Authorization: Bearer mfs_live_TAJNY_KLUCZ
```

Alternatywnie:

```http
X-API-Key: mfs_live_TAJNY_KLUCZ
```

Klucza nie wolno umieszczać w adresie URL, kodzie frontendu, aplikacji mobilnej
ani repozytorium. Integracja powinna pobierać go z menedżera sekretów lub
zmiennej środowiskowej `MAILFLOW_API_KEY`.

## Zakresy

| Zakres | Uprawnienie |
| --- | --- |
| `messages:read` | lista i pełne dane wiadomości |
| `messages:write` | ingest oraz aktualizacja klasyfikacji |
| `categories:read` | odczyt kategorii |
| `categories:write` | tworzenie, edycja i usuwanie kategorii |
| `sources:read` | publiczna konfiguracja i stan źródeł |
| `sources:sync` | ręczne zaplanowanie synchronizacji |
| `templates:read` | odczyt aktywnych szablonów |
| `outbound:read` | historia wysyłek i odbiorców |
| `outbound:write` | wersje robocze, kolejki i wysyłki planowane |
| `audit:read` | dziennik zdarzeń organizacji |

Wewnętrzny zakres `*` jest obsługiwany przez backend, ale panel celowo go nie
oferuje. Zwykłe integracje powinny korzystać z zasady najmniejszych uprawnień.

## Endpointy v1

| Metoda i ścieżka | Zakres | Zastosowanie |
| --- | --- | --- |
| `GET /health` | publiczny | stan funkcji API |
| `GET /me` | dowolny aktywny klucz | organizacja, klucz i jego zakresy |
| `GET /messages` | `messages:read` | filtry, wyszukiwanie i paginacja |
| `POST /messages` | `messages:write` | idempotentny ingest wiadomości |
| `GET /messages/{id}` | `messages:read` | treść, załączniki i wyniki reguł |
| `PATCH /messages/{id}` | `messages:write` | kategoria, score, status i tagi |
| `GET /categories` | `categories:read` | lista kategorii |
| `POST /categories` | `categories:write` | utworzenie kategorii |
| `PATCH /categories/{id}` | `categories:write` | aktualizacja kategorii |
| `DELETE /categories/{id}` | `categories:write` | usunięcie kategorii |
| `GET /sources` | `sources:read` | publiczny stan źródeł |
| `POST /sources/{id}/sync` | `sources:sync` | zaplanowanie synchronizacji |
| `GET /templates` | `templates:read` | aktywne szablony |
| `GET /outbound-messages` | `outbound:read` | historia kampanii |
| `POST /outbound-messages` | `outbound:write` | atomowe utworzenie kampanii |
| `GET /outbound-messages/{id}` | `outbound:read` | kampania i odbiorcy |
| `GET /audit` | `audit:read` | dziennik operacji |

Pełne parametry, schematy i wszystkie kody odpowiedzi są dostępne w
interaktywnej dokumentacji pod `/api-docs.html`.

## Pierwsze żądanie

```bash
export MAILFLOW_API_KEY="mfs_live_..."
export MAILFLOW_API_URL="https://TWOJA-APLIKACJA.netlify.app/v1"

curl --fail-with-body \
  -H "Authorization: Bearer $MAILFLOW_API_KEY" \
  "$MAILFLOW_API_URL/me"
```

Odpowiedź:

```json
{
  "ok": true,
  "data": {
    "organization_id": "3d1de7b0-947d-4aa3-b366-5b9a73c6fb15",
    "api_key": {
      "id": "4a6650bd-4ee2-49d7-b24e-c6b57b2253e2",
      "name": "CRM produkcja",
      "scopes": ["messages:read", "messages:write"]
    }
  },
  "request_id": "df431fc1-d235-45b8-a3f0-6f0126e9779b"
}
```

### JavaScript / Node.js

```js
const response = await fetch(
  `${process.env.MAILFLOW_API_URL}/messages?limit=50`,
  {
    headers: {
      Authorization: `Bearer ${process.env.MAILFLOW_API_KEY}`,
    },
  },
);

if (!response.ok) {
  const error = await response.json();
  throw new Error(`${error.error.code}: ${error.error.message}`);
}

const { data, request_id: requestId } = await response.json();
console.log(data.items, requestId);
```

### Python

```python
import os
import requests

response = requests.get(
    f"{os.environ['MAILFLOW_API_URL']}/messages",
    params={"limit": 50, "status": "review"},
    headers={
        "Authorization": f"Bearer {os.environ['MAILFLOW_API_KEY']}",
    },
    timeout=30,
)
response.raise_for_status()
page = response.json()["data"]
```

## Ingest i idempotencja

`POST /messages` wymaga `external_id` albo nagłówka `Idempotency-Key`. Dla tej
samej organizacji drugi identyczny identyfikator nie utworzy duplikatu.

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $MAILFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: crm-lead-84219" \
  -d '{
    "sender_email": "anna@example.com",
    "sender_name": "Anna Nowak",
    "recipients": [{"email": "sprzedaz@firma.pl"}],
    "subject": "Zapytanie o ofertę",
    "body_text": "Proszę o kontakt.",
    "tags": ["crm", "lead"]
  }' \
  "$MAILFLOW_API_URL/messages"
```

Pierwsze przyjęcie zwraca HTTP `201` i `created: true`. Powtórzenie zwraca
HTTP `200`, `created: false` i identyfikator istniejącego rekordu.

## Paginacja

Lista wiadomości używa nieprzezroczystego kursora:

```bash
curl -H "Authorization: Bearer $MAILFLOW_API_KEY" \
  "$MAILFLOW_API_URL/messages?limit=50"
```

```json
{
  "ok": true,
  "data": {
    "items": [],
    "next_cursor": "eyJ0aW1lc3RhbXAiOi..."
  },
  "request_id": "..."
}
```

Następną stronę pobiera się przez `?limit=50&cursor=...`. Klient nie powinien
dekodować ani konstruować kursora. Wyszukiwanie i filtry należy przesłać
ponownie przy każdej stronie.

## Tworzenie wysyłki

Wersja robocza nie wymaga konta nadawczego:

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $MAILFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Informacja dla klienta",
    "text_body": "Dzień dobry, przesyłamy aktualizację.",
    "status": "draft",
    "recipients": [
      {
        "email": "anna@example.com",
        "name": "Anna",
        "variables": {"case_number": "MF-2026-41"}
      }
    ]
  }' \
  "$MAILFLOW_API_URL/outbound-messages"
```

Status `pending` wymaga `delivery_account_id` i pozwala workerowi rozpocząć
wysyłkę. Status `scheduled` wymaga dodatkowo przyszłego `scheduled_at`.
Maksymalna liczba odbiorców jednego żądania wynosi 10 000. Kampania i
zdeduplikowana lista odbiorców są zapisywane przez jedno RPC w tej samej
transakcji. Błąd dowolnego odbiorcy wycofuje cały zapis.

## Limity i retry

Każdy klucz ma osobny limit od 1 do 5000 żądań na minutę. Licznik jest
zużywany atomowo w PostgreSQL, więc działa poprawnie również przy kilku
równoległych instancjach funkcji.

Odpowiedzi zawierają:

```http
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 1785171660
X-Request-Id: 27c55bf1-8b8b-45b0-b3dc-45ff552752ca
```

Po HTTP `429` klient powinien zaczekać do `X-RateLimit-Reset`, dodać losowy
jitter i ponowić żądanie. Automatyczne retry jest właściwe dla `429`, `502`,
`503` i `504`; nie należy automatycznie ponawiać pozostałych błędów `4xx`.

## Błędy

Każdy błąd ma stabilny kod i identyfikator żądania:

```json
{
  "ok": false,
  "error": {
    "code": "scope_missing",
    "message": "Klucz nie ma wymaganego zakresu messages:write."
  },
  "request_id": "58814b6a-8577-449a-8229-a06a645c3f5d"
}
```

Najważniejsze kody:

| HTTP | Kod | Znaczenie |
| --- | --- | --- |
| 400 | `invalid_json`, `no_changes` | błędne dane klienta |
| 401 | `invalid_api_key`, `expired_api_key` | klucz nie działa |
| 403 | `scope_missing`, `ip_not_allowed` | polityka blokuje operację |
| 404 | `not_found` | endpoint albo rekord nie istnieje |
| 413 | `payload_too_large` | body przekracza 1 MB |
| 429 | `rate_limit_exceeded` | limit minuty wyczerpany |
| 500 | `internal_server_error` | błąd serwera, podaj `request_id` obsłudze |

## Rotacja bez przestoju

Endpoint panelu wykonuje rotację atomowo z punktu widzenia operatora:

1. tworzy nowy losowy klucz z tymi samymi zakresami i limitami;
2. unieważnia poprzedni;
3. zwraca nowy sekret tylko raz;
4. zapisuje zdarzenie audytowe.

Ponieważ poprzedni klucz jest unieważniany natychmiast, dla integracji
krytycznej lepiej utworzyć drugi klucz ręcznie, wdrożyć go u klienta,
potwierdzić działanie i dopiero potem unieważnić stary.

## Obserwowalność

Panel pokazuje ostatnie żądania: metodę, ścieżkę, kod HTTP, czas, IP i
`request_id`. Każda operacja zapisu przez publiczne API trafia też do
`audit_events` z `actor_type = api`. Retencję logów konfiguruje procedura
`cleanup_api_history`.

Nie zapisujemy treści nagłówka `Authorization`, pełnego klucza ani body
wiadomości w logach API.
