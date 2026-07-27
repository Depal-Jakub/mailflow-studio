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
- `create_task` - rzeczywiste zadanie w `workflow_tasks`;
- `notify_team` - powiadomienia członków organizacji, opcjonalnie wg roli;
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

## Kroki automatyzacji

Automatyzacje korzystają z obiektów `{"type": "...", "config": {...}}`.
Obsługiwane kroki:

- `set_category`, `set_score`, `add_score`, `add_tag`, `set_review`, `archive`;
- `send_webhook`, `forward_smtp`, `send_email`;
- `create_task`, `notify_team`;
- `delay` z `seconds` lub `minutes`;
- `stop`.

W tekstach konfiguracji można użyć zmiennych, np.
`{{message.subject}}`, `{{message.sender_email}}` oraz `{{input.case_id}}`.
Worker zapisuje wynik każdego kroku, po błędzie próbuje maksymalnie trzy razy
z backoffem, a `delay` zwalnia claim i wraca do kolejnego kroku po `resume_at`.
