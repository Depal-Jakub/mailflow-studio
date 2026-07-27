import { useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Code2,
  Copy,
  Edit3,
  Eye,
  FileText,
  LayoutTemplate,
  MailCheck,
  MousePointerClick,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import {
  emailPreviewDocument,
  extractVariables,
  htmlToText,
  sanitizeEmailHtml,
} from "../lib/emailTemplates";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";
import type {
  EmailTemplate,
  OutboundCampaign,
  TemplateKind,
} from "../types";

const campaignStatus = {
  draft: { label: "Wersja robocza", tone: "neutral" },
  scheduled: { label: "Zaplanowana", tone: "info" },
  sending: { label: "Wysyłanie", tone: "warning" },
  sent: { label: "Wysłana", tone: "success" },
  failed: { label: "Błąd", tone: "danger" },
} as const;

const emptyHtml =
  "<h2>Dzień dobry,</h2><p>Wpisz treść wiadomości.</p><p><a class=\"email-cta\" href=\"{{action.url}}\">Otwórz szczegóły</a></p>";

interface ComposerDraft {
  accountId: string;
  mode: "now" | "schedule" | "draft";
  scheduledAt: string;
  audienceType: "category" | "manual" | "all";
  categoryId: string;
  recipients: string;
  subject: string;
  templateId: string;
  htmlBody: string;
  includeUnsubscribe: boolean;
  trackDelivery: boolean;
  includeOriginal: boolean;
}

const blankTemplate = (organizationId: string): EmailTemplate => ({
  id: `template-${crypto.randomUUID()}`,
  organizationId,
  name: "Nowy szablon",
  description: "Własny szablon wiadomości.",
  kind: "notification",
  subject: "Temat wiadomości",
  textBody: "Dzień dobry,\n\nTreść wiadomości.",
  htmlBody: emptyHtml,
  variables: ["action.url"],
  active: true,
  version: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: "Jakub Kowalski",
});

export function SendPage() {
  const {
    campaigns,
    categories,
    messages,
    deliveryAccounts,
    templates,
    activeOrganizationId,
    addCampaign,
    addTemplate,
    updateTemplate,
    removeTemplate,
    addToast,
  } = useAppState();
  const editorRef = useRef<HTMLDivElement>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<
    "editor" | "preview" | "html"
  >("editor");
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [selectedTemplateDraft, setSelectedTemplateDraft] =
    useState<EmailTemplate | null>(null);
  const [campaignPreview, setCampaignPreview] =
    useState<OutboundCampaign | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [minimumScheduleAt] = useState(() =>
    new Date(Date.now() + 60_000).toISOString().slice(0, 16),
  );
  const [draft, setDraft] = useState<ComposerDraft>(() => {
    const template = templates[0];
    return {
      accountId: deliveryAccounts[0]?.id ?? "",
      mode: "now",
      scheduledAt: "",
      audienceType: "category",
      categoryId: categories[0]?.id ?? "",
      recipients: "",
      subject: template?.subject ?? "Ważna informacja",
      templateId: template?.id ?? "",
      htmlBody: template?.htmlBody ?? emptyHtml,
      includeUnsubscribe: true,
      trackDelivery: true,
      includeOriginal: false,
    };
  });

  const filteredCampaigns = useMemo(() => {
    const normalized = search.toLocaleLowerCase("pl").trim();
    return campaigns.filter((campaign) => {
      if (statusFilter !== "all" && campaign.status !== statusFilter) {
        return false;
      }
      return [campaign.subject, campaign.sender, campaign.audience]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized);
    });
  }, [campaigns, search, statusFilter]);

  const totalRecipients = campaigns.reduce(
    (sum, campaign) => sum + campaign.recipients,
    0,
  );
  const totalDelivered = campaigns.reduce(
    (sum, campaign) => sum + campaign.delivered,
    0,
  );
  const totalOpened = campaigns.reduce(
    (sum, campaign) => sum + campaign.opened,
    0,
  );
  const selectedAccount =
    deliveryAccounts.find((account) => account.id === draft.accountId) ??
    deliveryAccounts[0];
  const selectedCategory = categories.find(
    (category) => category.id === draft.categoryId,
  );
  const previewDocument = emailPreviewDocument({
    html: draft.htmlBody,
    subject: draft.subject,
    senderName: selectedAccount?.fromName ?? "MailFlow Studio",
    senderEmail: selectedAccount?.fromEmail ?? "brak-konta@example.com",
  });

  const resolvedRecipients = useMemo(() => {
    const unique = new Map<
      string,
      { email: string; name?: string | null }
    >();
    if (draft.audienceType === "manual") {
      draft.recipients
        .split(/[,\n;]/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        .forEach((email) => unique.set(email, { email }));
      return [...unique.values()];
    }
    messages
      .filter(
        (message) =>
          message.direction === "incoming" &&
          (draft.audienceType === "all" ||
            message.categoryId === draft.categoryId),
      )
      .forEach((message) => {
        const email = message.sender.trim().toLowerCase();
        if (
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
          email !== selectedAccount?.fromEmail.toLowerCase()
        ) {
          unique.set(email, {
            email,
            name: message.senderName || null,
          });
        }
      });
    return [...unique.values()];
  }, [
    draft.audienceType,
    draft.categoryId,
    draft.recipients,
    messages,
    selectedAccount?.fromEmail,
  ]);

  const openComposer = () => {
    const template = templates[0];
    setDraft({
      accountId: deliveryAccounts[0]?.id ?? "",
      mode: "now",
      scheduledAt: "",
      audienceType: categories.length ? "category" : "manual",
      categoryId: categories[0]?.id ?? "",
      recipients: "",
      subject: template?.subject ?? "Ważna informacja",
      templateId: template?.id ?? "",
      htmlBody: template?.htmlBody ?? emptyHtml,
      includeUnsubscribe: true,
      trackDelivery: true,
      includeOriginal: false,
    });
    setComposerMode("editor");
    setComposerOpen(true);
  };

  const selectTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    setDraft((current) => ({
      ...current,
      templateId,
      subject: template?.subject ?? current.subject,
      htmlBody: template?.htmlBody ?? current.htmlBody,
    }));
  };

  const command = (name: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(name, false, value);
    setDraft((current) => ({
      ...current,
      htmlBody: sanitizeEmailHtml(editorRef.current?.innerHTML ?? current.htmlBody),
    }));
  };

  const recipientCount = () => {
    return resolvedRecipients.length;
  };

  const saveCampaign = (forceDraft = false) => {
    if (!draft.subject.trim()) {
      addToast({
        title: "Brakuje tematu",
        message: "Podaj temat wiadomości przed zapisaniem.",
        tone: "warning",
      });
      return;
    }
    if (!selectedAccount) {
      addToast({
        title: "Brakuje konta wysyłkowego",
        message: "Najpierw skonfiguruj aktywne konto w module Skrzynki i SMTP.",
        tone: "warning",
      });
      return;
    }
    if (
      draft.mode === "schedule" &&
      !forceDraft &&
      (!draft.scheduledAt ||
        new Date(draft.scheduledAt).getTime() <= Date.now())
    ) {
      addToast({
        title: "Nieprawidłowy termin",
        message: "Wybierz przyszłą datę i godzinę wysyłki.",
        tone: "warning",
      });
      return;
    }
    const count = recipientCount();
    if (count === 0 && !forceDraft) {
      addToast({
        title: "Brakuje odbiorców",
        message: "Wybierz kategorię, segment lub wpisz adresy ręcznie.",
        tone: "warning",
      });
      return;
    }

    const status: OutboundCampaign["status"] = forceDraft
      ? "draft"
      : draft.mode === "schedule"
        ? "scheduled"
        : draft.mode === "draft"
          ? "draft"
          : "sending";
    const audience =
      draft.audienceType === "category"
        ? `Kategoria: ${selectedCategory?.name ?? "bez kategorii"}`
        : draft.audienceType === "all"
          ? "Wszyscy aktywni odbiorcy"
          : `${count} adresów ręcznych`;

    addCampaign({
      id: `send-${crypto.randomUUID()}`,
      organizationId: activeOrganizationId,
      subject: draft.subject.trim(),
      sender: selectedAccount.fromEmail,
      audience,
      status,
      recipients: count,
      delivered: 0,
      opened: 0,
      createdAt: new Date().toISOString(),
      templateId: draft.templateId || null,
      deliveryAccountId: selectedAccount.id,
      scheduledAt:
        status === "scheduled"
          ? new Date(draft.scheduledAt).toISOString()
          : null,
      textBody: htmlToText(draft.htmlBody),
      htmlBody: sanitizeEmailHtml(draft.htmlBody),
      recipientList: resolvedRecipients,
    });
    setComposerOpen(false);
    addToast({
      title:
        status === "draft"
          ? "Wersja robocza zapisana"
          : status === "scheduled"
            ? "Wysyłka zaplanowana"
            : "Wiadomość dodana do kolejki",
      message:
        status === "scheduled"
          ? `Start: ${formatDateTime(new Date(draft.scheduledAt).toISOString())}.`
          : `${count} odbiorców przejdzie kontrolę limitów i duplikatów.`,
      tone: "success",
    });
  };

  const openTemplateManager = () => {
    setSelectedTemplateDraft(
      structuredClone(
        templates.find((template) => template.id === draft.templateId) ??
          templates[0] ??
          blankTemplate(activeOrganizationId),
      ),
    );
    setTemplateManagerOpen(true);
  };

  const saveTemplate = () => {
    if (!selectedTemplateDraft) return;
    const normalized: EmailTemplate = {
      ...selectedTemplateDraft,
      variables: extractVariables(
        selectedTemplateDraft.subject,
        selectedTemplateDraft.textBody,
        selectedTemplateDraft.htmlBody,
      ),
      updatedAt: new Date().toISOString(),
    };
    const exists = templates.some((template) => template.id === normalized.id);
    if (exists) updateTemplate(normalized.id, normalized);
    else addTemplate(normalized);
    selectTemplate(normalized.id);
    setSelectedTemplateDraft(normalized);
    addToast({
      title: "Szablon zapisany",
      message: `${normalized.name} jest dostępny w edytorze wiadomości.`,
      tone: "success",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Plus} onClick={openComposer} variant="primary">
            Nowa wiadomość
          </Button>
        }
        description="Ręczne wiadomości, szablony, kolejki oraz historia wysyłek SMTP."
        title="Wysyłka"
      />

      <section className="summary-strip">
        <div>
          <Send size={18} />
          <span>Wysłano</span>
          <strong>{formatNumber(totalRecipients)}</strong>
        </div>
        <div>
          <MailCheck size={18} />
          <span>Dostarczono</span>
          <strong>{formatNumber(totalDelivered)}</strong>
        </div>
        <div>
          <MousePointerClick size={18} />
          <span>Otwarto</span>
          <strong>{formatNumber(totalOpened)}</strong>
        </div>
        <div>
          <CheckCircle2 size={18} />
          <span>Skuteczność</span>
          <strong>
            {formatPercent(
              totalRecipients ? (totalDelivered / totalRecipients) * 100 : 0,
            )}
            %
          </strong>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel__header">
          <div>
            <h2>Historia wysyłek</h2>
            <p>Wiadomości ręczne, automatyczne i zaplanowane kampanie.</p>
          </div>
          <div className="workspace-panel__tools">
            <label className="search-field search-field--compact">
              <Search size={15} />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj wysyłki..."
                value={search}
              />
            </label>
            <select
              aria-label="Status wysyłki"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="all">Wszystkie statusy</option>
              <option value="draft">Wersje robocze</option>
              <option value="scheduled">Zaplanowane</option>
              <option value="sending">W kolejce</option>
              <option value="sent">Wysłane</option>
              <option value="failed">Błędy</option>
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table campaign-table">
            <thead>
              <tr>
                <th>Temat</th>
                <th>Nadawca</th>
                <th>Odbiorcy</th>
                <th>Status</th>
                <th>Adresaci</th>
                <th>Dostarczono</th>
                <th>Otwarto</th>
                <th>Utworzono</th>
                <th aria-label="Akcje" />
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((campaign) => {
                const status = campaignStatus[campaign.status];
                return (
                  <tr key={campaign.id}>
                    <td>
                      <strong className="cell-primary">{campaign.subject}</strong>
                      <span className="cell-secondary">ID: {campaign.id}</span>
                    </td>
                    <td>{campaign.sender}</td>
                    <td>{campaign.audience}</td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td>{formatNumber(campaign.recipients)}</td>
                    <td>{formatNumber(campaign.delivered)}</td>
                    <td>{formatNumber(campaign.opened)}</td>
                    <td>{formatDateTime(campaign.createdAt)}</td>
                    <td>
                      <button
                        aria-label={`Podgląd ${campaign.subject}`}
                        className="icon-button"
                        onClick={() => setCampaignPreview(campaign)}
                        type="button"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        description="Wybierz odbiorców, zbuduj treść i sprawdź dokładny podgląd przed wysłaniem."
        footer={
          <>
            <Button icon={Save} onClick={() => saveCampaign(true)}>
              Zapisz wersję roboczą
            </Button>
            <Button
              icon={draft.mode === "schedule" ? CalendarClock : Send}
              onClick={() => saveCampaign(false)}
              variant="primary"
            >
              {draft.mode === "schedule"
                ? "Zaplanuj wysyłkę"
                : draft.mode === "draft"
                  ? "Zapisz"
                  : "Wyślij wiadomość"}
            </Button>
          </>
        }
        onClose={() => setComposerOpen(false)}
        open={composerOpen}
        size="xl"
        title="Nowa wiadomość"
      >
        <div className="composer-shell">
          <div className="composer-config">
            <div className="form-grid form-grid--two">
              <FormField label="Konto wysyłkowe">
                <select
                  disabled={!deliveryAccounts.length}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      accountId: event.target.value,
                    }))
                  }
                  value={draft.accountId}
                >
                  {!deliveryAccounts.length ? (
                    <option value="">Najpierw dodaj konto wysyłkowe</option>
                  ) : null}
                  {deliveryAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.fromEmail}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Tryb wysyłki">
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      mode: event.target.value as ComposerDraft["mode"],
                    }))
                  }
                  value={draft.mode}
                >
                  <option value="now">Wyślij po zatwierdzeniu</option>
                  <option value="schedule">Zaplanuj termin</option>
                  <option value="draft">Tylko wersja robocza</option>
                </select>
              </FormField>
              {draft.mode === "schedule" ? (
                <FormField label="Data i godzina wysyłki">
                  <input
                    min={minimumScheduleAt}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scheduledAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={draft.scheduledAt}
                  />
                </FormField>
              ) : null}
            </div>

            <div className="audience-builder">
              <FormField label="Typ odbiorców">
                <select
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      audienceType: event.target
                        .value as ComposerDraft["audienceType"],
                    }))
                  }
                  value={draft.audienceType}
                >
                  <option value="category">Kategoria wiadomości</option>
                  <option value="manual">Adresy ręczne</option>
                  <option value="all">Wszyscy aktywni odbiorcy</option>
                </select>
              </FormField>
              {draft.audienceType === "category" ? (
                <FormField label="Kategoria / segment">
                  <select
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        categoryId: event.target.value,
                      }))
                    }
                    value={draft.categoryId}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}
              {draft.audienceType === "manual" ? (
                <FormField
                  hint="Oddziel adresy przecinkiem, średnikiem lub nową linią."
                  label="Adresy e-mail"
                >
                  <textarea
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        recipients: event.target.value,
                      }))
                    }
                    placeholder="anna@example.com, biuro@example.com"
                    rows={2}
                    value={draft.recipients}
                  />
                </FormField>
              ) : null}
              <div className="audience-count">
                <Users size={17} />
                <span>
                  <strong>{formatNumber(recipientCount())}</strong>
                  <small>szacowanych odbiorców</small>
                </span>
              </div>
            </div>

            <div className="form-grid form-grid--two">
              <FormField label="Temat">
                <input
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      subject: event.target.value,
                    }))
                  }
                  value={draft.subject}
                />
              </FormField>
              <FormField label="Szablon">
                <div className="template-field">
                  <select
                    onChange={(event) => selectTemplate(event.target.value)}
                    value={draft.templateId}
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · v{template.version}
                      </option>
                    ))}
                    <option value="">Pusty szablon</option>
                  </select>
                  <Button
                    aria-label="Zarządzaj szablonami"
                    icon={Settings2}
                    onClick={openTemplateManager}
                    size="sm"
                  >
                    Zarządzaj
                  </Button>
                </div>
              </FormField>
            </div>
          </div>

          <div className="composer-mode-tabs">
            <button
              className={composerMode === "editor" ? "is-active" : ""}
              onClick={() => setComposerMode("editor")}
              type="button"
            >
              <FileText size={15} /> Edytor
            </button>
            <button
              className={composerMode === "preview" ? "is-active" : ""}
              onClick={() => setComposerMode("preview")}
              type="button"
            >
              <Eye size={15} /> Podgląd
            </button>
            <button
              className={composerMode === "html" ? "is-active" : ""}
              onClick={() => setComposerMode("html")}
              type="button"
            >
              <Code2 size={15} /> HTML
            </button>
          </div>

          {composerMode === "editor" ? (
            <div className="composer-editor-workspace">
              <div>
                <div className="editor-toolbar">
                  <button onClick={() => command("bold")} type="button">
                    <strong>B</strong>
                  </button>
                  <button onClick={() => command("italic")} type="button">
                    <i>I</i>
                  </button>
                  <button onClick={() => command("underline")} type="button">
                    U
                  </button>
                  <span />
                  <button
                    onClick={() => command("formatBlock", "h1")}
                    type="button"
                  >
                    H1
                  </button>
                  <button
                    onClick={() => command("formatBlock", "h2")}
                    type="button"
                  >
                    H2
                  </button>
                  <span />
                  <button
                    onClick={() => command("insertUnorderedList")}
                    type="button"
                  >
                    Lista
                  </button>
                  <button
                    onClick={() => setLinkEditorOpen((value) => !value)}
                    type="button"
                  >
                    Link
                  </button>
                  <button
                    onClick={() =>
                      command("insertText", "{{recipient.name}}")
                    }
                    type="button"
                  >
                    Zmienna
                  </button>
                </div>
                {linkEditorOpen ? (
                  <div className="link-editor-popover">
                    <input
                      aria-label="Adres linku"
                      onChange={(event) => setLinkUrl(event.target.value)}
                      placeholder="https://example.com"
                      type="url"
                      value={linkUrl}
                    />
                    <Button
                      onClick={() => {
                        if (!/^https?:\/\//i.test(linkUrl)) {
                          addToast({
                            title: "Nieprawidłowy link",
                            message: "Adres musi zaczynać się od http:// lub https://.",
                            tone: "warning",
                          });
                          return;
                        }
                        command("createLink", linkUrl);
                        setLinkEditorOpen(false);
                      }}
                      size="sm"
                      variant="primary"
                    >
                      Wstaw link
                    </Button>
                  </div>
                ) : null}
                <div
                  className="rich-editor"
                  contentEditable
                  dangerouslySetInnerHTML={{ __html: draft.htmlBody }}
                  key={`${draft.templateId}-${composerOpen}`}
                  onInput={(event) =>
                    setDraft((current) => ({
                      ...current,
                      htmlBody: sanitizeEmailHtml(
                        event.currentTarget.innerHTML,
                      ),
                    }))
                  }
                  ref={editorRef}
                  suppressContentEditableWarning
                />
              </div>
              <aside className="variable-rail">
                <h3>Zmienne w treści</h3>
                <p>Kliknij, aby wstawić w miejscu kursora.</p>
                {[
                  "recipient.name",
                  "recipient.email",
                  "message.reference",
                  "message.summary",
                  "action.url",
                  "agent.name",
                  "company.name",
                ].map((variable) => (
                  <button
                    key={variable}
                    onClick={() => command("insertText", `{{${variable}}}`)}
                    type="button"
                  >
                    {`{{${variable}}}`}
                  </button>
                ))}
              </aside>
            </div>
          ) : null}

          {composerMode === "preview" ? (
            <div className="composer-live-preview">
              <iframe
                sandbox=""
                srcDoc={previewDocument}
                title="Podgląd wiadomości e-mail"
              />
              <div className="send-safety">
                <CalendarClock size={17} />
                <div>
                  <strong>Kontrola przed wysłaniem</strong>
                  <span>
                    Duplikaty, wypisane adresy i limity konta zostaną sprawdzone
                    w kolejce odbiorców.
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {composerMode === "html" ? (
            <div className="html-editor-pane">
              <div className="html-editor-pane__header">
                <div>
                  <h3>Kod HTML wiadomości</h3>
                  <p>Skrypty, formularze i niebezpieczne atrybuty są usuwane.</p>
                </div>
                <Button
                  icon={Copy}
                  onClick={() =>
                    void navigator.clipboard.writeText(draft.htmlBody)
                  }
                  size="sm"
                >
                  Kopiuj
                </Button>
              </div>
              <textarea
                className="code-textarea"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    htmlBody: event.target.value,
                  }))
                }
                rows={18}
                spellCheck={false}
                value={draft.htmlBody}
              />
            </div>
          ) : null}

          <div className="composer-options">
            <label>
              <input
                checked={draft.includeUnsubscribe}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    includeUnsubscribe: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Dodaj link rezygnacji
            </label>
            <label>
              <input
                checked={draft.trackDelivery}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    trackDelivery: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Śledź dostarczenie i otwarcie
            </label>
            <label>
              <input
                checked={draft.includeOriginal}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    includeOriginal: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Dołącz oryginalną wiadomość
            </label>
          </div>
        </div>
      </Modal>

      <Drawer
        footer={
          <>
            <Button onClick={() => setTemplateManagerOpen(false)}>
              Zamknij
            </Button>
            <Button
              icon={Save}
              onClick={saveTemplate}
              variant="primary"
            >
              Zapisz szablon
            </Button>
          </>
        }
        onClose={() => setTemplateManagerOpen(false)}
        open={templateManagerOpen}
        subtitle="Twórz wersjonowane treści używane w ręcznych i automatycznych wysyłkach."
        size="lg"
        title="Szablony wiadomości"
      >
        <div className="template-manager">
          <div className="template-manager__list">
            <Button
              icon={Plus}
              onClick={() =>
                setSelectedTemplateDraft(
                  blankTemplate(activeOrganizationId),
                )
              }
              size="sm"
              variant="primary"
            >
              Nowy szablon
            </Button>
            {templates.map((template) => (
              <button
                className={
                  selectedTemplateDraft?.id === template.id
                    ? "is-selected"
                    : ""
                }
                key={template.id}
                onClick={() =>
                  setSelectedTemplateDraft(structuredClone(template))
                }
                type="button"
              >
                <LayoutTemplate size={17} />
                <span>
                  <strong>{template.name}</strong>
                  <small>
                    {template.kind} · v{template.version}
                  </small>
                </span>
              </button>
            ))}
          </div>

          {selectedTemplateDraft ? (
            <div className="template-manager__editor">
              <div className="form-grid form-grid--two">
                <FormField label="Nazwa">
                  <input
                    onChange={(event) =>
                      setSelectedTemplateDraft((current) =>
                        current
                          ? { ...current, name: event.target.value }
                          : current,
                      )
                    }
                    value={selectedTemplateDraft.name}
                  />
                </FormField>
                <FormField label="Rodzaj">
                  <select
                    onChange={(event) =>
                      setSelectedTemplateDraft((current) =>
                        current
                          ? {
                              ...current,
                              kind: event.target.value as TemplateKind,
                            }
                          : current,
                      )
                    }
                    value={selectedTemplateDraft.kind}
                  >
                    <option value="notification">Powiadomienie</option>
                    <option value="support">Obsługa klienta</option>
                    <option value="sales">Sprzedaż</option>
                    <option value="transactional">Transakcyjny</option>
                    <option value="blank">Pusty</option>
                  </select>
                </FormField>
              </div>
              <FormField label="Opis">
                <input
                  onChange={(event) =>
                    setSelectedTemplateDraft((current) =>
                      current
                        ? { ...current, description: event.target.value }
                        : current,
                    )
                  }
                  value={selectedTemplateDraft.description}
                />
              </FormField>
              <FormField label="Temat">
                <input
                  onChange={(event) =>
                    setSelectedTemplateDraft((current) =>
                      current
                        ? { ...current, subject: event.target.value }
                        : current,
                    )
                  }
                  value={selectedTemplateDraft.subject}
                />
              </FormField>
              <FormField label="HTML">
                <textarea
                  className="code-textarea"
                  onChange={(event) =>
                    setSelectedTemplateDraft((current) =>
                      current
                        ? { ...current, htmlBody: event.target.value }
                        : current,
                    )
                  }
                  rows={12}
                  value={selectedTemplateDraft.htmlBody}
                />
              </FormField>
              <div className="template-variable-list">
                <strong>Wykryte zmienne</strong>
                <div>
                  {extractVariables(
                    selectedTemplateDraft.subject,
                    selectedTemplateDraft.htmlBody,
                  ).map((variable) => (
                    <code key={variable}>{`{{${variable}}}`}</code>
                  ))}
                </div>
              </div>
              {!selectedTemplateDraft.id.startsWith("template-") ||
              templates.some(
                (template) => template.id === selectedTemplateDraft.id,
              ) ? (
                <Button
                  icon={Trash2}
                  onClick={() => {
                    removeTemplate(selectedTemplateDraft.id);
                    setSelectedTemplateDraft(
                      templates.find(
                        (template) =>
                          template.id !== selectedTemplateDraft.id,
                      ) ?? null,
                    );
                  }}
                  size="sm"
                  variant="danger"
                >
                  Usuń szablon
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Drawer>

      <Modal
        description="Treść, odbiorcy i stan konkretnej wysyłki."
        footer={
          <Button onClick={() => setCampaignPreview(null)}>Zamknij</Button>
        }
        onClose={() => setCampaignPreview(null)}
        open={Boolean(campaignPreview)}
        size="lg"
        title="Szczegóły wysyłki"
      >
        {campaignPreview ? (
          <div className="campaign-detail">
            <dl>
              <div>
                <dt>Temat</dt>
                <dd>{campaignPreview.subject}</dd>
              </div>
              <div>
                <dt>Nadawca</dt>
                <dd>{campaignPreview.sender}</dd>
              </div>
              <div>
                <dt>Odbiorcy</dt>
                <dd>
                  {campaignPreview.audience} ·{" "}
                  {formatNumber(campaignPreview.recipients)}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{campaignStatus[campaignPreview.status].label}</dd>
              </div>
            </dl>
            {campaignPreview.htmlBody ? (
              <iframe
                sandbox=""
                srcDoc={emailPreviewDocument({
                  html: campaignPreview.htmlBody,
                  subject: campaignPreview.subject,
                  senderName: campaignPreview.sender,
                  senderEmail: campaignPreview.sender,
                })}
                title={`Podgląd ${campaignPreview.subject}`}
              />
            ) : (
              <div className="empty-workspace">
                <Edit3 size={24} />
                <p>Starsza wysyłka nie ma zachowanej treści demonstracyjnej.</p>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
