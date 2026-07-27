# Wielofirmowość i role

## Model

- `auth.users` przechowuje jedną tożsamość użytkownika.
- `profiles` przechowuje profil wspólny dla tej tożsamości.
- `organizations` reprezentuje firmy lub niezależne przestrzenie robocze.
- `organization_members` łączy użytkownika z firmą i wskazuje `role_id`.
- `organization_roles` definiuje rolę i listę granularnych uprawnień.

Jedna osoba może należeć do wielu organizacji. Każde członkostwo ma niezależną
rolę i status. Zmiana firmy w górnym pasku zmienia zakres danych, ale nie sesję.

## Wbudowane role

- **Właściciel**: pełna administracja, organizacja i rozliczenia.
- **Administrator**: źródła, konta, użytkownicy, role i konfiguracja.
- **Operator**: reguły, klasyfikacja, automatyzacje, szablony i wysyłka.
- **Recenzent**: ręczna klasyfikacja i obsługa kolejki review.
- **Obserwator**: odczyt operacyjny bez zmian.

Administrator może utworzyć rolę niestandardową z dowolną kombinacją
uprawnień. Wbudowane role można konfigurować, ale nie usuwać.

## Izolacja danych

Każda tabela operacyjna zawiera `organization_id`. RLS sprawdza aktywne
członkostwo, a operacje zapisu dodatkowo rolę. Admin API powtarza tę kontrolę
przed użyciem klienta `service_role`, aby serwerowe obejście RLS nie omijało
autoryzacji użytkownika.

Sekrety konektorów znajdują się w schemacie `private`. Przeglądarka nigdy nie
ma dostępu do refresh tokenów, haseł ani kluczy API.

## Zaproszenia i odebranie dostępu

Zaproszenie ma organizację, rolę, termin ważności i jednorazowy hash tokenu.
Po zaakceptowaniu powstaje aktywne członkostwo. Zawieszenie członkostwa
natychmiast usuwa dostęp do danej firmy, nie wpływając na inne firmy tego
użytkownika.

## Audyt

Zmiany źródeł, reguł, ról, członkostw, szablonów i wysyłek zapisują zdarzenia
w `audit_events`. Rekord zawiera aktora, organizację, typ obiektu, identyfikator
i metadane zmiany.
