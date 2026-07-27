import { useState } from "react";
import {
  Bell,
  Braces,
  Building2,
  CheckCircle2,
  Database,
  KeyRound,
  LockKeyhole,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { cn } from "../lib/format";

const sections = [
  { key: "organization", label: "Organizacja", icon: Building2 },
  { key: "processing", label: "Przetwarzanie", icon: SlidersHorizontal },
  { key: "security", label: "Bezpieczeństwo", icon: ShieldCheck },
  { key: "notifications", label: "Powiadomienia", icon: Bell },
  { key: "api", label: "API i webhooki", icon: Braces },
  { key: "retention", label: "Dane i retencja", icon: Database },
] as const;

type SectionKey = (typeof sections)[number]["key"];

export function SettingsPage() {
  const { addToast } = useAppState();
  const [section, setSection] = useState<SectionKey>("organization");

  const save = () => {
    addToast({
      title: "Ustawienia zapisane",
      message: "Zmiany zostały zastosowane i dodane do dziennika audytu.",
      tone: "success",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Save} onClick={save} variant="primary">
            Zapisz zmiany
          </Button>
        }
        description="Konfiguracja organizacji, bezpieczeństwa, retencji oraz API."
        title="Ustawienia"
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sekcje ustawień">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={cn(section === item.key && "is-active")}
                key={item.key}
                onClick={() => setSection(item.key)}
                type="button"
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <section className="workspace-panel settings-content">
          {section === "organization" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Organizacja</h2>
                  <p>Nazwa, strefa czasowa i domyślne ustawienia przestrzeni.</p>
                </div>
              </div>
              <div className="settings-form">
                <div className="organization-logo">MF</div>
                <div className="form-grid form-grid--two">
                  <FormField label="Nazwa organizacji">
                    <input defaultValue="MailFlow Studio Demo" />
                  </FormField>
                  <FormField label="Identyfikator przestrzeni">
                    <input defaultValue="mailflow-demo" disabled />
                  </FormField>
                  <FormField label="Strefa czasowa">
                    <select defaultValue="Europe/Warsaw">
                      <option value="Europe/Warsaw">Europe/Warsaw (UTC+2)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </FormField>
                  <FormField label="Język">
                    <select defaultValue="pl">
                      <option value="pl">Polski</option>
                      <option value="en">English</option>
                    </select>
                  </FormField>
                </div>
              </div>
            </>
          ) : null}

          {section === "processing" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Przetwarzanie wiadomości</h2>
                  <p>Domyślne progi, kolejki i zachowanie silnika reguł.</p>
                </div>
              </div>
              <div className="settings-list">
                <div>
                  <span>
                    <strong>Automatyczna klasyfikacja</strong>
                    <small>Uruchamiaj aktywne reguły po odebraniu wiadomości.</small>
                  </span>
                  <Toggle checked label="Automatyczna klasyfikacja" onChange={() => undefined} />
                </div>
                <div>
                  <span>
                    <strong>Wstrzymaj akcje przy niepewnym wyniku</strong>
                    <small>Wynik niższy od progu trafia do ręcznej weryfikacji.</small>
                  </span>
                  <Toggle checked label="Wstrzymuj niepewne akcje" onChange={() => undefined} />
                </div>
                <div>
                  <span>
                    <strong>Analiza załączników</strong>
                    <small>Ekstrakcja PDF, DOCX, XLSX i OCR obrazów.</small>
                  </span>
                  <Toggle checked label="Analizuj załączniki" onChange={() => undefined} />
                </div>
              </div>
              <div className="form-grid form-grid--two settings-grid">
                <FormField label="Próg automatycznej akcji">
                  <input defaultValue="80" max="100" min="0" type="number" />
                </FormField>
                <FormField label="Maksymalna liczba prób">
                  <input defaultValue="3" max="10" min="0" type="number" />
                </FormField>
                <FormField label="Timeout pojedynczego zadania">
                  <select defaultValue="90">
                    <option value="30">30 sekund</option>
                    <option value="60">60 sekund</option>
                    <option value="90">90 sekund</option>
                    <option value="180">180 sekund</option>
                  </select>
                </FormField>
                <FormField label="Limit równoległych procesów">
                  <input defaultValue="10" max="100" min="1" type="number" />
                </FormField>
              </div>
            </>
          ) : null}

          {section === "security" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Bezpieczeństwo</h2>
                  <p>Logowanie, sesje, MFA i szyfrowanie sekretów.</p>
                </div>
              </div>
              <div className="security-overview">
                <div>
                  <ShieldCheck size={22} />
                  <span>
                    <strong>Stan zabezpieczeń: wysoki</strong>
                    <small>Wszystkie krytyczne mechanizmy są aktywne.</small>
                  </span>
                  <CheckCircle2 size={18} />
                </div>
              </div>
              <div className="settings-list">
                <div>
                  <span>
                    <strong>Wymagaj 2FA od administratorów</strong>
                    <small>Brak 2FA zablokuje dostęp do ustawień i kont SMTP.</small>
                  </span>
                  <Toggle checked label="Wymagaj 2FA" onChange={() => undefined} />
                </div>
                <div>
                  <span>
                    <strong>Automatyczne wygaszanie sesji</strong>
                    <small>Wyloguj po 8 godzinach lub 30 minutach bezczynności.</small>
                  </span>
                  <Toggle checked label="Wygaszanie sesji" onChange={() => undefined} />
                </div>
                <div>
                  <span>
                    <strong>Ograniczenie dozwolonych domen</strong>
                    <small>Zaproszenia tylko dla wskazanych domen firmowych.</small>
                  </span>
                  <Toggle label="Ogranicz domeny" onChange={() => undefined} checked={false} />
                </div>
              </div>
              <div className="form-grid form-grid--two settings-grid">
                <FormField label="Czas sesji">
                  <select defaultValue="8h">
                    <option value="4h">4 godziny</option>
                    <option value="8h">8 godzin</option>
                    <option value="24h">24 godziny</option>
                  </select>
                </FormField>
                <FormField label="Rotacja kluczy sekretów">
                  <select defaultValue="90">
                    <option value="30">Co 30 dni</option>
                    <option value="90">Co 90 dni</option>
                    <option value="manual">Ręcznie</option>
                  </select>
                </FormField>
              </div>
            </>
          ) : null}

          {section === "notifications" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Powiadomienia</h2>
                  <p>Wybierz zdarzenia i kanały kontaktu z zespołem.</p>
                </div>
              </div>
              <div className="notification-table">
                <div className="notification-table__header">
                  <span>Zdarzenie</span>
                  <span>E-mail</span>
                  <span>Panel</span>
                  <span>Webhook</span>
                </div>
                {[
                  "Błąd synchronizacji skrzynki",
                  "Automatyzacja zakończona błędem",
                  "Wiadomość z wynikiem >= 90",
                  "Nowe zadanie do weryfikacji",
                  "Limit wysyłki przekroczony w 80%",
                ].map((label, index) => (
                  <div key={label}>
                    <strong>{label}</strong>
                    <Toggle checked label={`${label} e-mail`} onChange={() => undefined} />
                    <Toggle checked label={`${label} panel`} onChange={() => undefined} />
                    <Toggle
                      checked={index < 2}
                      label={`${label} webhook`}
                      onChange={() => undefined}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {section === "api" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>API i webhooki</h2>
                  <p>Klucze programistyczne, podpisy oraz adresy callback.</p>
                </div>
                <Button icon={KeyRound}>Nowy klucz API</Button>
              </div>
              <div className="api-key-list">
                {[
                  ["Produkcja - ingest", "mf_live_••••••••••••A4F2", "ingest:write"],
                  ["Raporty BI", "mf_live_••••••••••••91C8", "reports:read"],
                ].map(([name, key, scope]) => (
                  <div key={name}>
                    <LockKeyhole size={18} />
                    <span>
                      <strong>{name}</strong>
                      <code>{key}</code>
                    </span>
                    <small>{scope}</small>
                    <Button size="sm">Rotuj</Button>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {section === "retention" ? (
            <>
              <div className="workspace-panel__header">
                <div>
                  <h2>Dane i retencja</h2>
                  <p>Okres przechowywania wiadomości i polityka usuwania danych.</p>
                </div>
              </div>
              <div className="form-grid form-grid--two settings-grid">
                <FormField label="Treść wiadomości">
                  <select defaultValue="365">
                    <option value="90">90 dni</option>
                    <option value="180">180 dni</option>
                    <option value="365">365 dni</option>
                    <option value="forever">Bezterminowo</option>
                  </select>
                </FormField>
                <FormField label="Załączniki">
                  <select defaultValue="180">
                    <option value="30">30 dni</option>
                    <option value="90">90 dni</option>
                    <option value="180">180 dni</option>
                  </select>
                </FormField>
                <FormField label="Dziennik audytu">
                  <select defaultValue="365">
                    <option value="365">365 dni</option>
                    <option value="730">730 dni</option>
                    <option value="forever">Bezterminowo</option>
                  </select>
                </FormField>
                <FormField label="Dane analityczne">
                  <select defaultValue="730">
                    <option value="365">365 dni</option>
                    <option value="730">730 dni</option>
                    <option value="forever">Bezterminowo</option>
                  </select>
                </FormField>
              </div>
              <div className="retention-note">
                <Database size={18} />
                <span>
                  <strong>Anonimizacja przed usunięciem</strong>
                  <small>
                    Agregaty raportowe zostaną zachowane bez danych osobowych i
                    treści wiadomości.
                  </small>
                </span>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

