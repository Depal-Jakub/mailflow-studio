import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  Inbox,
  KeyRound,
  LockKeyhole,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber } from "../lib/format";

type AccountMode = "inbound" | "outbound";

export function AccountsPage() {
  const { sources, addToast } = useAppState();
  const [mode, setMode] = useState<AccountMode>("inbound");
  const [modalOpen, setModalOpen] = useState(false);
  const [provider, setProvider] = useState("smtp");

  const mailSources = sources.filter((source) => source.type !== "scraper");

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon={RefreshCw}>Sprawdź kondycję</Button>
            <Button
              icon={Plus}
              onClick={() => setModalOpen(true)}
              variant="primary"
            >
              Dodaj konto
            </Button>
          </>
        }
        description="Skrzynki przychodzące, serwery SMTP, OAuth i limity dostawców."
        title="Skrzynki i SMTP"
      />

      <section className="account-health-strip">
        <div>
          <ShieldCheck size={19} />
          <span>
            <strong>Połączenia są bezpieczne</strong>
            <small>4 z 4 używają TLS lub OAuth 2.0</small>
          </span>
        </div>
        <div>
          <Inbox size={19} />
          <span>
            <strong>{formatNumber(398)} nowych</strong>
            <small>w ostatnich 24 godzinach</small>
          </span>
        </div>
        <div>
          <Send size={19} />
          <span>
            <strong>{formatNumber(1842)} wysłane</strong>
            <small>98,9% dostarczonych</small>
          </span>
        </div>
        <div>
          <KeyRound size={19} />
          <span>
            <strong>0 wygasających tokenów</strong>
            <small>najbliższy przegląd za 21 dni</small>
          </span>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="account-tabs">
          <button
            className={mode === "inbound" ? "is-active" : ""}
            onClick={() => setMode("inbound")}
            type="button"
          >
            <Inbox size={16} />
            Odbieranie wiadomości
            <span>{mailSources.length}</span>
          </button>
          <button
            className={mode === "outbound" ? "is-active" : ""}
            onClick={() => setMode("outbound")}
            type="button"
          >
            <Send size={16} />
            Wysyłka SMTP
            <span>3</span>
          </button>
        </div>

        <div className="table-wrap">
          {mode === "inbound" ? (
            <table className="data-table accounts-table">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Protokół</th>
                  <th>Zakres synchronizacji</th>
                  <th>Ostatnia synchronizacja</th>
                  <th>Pobrano</th>
                  <th>Kondycja</th>
                  <th>Aktywne</th>
                  <th aria-label="Akcje" />
                </tr>
              </thead>
              <tbody>
                {mailSources.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <div className="account-identity">
                        <span className={`source-glyph source-glyph--${source.type}`}>
                          {source.type === "gmail"
                            ? "G"
                            : source.type === "outlook"
                              ? "O"
                              : "IM"}
                        </span>
                        <span>
                          <strong>{source.name}</strong>
                          <small>{source.address}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge tone="neutral">
                        {source.type === "gmail"
                          ? "Gmail API"
                          : source.type === "outlook"
                            ? "Graph API"
                            : "IMAP/TLS"}
                      </Badge>
                    </td>
                    <td>{source.folders.join(", ")}</td>
                    <td>{formatDateTime(source.lastSyncAt)}</td>
                    <td>{formatNumber(source.total)}</td>
                    <td>
                      <Badge
                        dot
                        tone={source.status === "warning" ? "warning" : "success"}
                      >
                        {source.status === "warning"
                          ? "Wymaga uwagi"
                          : "Połączenie zdrowe"}
                      </Badge>
                    </td>
                    <td>
                      <Toggle
                        checked={source.status !== "paused"}
                        label={`Zmień status ${source.name}`}
                        onChange={() => undefined}
                      />
                    </td>
                    <td>
                      <button
                        aria-label={`Opcje ${source.name}`}
                        className="icon-button"
                        type="button"
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data-table accounts-table">
              <thead>
                <tr>
                  <th>Nadawca</th>
                  <th>Serwer</th>
                  <th>Uwierzytelnienie</th>
                  <th>Limit dzienny</th>
                  <th>Wykorzystanie</th>
                  <th>Skuteczność</th>
                  <th>Aktywne</th>
                  <th aria-label="Akcje" />
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    name: "Gmail Support",
                    email: "support@acme.pl",
                    server: "Gmail API",
                    auth: "OAuth 2.0",
                    limit: 2000,
                    used: 482,
                    rate: "99,4%",
                  },
                  {
                    name: "Sprzedaż SMTP",
                    email: "sales@acme.pl",
                    server: "smtp.office365.com:587",
                    auth: "OAuth 2.0",
                    limit: 10000,
                    used: 1136,
                    rate: "98,7%",
                  },
                  {
                    name: "Info transakcyjne",
                    email: "info@acme.pl",
                    server: "smtp.example.com:465",
                    auth: "Login + hasło aplikacji",
                    limit: 5000,
                    used: 224,
                    rate: "99,1%",
                  },
                ].map((account) => (
                  <tr key={account.email}>
                    <td>
                      <div className="account-identity">
                        <span className="source-glyph source-glyph--imap">
                          <Mail size={16} />
                        </span>
                        <span>
                          <strong>{account.name}</strong>
                          <small>{account.email}</small>
                        </span>
                      </div>
                    </td>
                    <td>{account.server}</td>
                    <td>
                      <Badge tone="success">
                        <LockKeyhole size={12} /> {account.auth}
                      </Badge>
                    </td>
                    <td>{formatNumber(account.limit)}</td>
                    <td>
                      <div className="usage-cell">
                        <span>
                          {formatNumber(account.used)} /{" "}
                          {formatNumber(account.limit)}
                        </span>
                        <div>
                          <span
                            style={{
                              width: `${(account.used / account.limit) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>{account.rate}</td>
                    <td>
                      <Toggle
                        checked
                        label={`Zmień status ${account.name}`}
                        onChange={() => undefined}
                      />
                    </td>
                    <td>
                      <button className="icon-button" type="button">
                        <MoreHorizontal size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Modal
        description="Dane dostępowe zostaną zaszyfrowane po stronie serwera. Nie trafią do przeglądarki."
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Anuluj</Button>
            <Button
              icon={TestTube2}
              onClick={() => {
                addToast({
                  title: "Test zakończony powodzeniem",
                  message: "Serwer przyjął uwierzytelnienie i połączenie TLS.",
                  tone: "success",
                });
              }}
            >
              Testuj połączenie
            </Button>
            <Button
              icon={CheckCircle2}
              onClick={() => setModalOpen(false)}
              variant="primary"
            >
              Zapisz konto
            </Button>
          </>
        }
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        size="lg"
        title="Dodaj konto pocztowe"
      >
        <div className="provider-selector">
          {[
            ["gmail", "Gmail / Workspace", "OAuth 2.0"],
            ["outlook", "Microsoft 365", "Graph API"],
            ["imap", "Dowolny IMAP", "IMAP + TLS"],
            ["smtp", "Serwer SMTP", "SMTP + TLS"],
          ].map(([key, label, caption]) => (
            <button
              className={provider === key ? "is-selected" : ""}
              key={key}
              onClick={() => setProvider(key)}
              type="button"
            >
              {key === "smtp" || key === "imap" ? (
                <Server size={19} />
              ) : (
                <Mail size={19} />
              )}
              <strong>{label}</strong>
              <span>{caption}</span>
            </button>
          ))}
        </div>

        {provider === "smtp" || provider === "imap" ? (
          <div className="form-grid form-grid--two">
            <FormField label="Nazwa konta">
              <input placeholder="np. Skrzynka transakcyjna" />
            </FormField>
            <FormField label="Adres e-mail">
              <input placeholder="powiadomienia@example.com" type="email" />
            </FormField>
            <FormField
              label={provider === "smtp" ? "Serwer SMTP" : "Serwer IMAP"}
            >
              <input
                placeholder={
                  provider === "smtp"
                    ? "smtp.example.com"
                    : "imap.example.com"
                }
              />
            </FormField>
            <FormField label="Port i szyfrowanie">
              <div className="field-row">
                <input
                  defaultValue={provider === "smtp" ? "587" : "993"}
                  type="number"
                />
                <select defaultValue="tls">
                  <option value="tls">TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </div>
            </FormField>
            <FormField label="Nazwa użytkownika">
              <input placeholder="powiadomienia@example.com" />
            </FormField>
            <FormField label="Hasło / hasło aplikacji">
              <input placeholder="••••••••••••••••" type="password" />
            </FormField>
            {provider === "smtp" ? (
              <>
                <FormField label="Nazwa nadawcy">
                  <input placeholder="Zespół obsługi" />
                </FormField>
                <FormField label="Limit dzienny">
                  <input defaultValue="2000" min="1" type="number" />
                </FormField>
              </>
            ) : null}
          </div>
        ) : (
          <div className="oauth-connect">
            <span>
              <ShieldCheck size={25} />
            </span>
            <div>
              <h3>Połącz przez bezpieczne OAuth</h3>
              <p>
                System poprosi wyłącznie o uprawnienia potrzebne do odbierania
                lub wysyłania wiadomości.
              </p>
              <Button icon={KeyRound} variant="primary">
                Rozpocznij autoryzację
              </Button>
            </div>
          </div>
        )}

        <div className="security-note">
          <LockKeyhole size={17} />
          <div>
            <strong>Bezpieczne przechowywanie sekretów</strong>
            <p>
              Hasła, refresh tokeny i klucze są szyfrowane kluczem aplikacji.
              Frontend otrzymuje wyłącznie maskowane metadane.
            </p>
          </div>
          <button aria-label="Skopiuj informację" className="icon-button" type="button">
            <Copy size={15} />
          </button>
        </div>
      </Modal>
    </>
  );
}
