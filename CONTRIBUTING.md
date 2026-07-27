# Współpraca nad projektem

Repozytorium jest prywatne. Zmiany mogą przygotowywać wyłącznie osoby, którym
właściciel nadał dostęp.

## Przepływ pracy

1. Utwórz gałąź od aktualnego `main`.
2. Zachowaj granice organizacji i nie omijaj RLS ani kontroli uprawnień.
3. Dodaj test dla zmienianego kontraktu lub zachowania.
4. Uruchom `npm run check` oraz `npm audit --audit-level=high`.
5. Otwórz pull request z opisem ryzyka, migracji i sposobu weryfikacji.

Nazwy gałęzi:

```text
feat/krotki-opis
fix/krotki-opis
docs/krotki-opis
```

## Migracje

- migracje są wyłącznie narastające;
- nie edytuj migracji zastosowanej już w produkcji;
- każda tabela operacyjna musi zawierać `organization_id`;
- nowe tabele wymagają indeksów, RLS, grantów i opisu retencji;
- funkcja `security definer` musi ustawiać `search_path = ''`;
- przed PR uruchom `npm run check:migrations`.

## API

Zmiana publicznego API wymaga jednoczesnej aktualizacji:

- `netlify/functions/public-api.mjs`;
- `public/openapi.yaml`;
- `public/postman_collection.json`, gdy zmienia się żądanie;
- `docs/API.md`;
- testów backendu.

Nie zmieniaj znaczenia istniejących pól w obrębie tej samej wersji API.

## Sekrety i dane

Nie dodawaj do repozytorium tokenów OAuth, haseł, JWT, kluczy providerów,
zrzutów prawdziwych wiadomości ani danych osobowych. Używaj fikcyjnych domen
`example.com`, `example.net` i adresów z zakresów dokumentacyjnych IP.

Podejrzenie podatności zgłoś zgodnie z [SECURITY.md](SECURITY.md), a nie jako
publiczny issue.
