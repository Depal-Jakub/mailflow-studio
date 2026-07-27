# Polityka bezpieczeństwa

## Zgłaszanie podatności

Nie publikuj informacji o podatności w issue ani dyskusji. Użyj prywatnego
zgłoszenia **Security → Report a vulnerability** w GitHubie tego repozytorium
albo skontaktuj się bezpośrednio z właścicielem projektu.

Zgłoszenie powinno zawierać:

- dotkniętą wersję i środowisko;
- możliwie krótki scenariusz odtworzenia;
- wpływ na poufność, integralność lub dostępność;
- informację, czy ujawniono prawdziwy sekret lub dane użytkownika;
- proponowane ograniczenie ryzyka, jeżeli jest znane.

Nie testuj podatności na danych ani kontach innych organizacji. Nie wykonuj
masowej wysyłki, eksfiltracji, ataków dostępności ani trwałej modyfikacji
danych.

## Obsługiwane wersje

| Wersja | Wsparcie bezpieczeństwa |
| --- | --- |
| najnowsza `0.x` | tak |
| starsze wersje `0.x` | nie |

## Ujawniony sekret

Sekret uznaje się za ujawniony także po usunięciu go z commita. Należy go
natychmiast unieważnić lub zrotować, sprawdzić logi użycia i dopiero potem
usunąć z historii. Sam force-push nie przywraca bezpieczeństwa klucza.

Techniczne zasady ochrony aplikacji opisuje
[docs/SECURITY.md](docs/SECURITY.md).
