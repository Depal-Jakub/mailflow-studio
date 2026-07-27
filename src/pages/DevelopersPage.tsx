import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  BookOpen,
  Check,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  Gauge,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { cn } from "../lib/format";
import { api } from "../services/api";
import { demoMode } from "../services/supabase";
import type {
  ApiKeyRecord,
  ApiKeyScope,
  ApiRequestLog,
} from "../types";

const scopeOptions: Array<{
  value: Exclude<ApiKeyScope, "*">;
  label: string;
  description: string;
}> = [
  {
    value: "messages:read",
    label: "Wiadomości: odczyt",
    description: "Lista, szczegóły i paginacja wiadomości.",
  },
  {
    value: "messages:write",
    label: "Wiadomości: zapis",
    description: "Ingest i aktualizacja klasyfikacji.",
  },
  {
    value: "categories:read",
    label: "Kategorie: odczyt",
    description: "Lista kategorii organizacji.",
  },
  {
    value: "categories:write",
    label: "Kategorie: zapis",
    description: "Tworzenie, edycja i usuwanie kategorii.",
  },
  {
    value: "sources:read",
    label: "Źródła: odczyt",
    description: "Stan i konfiguracja publiczna źródeł.",
  },
  {
    value: "sources:sync",
    label: "Źródła: synchronizacja",
    description: "Ręczne uruchamianie bezpiecznej synchronizacji.",
  },
  {
    value: "templates:read",
    label: "Szablony: odczyt",
    description: "Odczyt aktywnych szablonów wiadomości.",
  },
  {
    value: "outbound:read",
    label: "Wysyłka: odczyt",
    description: "Historia i status kampanii wychodzących.",
  },
  {
    value: "outbound:write",
    label: "Wysyłka: zapis",
    description: "Tworzenie wersji roboczych i kolejek wysyłki.",
  },
  {
    value: "audit:read",
    label: "Audyt: odczyt",
    description: "Dziennik zdarzeń bez dostępu do sekretów.",
  },
];

interface KeyForm {
  name: string;
  scopes: ApiKeyScope[];
  rateLimit: number;
  allowedIps: string;
  expiry: "never" | "30" | "90" | "365";
}

const emptyForm = (): KeyForm => ({
  name: "",
  scopes: ["messages:read"],
  rateLimit: 120,
  allowedIps: "",
  expiry: "never",
});

const demoKeys: ApiKeyRecord[] = [
  {
    id: "demo-key-production",
    name: "Integracja CRM",
    prefix: "mfs_live_w8Q2Kd7F0p",
    scopes: ["messages:read", "messages:write", "categories:read"],
    status: "active",
    rate_limit_per_minute: 120,
    allowed_ips: [],
    expires_at: null,
    last_used_at: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    last_used_ip: "203.0.113.42",
    usage_count: 18429,
    created_by: "user-1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 42).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 42).toISOString(),
    revoked_at: null,
  },
  {
    id: "demo-key-bi",
    name: "Raporty zarządcze",
    prefix: "mfs_live_2Fe91aLs7N",
    scopes: ["messages:read", "outbound:read", "audit:read"],
    status: "active",
    rate_limit_per_minute: 60,
    allowed_ips: ["198.51.100.0/24"],
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 73).toISOString(),
    last_used_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    last_used_ip: "198.51.100.18",
    usage_count: 3207,
    created_by: "user-1",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 16).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 16).toISOString(),
    revoked_at: null,
  },
];

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Nigdy";

const expiryFromForm = (value: KeyForm["expiry"]) => {
  if (value === "never") return null;
  const expires = new Date();
  expires.setDate(expires.getDate() + Number(value));
  return expires.toISOString();
};

const ipsFromForm = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const demoSecret = () =>
  `mfs_live_${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)}`;

type ApiKeysResponse = {
  scopes: ApiKeyScope[];
  keys: ApiKeyRecord[];
};

type SecretResponse = {
  key: ApiKeyRecord;
  secret: string;
  warning: string;
};

type UsageResponse = {
  key: { id: string; name: string; key_prefix: string };
  logs: ApiRequestLog[];
};

export function DevelopersPage() {
  const { activeOrganizationId, addToast, can } = useAppState();
  const [keys, setKeys] = useState<ApiKeyRecord[]>(
    demoMode ? structuredClone(demoKeys) : [],
  );
  const [loading, setLoading] = useState(!demoMode);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<KeyForm>(emptyForm);
  const [secret, setSecret] = useState<SecretResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null);
  const [usageTarget, setUsageTarget] = useState<ApiKeyRecord | null>(null);
  const [usageLogs, setUsageLogs] = useState<ApiRequestLog[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [codeTab, setCodeTab] = useState<"curl" | "javascript" | "python">(
    "curl",
  );

  const canManage = can("api_keys.manage");
  const activeKeys = keys.filter((key) => key.status === "active");
  const calls = keys.reduce((sum, key) => sum + key.usage_count, 0);
  const lastUsed = keys
    .map((key) => key.last_used_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const loadKeys = async () => {
    if (demoMode) return;
    setLoading(true);
    try {
      const result = await api.get<ApiKeysResponse>(
        "api-keys",
        activeOrganizationId,
      );
      setKeys(result.keys);
    } catch (error) {
      addToast({
        title: "Nie udało się pobrać kluczy",
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (demoMode) return undefined;
    let current = true;
    void api
      .get<ApiKeysResponse>("api-keys", activeOrganizationId)
      .then((result) => {
        if (current) setKeys(result.keys);
      })
      .catch((error: unknown) => {
        if (!current) return;
        addToast({
          title: "Nie udało się pobrać kluczy",
          message: error instanceof Error ? error.message : "Spróbuj ponownie.",
          tone: "error",
        });
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [activeOrganizationId, addToast]);

  const sampleBase =
    typeof window === "undefined" ? "https://app.example.com" : window.location.origin;
  const codeSamples = useMemo(
    () => ({
      curl: `curl --request GET \\\n  --url '${sampleBase}/v1/messages?limit=25' \\\n  --header 'Authorization: Bearer $MAILFLOW_API_KEY'`,
      javascript: `const response = await fetch("${sampleBase}/v1/messages?limit=25", {\n  headers: {\n    Authorization: \`Bearer \${process.env.MAILFLOW_API_KEY}\`,\n  },\n});\n\nif (!response.ok) throw new Error(\`MailFlow API: \${response.status}\`);\nconst { data, meta } = await response.json();`,
      python: `import os\nimport requests\n\nresponse = requests.get(\n    "${sampleBase}/v1/messages",\n    params={"limit": 25},\n    headers={"Authorization": f"Bearer {os.environ['MAILFLOW_API_KEY']}"},\n    timeout=30,\n)\nresponse.raise_for_status()\nmessages = response.json()["data"]`,
    }),
    [sampleBase],
  );

  const toggleScope = (scope: ApiKeyScope) => {
    setForm((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((item) => item !== scope)
        : [...current.scopes, scope],
    }));
  };

  const createKey = async () => {
    if (!form.name.trim() || form.scopes.length === 0) {
      addToast({
        title: "Uzupełnij konfigurację",
        message: "Podaj nazwę i wybierz co najmniej jeden zakres.",
        tone: "warning",
      });
      return;
    }
    setSaving(true);
    try {
      let result: SecretResponse;
      if (demoMode) {
        const raw = demoSecret();
        const now = new Date().toISOString();
        const key: ApiKeyRecord = {
          id: crypto.randomUUID(),
          name: form.name.trim(),
          prefix: raw.slice(0, 19),
          scopes: form.scopes,
          status: "active",
          rate_limit_per_minute: form.rateLimit,
          allowed_ips: ipsFromForm(form.allowedIps),
          expires_at: expiryFromForm(form.expiry),
          last_used_at: null,
          last_used_ip: null,
          usage_count: 0,
          created_by: "user-1",
          created_at: now,
          updated_at: now,
          revoked_at: null,
        };
        result = {
          key,
          secret: raw,
          warning:
            "Pełna wartość klucza jest wyświetlana tylko raz. Zapisz ją w menedżerze sekretów.",
        };
      } else {
        result = await api.post<SecretResponse>(
          "api-keys",
          {
            name: form.name.trim(),
            scopes: form.scopes,
            rate_limit_per_minute: form.rateLimit,
            allowed_ips: ipsFromForm(form.allowedIps),
            expires_at: expiryFromForm(form.expiry),
          },
          activeOrganizationId,
        );
      }
      setKeys((current) => [result.key, ...current]);
      setCreateOpen(false);
      setForm(emptyForm());
      setSecret(result);
      addToast({
        title: "Klucz API utworzony",
        message: "Sekret jest widoczny tylko w otwartym teraz oknie.",
        tone: "success",
      });
    } catch (error) {
      addToast({
        title: "Nie udało się utworzyć klucza",
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const rotateKey = async (key: ApiKeyRecord) => {
    setSaving(true);
    try {
      let result: SecretResponse;
      if (demoMode) {
        const raw = demoSecret();
        const now = new Date().toISOString();
        result = {
          key: {
            ...key,
            id: crypto.randomUUID(),
            prefix: raw.slice(0, 19),
            usage_count: 0,
            last_used_at: null,
            last_used_ip: null,
            created_at: now,
            updated_at: now,
          },
          secret: raw,
          warning:
            "Poprzedni klucz został natychmiast unieważniony. Nowy sekret jest widoczny tylko raz.",
        };
      } else {
        result = await api.post<SecretResponse>(
          `api-keys/${key.id}/rotate`,
          {},
          activeOrganizationId,
        );
      }
      setKeys((current) =>
        current.map((item) =>
          item.id === key.id
            ? {
                ...item,
                status: "revoked" as const,
                revoked_at: new Date().toISOString(),
              }
            : item,
        ).concat(result.key),
      );
      setSecret(result);
    } catch (error) {
      addToast({
        title: "Rotacja nie powiodła się",
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const revokeKey = async () => {
    if (!revokeTarget) return;
    setSaving(true);
    try {
      const revoked = demoMode
        ? {
            ...revokeTarget,
            status: "revoked" as const,
            revoked_at: new Date().toISOString(),
          }
        : await api.delete<ApiKeyRecord>(
            `api-keys/${revokeTarget.id}`,
            activeOrganizationId,
          );
      setKeys((current) =>
        current.map((item) => (item.id === revoked.id ? revoked : item)),
      );
      setRevokeTarget(null);
      addToast({
        title: "Klucz unieważniony",
        message: "Wszystkie kolejne żądania tym kluczem zostaną odrzucone.",
        tone: "success",
      });
    } catch (error) {
      addToast({
        title: "Nie udało się unieważnić klucza",
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const openUsage = async (key: ApiKeyRecord) => {
    setUsageTarget(key);
    setUsageLoading(true);
    try {
      if (demoMode) {
        setUsageLogs(
          Array.from({ length: 6 }, (_, index) => ({
            id: `demo-log-${index}`,
            request_id: crypto.randomUUID(),
            method: index === 4 ? "POST" : "GET",
            path: index === 4 ? "/v1/messages" : "/v1/messages?limit=25",
            status_code: index === 5 ? 429 : index === 3 ? 201 : 200,
            duration_ms: 38 + index * 17,
            ip_address: key.last_used_ip,
            user_agent: "MailFlow SDK / demo",
            metadata: {},
            created_at: new Date(Date.now() - index * 1000 * 60 * 23).toISOString(),
          })),
        );
      } else {
        const result = await api.get<UsageResponse>(
          `api-keys/${key.id}/usage?limit=50`,
          activeOrganizationId,
        );
        setUsageLogs(result.logs);
      }
    } catch (error) {
      addToast({
        title: "Nie udało się pobrać użycia",
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    } finally {
      setUsageLoading(false);
    }
  };

  const copyValue = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <PageHeader
        actions={
          <>
            <a className="button button--secondary button--md" href="/api-docs.html">
              <BookOpen size={16} />
              Dokumentacja API
            </a>
            <Button
              disabled={!canManage}
              icon={Plus}
              onClick={() => setCreateOpen(true)}
              variant="primary"
            >
              Nowy klucz API
            </Button>
          </>
        }
        description="Bezpieczne klucze, zakresy dostępu, limity i obserwowalność integracji."
        title="API dla deweloperów"
      />

      <div className="developer-summary">
        <div>
          <KeyRound />
          <span>
            <small>Aktywne klucze</small>
            <strong>{activeKeys.length}</strong>
          </span>
        </div>
        <div>
          <Activity />
          <span>
            <small>Łączne wywołania</small>
            <strong>{calls.toLocaleString("pl-PL")}</strong>
          </span>
        </div>
        <div>
          <Clock3 />
          <span>
            <small>Ostatnie użycie</small>
            <strong>{lastUsed ? dateTime(lastUsed) : "Brak"}</strong>
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <small>Ochrona</small>
            <strong>SHA-256 + RBAC</strong>
          </span>
        </div>
      </div>

      <div className="developer-layout">
        <section className="workspace-panel api-key-workspace">
          <header className="workspace-panel__header">
            <div>
              <h2>Klucze organizacji</h2>
              <p>Pełne sekrety nie są przechowywane i nigdy nie wracają z API.</p>
            </div>
            <Button
              icon={RefreshCw}
              loading={loading}
              onClick={() => void loadKeys()}
              size="sm"
            >
              Odśwież
            </Button>
          </header>

          <div className="developer-key-list">
            {keys.map((key) => (
              <article className="developer-key" key={key.id}>
                <div className="developer-key__icon">
                  <LockKeyhole size={19} />
                </div>
                <div className="developer-key__identity">
                  <span>
                    <strong>{key.name}</strong>
                    <Badge
                      dot
                      tone={key.status === "active" ? "success" : "neutral"}
                    >
                      {key.status === "active" ? "Aktywny" : "Unieważniony"}
                    </Badge>
                  </span>
                  <code>{key.prefix}••••••••••••••••</code>
                  <small>
                    Utworzono {dateTime(key.created_at)} · {key.usage_count.toLocaleString("pl-PL")} wywołań
                  </small>
                </div>
                <div className="developer-key__scopes">
                  {key.scopes.slice(0, 3).map((scope) => (
                    <code key={scope}>{scope}</code>
                  ))}
                  {key.scopes.length > 3 ? (
                    <span>+{key.scopes.length - 3}</span>
                  ) : null}
                </div>
                <dl className="developer-key__meta">
                  <div>
                    <dt>Limit</dt>
                    <dd>{key.rate_limit_per_minute}/min</dd>
                  </div>
                  <div>
                    <dt>Ostatnio</dt>
                    <dd>{dateTime(key.last_used_at)}</dd>
                  </div>
                  <div>
                    <dt>Wygaśnięcie</dt>
                    <dd>{key.expires_at ? dateTime(key.expires_at) : "Bezterminowo"}</dd>
                  </div>
                </dl>
                <div className="developer-key__actions">
                  <Button icon={Eye} onClick={() => void openUsage(key)} size="sm">
                    Użycie
                  </Button>
                  {key.status === "active" && canManage ? (
                    <>
                      <Button
                        icon={RotateCw}
                        loading={saving}
                        onClick={() => void rotateKey(key)}
                        size="sm"
                      >
                        Rotuj
                      </Button>
                      <Button
                        icon={Ban}
                        onClick={() => setRevokeTarget(key)}
                        size="sm"
                        variant="ghost"
                      >
                        Unieważnij
                      </Button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            {!loading && keys.length === 0 ? (
              <div className="empty-state">
                <KeyRound size={28} />
                <strong>Brak kluczy API</strong>
                <span>Utwórz pierwszy klucz o minimalnym wymaganym zakresie.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="workspace-panel developer-quickstart">
          <header className="workspace-panel__header">
            <div>
              <h2>Szybki start</h2>
              <p>API v1, JSON i kursorowa paginacja.</p>
            </div>
            <TerminalSquare size={19} />
          </header>
          <div className="developer-quickstart__body">
            <div className="developer-api-status">
              <span>
                <span className="status-dot status-dot--active" />
                <strong>Publiczne API v1</strong>
              </span>
              <code>{sampleBase}/v1</code>
            </div>
            <div className="developer-code-tabs" role="tablist">
              {(["curl", "javascript", "python"] as const).map((tab) => (
                <button
                  className={cn(codeTab === tab && "is-active")}
                  key={tab}
                  onClick={() => setCodeTab(tab)}
                  role="tab"
                  type="button"
                >
                  {tab === "javascript" ? "JavaScript" : tab === "python" ? "Python" : "cURL"}
                </button>
              ))}
            </div>
            <div className="developer-code">
              <button
                aria-label="Kopiuj przykład"
                onClick={() => void copyValue(codeSamples[codeTab])}
                type="button"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              <pre><code>{codeSamples[codeTab]}</code></pre>
            </div>
            <div className="developer-doc-links">
              <a href="/api-docs.html">
                <BookOpen size={17} />
                <span>
                  <strong>Interaktywna dokumentacja</strong>
                  <small>Endpointy, parametry, odpowiedzi i modele danych.</small>
                </span>
                <ExternalLink size={14} />
              </a>
              <a href="/openapi.yaml">
                <Code2 size={17} />
                <span>
                  <strong>Specyfikacja OpenAPI 3.1</strong>
                  <small>Pełny kontrakt endpointów i schematów.</small>
                </span>
                <ExternalLink size={14} />
              </a>
              <a href="/postman_collection.json">
                <Gauge size={17} />
                <span>
                  <strong>Kolekcja Postman</strong>
                  <small>Gotowe żądania i zmienne środowiskowe.</small>
                </span>
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </aside>
      </div>

      <Modal
        description="Nadaj wyłącznie zakresy potrzebne konkretnej integracji."
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>Anuluj</Button>
            <Button
              icon={KeyRound}
              loading={saving}
              onClick={() => void createKey()}
              variant="primary"
            >
              Wygeneruj klucz
            </Button>
          </>
        }
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        size="lg"
        title="Nowy klucz API"
      >
        <div className="api-key-form">
          <div className="form-grid form-grid--two">
            <FormField label="Nazwa klucza">
              <input
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="np. Integracja CRM produkcja"
                value={form.name}
              />
            </FormField>
            <FormField label="Limit żądań na minutę">
              <input
                max="5000"
                min="1"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    rateLimit: Number(event.target.value),
                  }))
                }
                type="number"
                value={form.rateLimit}
              />
            </FormField>
            <FormField label="Wygaśnięcie">
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    expiry: event.target.value as KeyForm["expiry"],
                  }))
                }
                value={form.expiry}
              >
                <option value="never">Bezterminowo</option>
                <option value="30">Za 30 dni</option>
                <option value="90">Za 90 dni</option>
                <option value="365">Za 365 dni</option>
              </select>
            </FormField>
            <FormField
              hint="Puste pole zezwala ze wszystkich adresów."
              label="Allowlista IP / CIDR"
            >
              <input
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    allowedIps: event.target.value,
                  }))
                }
                placeholder="203.0.113.10, 198.51.100.0/24"
                value={form.allowedIps}
              />
            </FormField>
          </div>
          <div>
            <div className="api-key-form__heading">
              <span>
                <strong>Zakresy dostępu</strong>
                <small>Zasada najmniejszych uprawnień ogranicza ryzyko integracji.</small>
              </span>
              <button
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    scopes:
                      current.scopes.length === scopeOptions.length
                        ? []
                        : scopeOptions.map((scope) => scope.value),
                  }))
                }
                type="button"
              >
                {form.scopes.length === scopeOptions.length
                  ? "Wyczyść"
                  : "Zaznacz wszystkie"}
              </button>
            </div>
            <div className="api-scope-grid">
              {scopeOptions.map((scope) => (
                <label
                  className={cn(
                    form.scopes.includes(scope.value) && "is-selected",
                  )}
                  key={scope.value}
                >
                  <input
                    checked={form.scopes.includes(scope.value)}
                    onChange={() => toggleScope(scope.value)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{scope.label}</strong>
                    <small>{scope.description}</small>
                    <code>{scope.value}</code>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        description={secret?.warning}
        footer={
          <Button
            onClick={() => {
              setSecret(null);
              setCopied(false);
            }}
            variant="primary"
          >
            Zapisałem klucz bezpiecznie
          </Button>
        }
        onClose={() => {
          setSecret(null);
          setCopied(false);
        }}
        open={Boolean(secret)}
        size="md"
        title="Klucz został wygenerowany"
      >
        {secret ? (
          <div className="api-secret">
            <div className="api-secret__warning">
              <ShieldCheck size={21} />
              <span>
                <strong>To jedyny moment, w którym pokazujemy pełny sekret.</strong>
                <small>Po zamknięciu można jedynie obrócić klucz i utworzyć nowy.</small>
              </span>
            </div>
            <div className="api-secret__value">
              <code>{secret.secret}</code>
              <Button
                icon={copied ? Check : Clipboard}
                onClick={() => void copyValue(secret.secret)}
                size="sm"
              >
                {copied ? "Skopiowano" : "Kopiuj"}
              </Button>
            </div>
            <p>
              Dodaj sekret do menedżera haseł lub zmiennej środowiskowej
              <code> MAILFLOW_API_KEY</code>. Nie zapisuj go w repozytorium.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        description="Operacji nie można cofnąć. Integracje korzystające z tego klucza natychmiast utracą dostęp."
        footer={
          <>
            <Button onClick={() => setRevokeTarget(null)}>Anuluj</Button>
            <Button
              icon={Ban}
              loading={saving}
              onClick={() => void revokeKey()}
              variant="danger"
            >
              Unieważnij klucz
            </Button>
          </>
        }
        onClose={() => setRevokeTarget(null)}
        open={Boolean(revokeTarget)}
        size="sm"
        title={`Unieważnić „${revokeTarget?.name ?? ""}”?`}
      >
        <div className="destructive-confirmation">
          <Ban size={24} />
          <p>
            Klucz <code>{revokeTarget?.prefix}</code> przestanie autoryzować
            wszystkie żądania API.
          </p>
        </div>
      </Modal>

      <Modal
        description="Ostatnie żądania z kodem odpowiedzi, czasem i adresem IP."
        onClose={() => {
          setUsageTarget(null);
          setUsageLogs([]);
        }}
        open={Boolean(usageTarget)}
        size="lg"
        title={`Użycie klucza: ${usageTarget?.name ?? ""}`}
      >
        <div className="api-usage-table">
          <div className="api-usage-table__header">
            <span>Żądanie</span>
            <span>Status</span>
            <span>Czas</span>
            <span>IP</span>
            <span>Data</span>
          </div>
          {usageLoading ? (
            <div className="empty-state">
              <RefreshCw className="button__spinner" size={22} />
              <strong>Ładowanie użycia...</strong>
            </div>
          ) : (
            usageLogs.map((log) => (
              <div key={log.id}>
                <span>
                  <strong>{log.method}</strong>
                  <code>{log.path}</code>
                </span>
                <Badge
                  tone={
                    log.status_code >= 500
                      ? "danger"
                      : log.status_code >= 400
                        ? "warning"
                        : "success"
                  }
                >
                  {log.status_code}
                </Badge>
                <span>{log.duration_ms} ms</span>
                <code>{log.ip_address ?? "brak"}</code>
                <span>{dateTime(log.created_at)}</span>
              </div>
            ))
          )}
          {!usageLoading && usageLogs.length === 0 ? (
            <div className="empty-state">
              <Activity size={25} />
              <strong>Brak zarejestrowanych wywołań</strong>
              <span>Pierwsze żądanie pojawi się tutaj po autoryzacji kluczem.</span>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
