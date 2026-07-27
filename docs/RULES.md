# Reguły klasyfikacji

Reguły są wykonywane od najwyższego priorytetu. Każda publikacja tworzy nową
wersję, więc wynik historycznej wiadomości można odtworzyć.

## Pola warunków

`sender`, `sender_domain`, `recipient`, `subject`, `body`, `attachment_name`,
`attachment_type`, `source`, `sentiment`, `url`, `size`.

## Operatory

`contains`, `not_contains`, `equals`, `not_equals`, `starts_with`, `ends_with`,
`matches`, `greater_than`, `less_than`, `exists`.

Regex ma limit 500 znaków. Treść testowana regexem jest ograniczona do 250 kB.

## Akcje

- `assign_category` - ID, slug albo nazwa kategorii;
- `add_score` - zmiana wyniku w zakresie 0-100;
- `add_tag` - jeden lub kilka tagów rozdzielonych przecinkiem;
- `set_review` - kolejka ręcznej oceny;
- `archive` - archiwizacja;
- `scrape_urls` - bezpieczna kolejka adresów znalezionych w treści;
- `forward_smtp` - kolejka przekazania na wskazany adres;
- `send_webhook` - podpisany webhook;
- `create_task` - zadanie dla adaptera integracyjnego;
- `stop_processing` - zatrzymanie niższych reguł.

## Przykład

```json
{
  "match_mode": "all",
  "conditions": [
    { "field": "sender_domain", "operator": "equals", "value": "partner.pl" },
    { "field": "subject", "operator": "contains", "value": "oferta" }
  ],
  "actions": [
    { "type": "assign_category", "value": "zapytania-ofertowe" },
    { "type": "add_score", "value": "30" },
    { "type": "send_webhook", "value": "https://crm.example.com/mailflow" }
  ]
}
```
