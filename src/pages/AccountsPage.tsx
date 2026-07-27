import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  Inbox,
  KeyRound,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  TestTube2,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Toggle";
import {
  deliveryAccountPayload,
  deliveryAccountToDraft,
  deliveryProviderInfo,
  draftToDeliveryAccount,
  emptyDeliveryAccountDraft,
  testDeliveryAccountLocally,
  validateDeliveryAccount,
  type AccountValidation,
  type DeliveryAccountDraft,
} from "../lib/deliveryAccounts";
import { useAppState } from "../lib/AppState";
import { formatDateTime, formatNumber } from "../lib/format";
import { api } from "../services/api";
import { demoMode } from "../services/supabase";
import type { DeliveryAccount, DeliveryProvider } from "../types";

type AccountMode = "inbound" | "outbound";

const fieldError = (message?: string) =>
  message ? <span className="field-error">{message}</span> : null;

export function AccountsPage() {
  const {
    sources,
    deliveryAccounts,
    activeOrganizationId,
    toggleSource,
    updateSource,
    addDeliveryAccount,
    updateDeliveryAccount,
    removeDeliveryAccount,
    addToast,
  } = useAppState();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AccountMode>("inbound");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] =
    useState<DeliveryAccount | null>(null);
  const [removeCandidate, setRemoveCandidate] =
    useState<DeliveryAccount | null>(null);
  const [draft, setDraft] = useState<DeliveryAccountDraft>(() =>
    emptyDeliveryAccountDraft("smtp"),
  );
  const [testResult, setTestResult] = useState<AccountValidation | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const mailSources = sources.filter((source) =>
    ["gmail", "outlook", "imap"].includes(source.type),
  );

  const openCreate = () => {
    setEditingAccount(null);
    setDraft(emptyDeliveryAccountDraft("smtp"));
    setTestResult(null);
    setModalOpen(true);
  };

  const openEdit = (account: DeliveryAccount) => {
    setEditingAccount(account);
    setDraft(deliveryAccountToDraft(account));
    setTestResult(null);
    setModalOpen(true);
  };

  const patchDraft = <K extends keyof DeliveryAccountDraft>(
    key: K,
    value: DeliveryAccountDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTestResult(null);
  };

  const changeProvider = (provider: DeliveryProvider) => {
    setDraft((current) => ({
      ...emptyDeliveryAccountDraft(provider),
      name: current.name,
      fromEmail: current.fromEmail,
      fromName: current.fromName,
      replyTo: current.replyTo,
    }));
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const result = demoMode
        ? await testDeliveryAccountLocally(draft, Boolean(editingAccount))
        : await api.post<AccountValidation>(
            "delivery-accounts/test",
            deliveryAccountPayload(draft),
            activeOrganizationId,
          );
      setTestResult(result);
      addToast({
        title: result.valid
          ? "Konto przeszło test"
          : "Konfiguracja wymaga poprawy",
        message: result.valid
          ? demoMode
            ? "Walidacja lokalna zakończona. Test dostawcy wykona backend po wdrożeniu."
            : "Dostawca potwierdził tożsamość nadawcy i dostęp do wysyłki."
          : "Popraw oznaczone pola.",
        tone: result.valid ? "success" : "warning",
      });
      return result;
    } catch (error) {
      const result: AccountValidation = {
        valid: false,
        errors: {},
        checks: [
          {
            label: "Połączenie z dostawcą",
            ok: false,
            detail:
              error instanceof Error ? error.message : "Test nie powiódł się.",
          },
        ],
      };
      setTestResult(result);
      addToast({
        title: "Test połączenia nie powiódł się",
        message: result.checks[0].detail,
        tone: "error",
      });
      return result;
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const validation = validateDeliveryAccount(draft, Boolean(editingAccount));
    if (!validation.valid) {
      setTestResult(validation);
      return;
    }
    setSaving(true);
    try {
      const tested = testResult?.valid ? testResult : await runTest();
      if (!tested.valid) return;
      if (demoMode) {
        const account = draftToDeliveryAccount(draft, activeOrganizationId);
        if (editingAccount) {
          updateDeliveryAccount(editingAccount.id, account);
        } else {
          addDeliveryAccount(account);
        }
      } else {
        const payload = deliveryAccountPayload(draft);
        const saved = editingAccount
          ? await api.patch<DeliveryAccount>(
              `delivery-accounts/${editingAccount.id}`,
              payload,
              activeOrganizationId,
            )
          : await api.post<DeliveryAccount>(
              "delivery-accounts",
              payload,
              activeOrganizationId,
            );
        if (editingAccount) {
          updateDeliveryAccount(editingAccount.id, saved);
        } else {
          addDeliveryAccount(saved);
        }
      }
      setModalOpen(false);
      addToast({
        title: editingAccount ? "Konto zaktualizowane" : "Konto jest aktywne",
        message: `${draft.name} może zostać użyte w wysyłkach.`,
        tone: "success",
      });
    } catch (error) {
      addToast({
        title: "Nie udało się zapisać konta",
        message:
          error instanceof Error ? error.message : "Wystąpił nieznany błąd.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const checkHealth = async () => {
    setCheckingHealth(true);
    for (const source of mailSources) {
      const result = demoMode
        ? {
            valid: Boolean(source.credentialsConfigured),
            errors: {} as Record<string, string>,
          }
        : await api.post<AccountValidation>(
            `sources/${source.id}/test`,
            {},
            activeOrganizationId,
          );
      updateSource(source.id, {
        status: result.valid ? "active" : "error",
        lastTestAt: new Date().toISOString(),
        lastError: result.valid
          ? null
          : result.errors.connection ?? "Test źródła nie powiódł się.",
      });
    }
    for (const account of deliveryAccounts) {
      const result = demoMode
        ? {
            valid: Boolean(account.credentialsConfigured),
            errors: {} as Record<string, string>,
          }
        : await api.post<AccountValidation>(
            `delivery-accounts/${account.id}/test`,
            {},
            activeOrganizationId,
          );
      updateDeliveryAccount(account.id, {
        status: result.valid ? "active" : "error",
        lastTestAt: new Date().toISOString(),
        lastError: result.valid
          ? null
          : result.errors.connection ?? "Test konta nie powiódł się.",
      });
    }
    setCheckingHealth(false);
    addToast({
      title: "Kontrola kondycji zakończona",
      message: `Sprawdzono ${mailSources.length + deliveryAccounts.length} połączeń.`,
      tone: "success",
    });
  };

  const errors = testResult?.errors ?? {};
  const activeConnections =
    mailSources.filter((source) => source.status === "active").length +
    deliveryAccounts.filter((account) => account.status === "active").length;

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button
              icon={RefreshCw}
              loading={checkingHealth}
              onClick={() => void checkHealth()}
            >
              Sprawdź kondycję
            </Button>
            <Button icon={Plus} onClick={openCreate} variant="primary">
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
            <strong>{activeConnections} aktywnych połączeń</strong>
            <small>TLS, OAuth lub szyfrowane API</small>
          </span>
        </div>
        <div>
          <Inbox size={19} />
          <span>
            <strong>
              {formatNumber(
                mailSources.reduce((sum, source) => sum + source.unread, 0),
              )}{" "}
              nowych
            </strong>
            <small>we wszystkich źródłach pocztowych</small>
          </span>
        </div>
        <div>
          <Send size={19} />
          <span>
            <strong>
              {formatNumber(
                deliveryAccounts.reduce(
                  (sum, account) => sum + account.sentToday,
                  0,
                ),
              )}{" "}
              wysłane
            </strong>
            <small>dzisiejsze wykorzystanie kont</small>
          </span>
        </div>
        <div>
          <KeyRound size={19} />
          <span>
            <strong>
              {
                [...mailSources, ...deliveryAccounts].filter(
                  (item) => !item.credentialsConfigured,
                ).length
              }{" "}
              niekompletnych
            </strong>
            <small>poświadczenia nigdy nie trafiają do frontendu</small>
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
            Wysyłka
            <span>{deliveryAccounts.length}</span>
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
                        <span
                          className={`source-glyph source-glyph--${source.type}`}
                        >
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
                        tone={
                          source.status === "active"
                            ? "success"
                            : source.status === "warning"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {source.status === "active"
                          ? "Połączenie zdrowe"
                          : source.status === "paused"
                            ? "Wstrzymane"
                            : "Wymaga uwagi"}
                      </Badge>
                    </td>
                    <td>
                      <Toggle
                        checked={source.status !== "paused"}
                        label={`Zmień status ${source.name}`}
                        onChange={() => toggleSource(source.id)}
                      />
                    </td>
                    <td>
                      <button
                        aria-label={`Konfiguruj ${source.name}`}
                        className="icon-button"
                        onClick={() => navigate("/sources")}
                        type="button"
                      >
                        <Settings2 size={17} />
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
                  <th>Dostawca</th>
                  <th>Uwierzytelnienie</th>
                  <th>Limit dzienny</th>
                  <th>Wykorzystanie</th>
                  <th>Skuteczność</th>
                  <th>Aktywne</th>
                  <th aria-label="Akcje" />
                </tr>
              </thead>
              <tbody>
                {deliveryAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="account-identity">
                        <span className="source-glyph source-glyph--imap">
                          <Mail size={16} />
                        </span>
                        <span>
                          <strong>{account.name}</strong>
                          <small>{account.fromEmail}</small>
                        </span>
                      </div>
                    </td>
                    <td>{account.serverLabel}</td>
                    <td>
                      <Badge
                        tone={
                          account.credentialsConfigured ? "success" : "warning"
                        }
                      >
                        <LockKeyhole size={12} />{" "}
                        {account.authenticationLabel}
                      </Badge>
                    </td>
                    <td>{formatNumber(account.dailyLimit)}</td>
                    <td>
                      <div className="usage-cell">
                        <span>
                          {formatNumber(account.sentToday)} /{" "}
                          {formatNumber(account.dailyLimit)}
                        </span>
                        <div>
                          <span
                            style={{
                              width: `${Math.min(
                                100,
                                (account.sentToday / account.dailyLimit) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>{account.deliveryRate.toFixed(1)}%</td>
                    <td>
                      <Toggle
                        checked={account.status !== "paused"}
                        label={`Zmień status ${account.name}`}
                        onChange={(checked) =>
                          updateDeliveryAccount(account.id, {
                            status: checked ? "active" : "paused",
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          aria-label={`Edytuj ${account.name}`}
                          className="icon-button"
                          onClick={() => openEdit(account)}
                          type="button"
                        >
                          <Settings2 size={17} />
                        </button>
                        <button
                          aria-label={`Usuń ${account.name}`}
                          className="icon-button"
                          onClick={() => setRemoveCandidate(account)}
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Modal
        description="Dane dostępowe zostaną zaszyfrowane po stronie serwera i nigdy nie wrócą do przeglądarki."
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Anuluj</Button>
            <Button
              icon={TestTube2}
              loading={testing}
              onClick={() => void runTest()}
            >
              Testuj połączenie
            </Button>
            <Button
              icon={CheckCircle2}
              loading={saving}
              onClick={() => void save()}
              variant="primary"
            >
              Zapisz konto
            </Button>
          </>
        }
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        size="xl"
        title={editingAccount ? "Edytuj konto wysyłkowe" : "Dodaj konto wysyłkowe"}
      >
        <div className="provider-selector provider-selector--six">
          {(
            Object.entries(deliveryProviderInfo) as Array<
              [
                DeliveryProvider,
                (typeof deliveryProviderInfo)[DeliveryProvider],
              ]
            >
          ).map(([key, info]) => (
            <button
              className={draft.provider === key ? "is-selected" : ""}
              key={key}
              onClick={() => changeProvider(key)}
              type="button"
            >
              {["smtp", "ses"].includes(key) ? (
                <Server size={19} />
              ) : (
                <Mail size={19} />
              )}
              <strong>{info.label}</strong>
              <span>{info.caption}</span>
            </button>
          ))}
        </div>

        <section className="wizard-section">
          <header>
            <div>
              <h3>Tożsamość nadawcy i limity</h3>
              <p>Limity są egzekwowane przed przejęciem odbiorców z kolejki.</p>
            </div>
          </header>
          <div className="form-grid form-grid--two">
            <FormField label="Nazwa konta">
              <input
                onChange={(event) => patchDraft("name", event.target.value)}
                placeholder="np. Skrzynka transakcyjna"
                value={draft.name}
              />
              {fieldError(errors.name)}
            </FormField>
            <FormField label="Adres nadawcy">
              <input
                onChange={(event) =>
                  patchDraft("fromEmail", event.target.value)
                }
                placeholder="powiadomienia@example.com"
                type="email"
                value={draft.fromEmail}
              />
              {fieldError(errors.fromEmail)}
            </FormField>
            <FormField label="Nazwa nadawcy">
              <input
                onChange={(event) =>
                  patchDraft("fromName", event.target.value)
                }
                placeholder="Zespół obsługi"
                value={draft.fromName}
              />
            </FormField>
            <FormField label="Reply-To">
              <input
                onChange={(event) =>
                  patchDraft("replyTo", event.target.value)
                }
                placeholder="odpowiedzi@example.com"
                type="email"
                value={draft.replyTo}
              />
              {fieldError(errors.replyTo)}
            </FormField>
            <FormField label="Powiązane źródło przychodzące">
              <select
                onChange={(event) =>
                  patchDraft("sourceConnectorId", event.target.value)
                }
                value={draft.sourceConnectorId}
              >
                <option value="">Brak powiązania</option>
                {mailSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {source.address}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Limit dzienny">
              <input
                min="1"
                onChange={(event) =>
                  patchDraft("dailyLimit", Number(event.target.value))
                }
                type="number"
                value={draft.dailyLimit}
              />
              {fieldError(errors.dailyLimit)}
            </FormField>
            <FormField label="Limit godzinowy">
              <input
                min="1"
                onChange={(event) =>
                  patchDraft("hourlyLimit", Number(event.target.value))
                }
                type="number"
                value={draft.hourlyLimit}
              />
              {fieldError(errors.hourlyLimit)}
            </FormField>
          </div>
        </section>

        <section className="wizard-section wizard-section--secure">
          <header>
            <span>
              <KeyRound size={18} />
            </span>
            <div>
              <h3>Poświadczenia {deliveryProviderInfo[draft.provider].label}</h3>
              <p>
                Przy edycji pozostaw sekret pusty, aby zachować zaszyfrowaną
                wartość.
              </p>
            </div>
          </header>

          {draft.provider === "smtp" ? (
            <div className="form-grid form-grid--two">
              <FormField label="Serwer SMTP">
                <input
                  onChange={(event) => patchDraft("host", event.target.value)}
                  placeholder="smtp.example.com"
                  value={draft.host}
                />
                {fieldError(errors.host)}
              </FormField>
              <FormField label="Port i szyfrowanie">
                <div className="field-row">
                  <input
                    max="65535"
                    min="1"
                    onChange={(event) =>
                      patchDraft("port", Number(event.target.value))
                    }
                    type="number"
                    value={draft.port}
                  />
                  <select
                    onChange={(event) =>
                      patchDraft("secure", event.target.value === "tls")
                    }
                    value={draft.secure ? "tls" : "starttls"}
                  >
                    <option value="tls">TLS / 465</option>
                    <option value="starttls">STARTTLS / 587</option>
                  </select>
                </div>
                {fieldError(errors.port)}
              </FormField>
              <FormField label="Nazwa użytkownika">
                <input
                  onChange={(event) =>
                    patchDraft("username", event.target.value)
                  }
                  value={draft.username}
                />
                {fieldError(errors.username)}
              </FormField>
              <FormField label="Hasło / hasło aplikacji">
                <input
                  onChange={(event) =>
                    patchDraft("password", event.target.value)
                  }
                  placeholder={
                    editingAccount ? "Pozostaw puste, aby zachować" : "••••••••"
                  }
                  type="password"
                  value={draft.password}
                />
                {fieldError(errors.password)}
              </FormField>
            </div>
          ) : null}

          {["gmail", "outlook"].includes(draft.provider) ? (
            <div className="form-grid form-grid--two">
              {draft.provider === "outlook" ? (
                <FormField label="Tenant ID">
                  <input
                    onChange={(event) =>
                      patchDraft("tenantId", event.target.value)
                    }
                    value={draft.tenantId}
                  />
                  {fieldError(errors.tenantId)}
                </FormField>
              ) : null}
              <FormField label="OAuth Client ID">
                <input
                  onChange={(event) =>
                    patchDraft("clientId", event.target.value)
                  }
                  value={draft.clientId}
                />
                {fieldError(errors.clientId)}
              </FormField>
              <FormField label="OAuth Client secret">
                <input
                  onChange={(event) =>
                    patchDraft("clientSecret", event.target.value)
                  }
                  placeholder={
                    editingAccount ? "Pozostaw puste, aby zachować" : "Sekret"
                  }
                  type="password"
                  value={draft.clientSecret}
                />
                {fieldError(errors.clientSecret)}
              </FormField>
              <FormField label="Refresh token z prawem wysyłki">
                <input
                  onChange={(event) =>
                    patchDraft("refreshToken", event.target.value)
                  }
                  placeholder={
                    editingAccount ? "Pozostaw puste, aby zachować" : "Refresh token"
                  }
                  type="password"
                  value={draft.refreshToken}
                />
                {fieldError(errors.refreshToken)}
              </FormField>
            </div>
          ) : null}

          {["resend", "sendgrid"].includes(draft.provider) ? (
            <FormField label="Klucz API">
              <input
                onChange={(event) => patchDraft("apiKey", event.target.value)}
                placeholder={
                  editingAccount ? "Pozostaw puste, aby zachować" : "Klucz API"
                }
                type="password"
                value={draft.apiKey}
              />
              {fieldError(errors.apiKey)}
            </FormField>
          ) : null}

          {draft.provider === "ses" ? (
            <div className="form-grid form-grid--two">
              <FormField label="AWS Access Key ID">
                <input
                  onChange={(event) => patchDraft("apiKey", event.target.value)}
                  type="password"
                  value={draft.apiKey}
                />
                {fieldError(errors.apiKey)}
              </FormField>
              <FormField label="AWS Secret Access Key">
                <input
                  onChange={(event) =>
                    patchDraft("clientSecret", event.target.value)
                  }
                  type="password"
                  value={draft.clientSecret}
                />
                {fieldError(errors.clientSecret)}
              </FormField>
              <FormField label="Region AWS">
                <input
                  onChange={(event) =>
                    patchDraft("region", event.target.value)
                  }
                  value={draft.region}
                />
                {fieldError(errors.region)}
              </FormField>
            </div>
          ) : null}
        </section>

        {testResult ? (
          <section
            className={`connection-test ${
              testResult.valid
                ? "connection-test--success"
                : "connection-test--error"
            }`}
          >
            <header>
              <CheckCircle2 size={19} />
              <div>
                <strong>
                  {testResult.valid
                    ? "Konfiguracja jest kompletna"
                    : "Test wykrył problemy"}
                </strong>
                <span>
                  {demoMode
                    ? "Walidacja lokalna."
                    : "Test wykonany po stronie serwera."}
                </span>
              </div>
            </header>
            <div>
              {testResult.checks.map((check) => (
                <p key={check.label}>
                  <CheckCircle2 size={15} />
                  <span>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </span>
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <div className="security-note">
          <LockKeyhole size={17} />
          <div>
            <strong>Bezpieczne przechowywanie sekretów</strong>
            <p>
              Hasła, refresh tokeny i klucze są szyfrowane AES-256-GCM.
              Frontend otrzymuje wyłącznie maskowane metadane.
            </p>
          </div>
          <button
            aria-label="Skopiuj opis bezpieczeństwa"
            className="icon-button"
            onClick={() =>
              void navigator.clipboard.writeText(
                "Sekrety są szyfrowane AES-256-GCM i niedostępne dla przeglądarki.",
              )
            }
            type="button"
          >
            <Copy size={15} />
          </button>
        </div>
      </Modal>

      <Modal
        description="Historia wysyłek pozostanie dostępna, ale konto nie będzie już używane przez kolejkę."
        footer={
          <>
            <Button onClick={() => setRemoveCandidate(null)}>Anuluj</Button>
            <Button
              icon={Trash2}
              onClick={() => {
                if (!removeCandidate) return;
                void (async () => {
                  if (!demoMode) {
                    await api.delete(
                      `delivery-accounts/${removeCandidate.id}`,
                      activeOrganizationId,
                    );
                  }
                  removeDeliveryAccount(removeCandidate.id);
                  setRemoveCandidate(null);
                  addToast({
                    title: "Konto usunięte",
                    message:
                      "Kolejne wysyłki wymagają wyboru innego nadawcy.",
                    tone: "warning",
                  });
                })();
              }}
              variant="danger"
            >
              Usuń konto
            </Button>
          </>
        }
        onClose={() => setRemoveCandidate(null)}
        open={Boolean(removeCandidate)}
        size="sm"
        title="Usunąć konto wysyłkowe?"
      >
        <p>
          Konto <strong>{removeCandidate?.name}</strong> zostanie odłączone od
          tej organizacji.
        </p>
      </Modal>
    </>
  );
}
