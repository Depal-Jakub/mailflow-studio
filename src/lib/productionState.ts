import type {
  AuditEvent,
  Automation,
  AutomationRule,
  Category,
  DeliveryAccount,
  EmailMessage,
  EmailTemplate,
  Organization,
  OrganizationMembership,
  OutboundCampaign,
  Permission,
  RoleDefinition,
  RuleAction,
  RuleCondition,
  SourceConnector,
  TeamUser,
  UserRole,
} from "../types";
import { api } from "../services/api";

type DbRecord = Record<string, unknown>;

const record = (value: unknown): DbRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as DbRecord)
    : {};

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const date = (value: unknown, fallback = new Date(0).toISOString()) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;

const array = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("pl");

export interface ProductionOrganization {
  organization: Organization;
  membership: OrganizationMembership;
  role: RoleDefinition;
}

export interface WorkspaceSnapshot {
  messages: EmailMessage[];
  categories: Category[];
  rules: AutomationRule[];
  sources: SourceConnector[];
  automations: Automation[];
  campaigns: OutboundCampaign[];
  deliveryAccounts: DeliveryAccount[];
  templates: EmailTemplate[];
  users: TeamUser[];
  memberships: OrganizationMembership[];
  roles: RoleDefinition[];
  auditEvents: AuditEvent[];
}

const roleKey = (value: unknown): UserRole =>
  ["owner", "admin", "operator", "reviewer", "viewer"].includes(String(value))
    ? (String(value) as UserRole)
    : "viewer";

const mapRole = (row: DbRecord, organizationId: string): RoleDefinition => ({
  id: text(row.id),
  organizationId,
  key: text(row.key, "viewer"),
  name: text(row.name, "Rola"),
  description: text(row.description),
  color: text(row.color, "#64748b"),
  builtIn: Boolean(row.built_in),
  permissions: array<string>(row.permissions) as Permission[],
  memberCount: number(record(array(row.members)[0]).count),
});

export async function loadProductionOrganizations(
  currentUserId: string,
): Promise<
  ProductionOrganization[]
> {
  const rows = await api.get<DbRecord[]>("organizations");
  return rows.map((row) => {
    const membership = record(row.membership);
    const roleRow = record(membership.role);
    const name = text(row.name, "Organizacja");
    const organizationId = text(row.id);
    const role = mapRole(roleRow, organizationId);
    return {
      organization: {
        id: organizationId,
        name,
        slug: text(row.slug, organizationId),
        initials: initials(name),
        timezone: text(row.timezone, "Europe/Warsaw"),
        locale: text(row.locale, "pl"),
        plan: ["trial", "business", "enterprise"].includes(
          text(record(row.settings).plan),
        )
          ? (text(record(row.settings).plan) as Organization["plan"])
          : "business",
        status: text(row.status) === "suspended" ? "suspended" : "active",
        createdAt: date(row.created_at),
      },
      membership: {
        organizationId,
        userId: currentUserId,
        roleId: text(membership.role_id, role.id),
        status: "active",
        joinedAt: null,
        invitedAt: null,
      },
      role,
    };
  });
}

const mapMessage = (row: DbRecord, organizationId: string): EmailMessage => {
  const category = record(row.category);
  const source = record(row.source);
  const recipients = array<unknown>(row.recipients);
  const firstRecipient =
    typeof recipients[0] === "string"
      ? recipients[0]
      : text(record(recipients[0]).email);
  const status = text(row.status, "new") as EmailMessage["status"];
  return {
    id: text(row.id),
    organizationId,
    sender: text(row.sender_email),
    senderName: text(row.sender_name, text(row.sender_email)),
    recipient: firstRecipient,
    subject: text(row.subject, "(bez tematu)"),
    preview: text(row.preview),
    body: text(row.body_text, text(row.preview)),
    receivedAt: date(row.received_at),
    status: ["new", "classified", "review", "automated", "failed", "archived"].includes(
      status,
    )
      ? status
      : "new",
    categoryId: text(category.id) || null,
    score: number(row.score),
    sourceId: text(source.id),
    direction: row.direction === "outgoing" ? "outgoing" : "incoming",
    tags: array<string>(row.tags),
    hasAttachments: Boolean(row.has_attachments),
    attachmentNames: array<string>(row.attachment_names),
    matchedRuleIds: array<string>(row.matched_rule_ids),
    reviewReason: text(row.review_reason) || undefined,
  };
};

const mapCategory = (
  row: DbRecord,
  organizationId: string,
  messages: EmailMessage[],
  automations: Automation[],
): Category => ({
  id: text(row.id),
  organizationId,
  name: text(row.name),
  description: text(row.description),
  color: text(row.color, "#64748b"),
  icon: text(row.icon, "folder"),
  defaultScore: number(row.default_score),
  messageCount: messages.filter((message) => message.categoryId === row.id)
    .length,
  automationCount: automations.filter(
    (automation) =>
      record(automation.triggerConfig).category_id === row.id,
  ).length,
  active: row.active !== false,
});

const mapRule = (row: DbRecord, organizationId: string): AutomationRule => {
  const versions = array<DbRecord>(row.versions);
  const currentVersion = number(row.current_version, 1);
  const version =
    versions.find((item) => number(item.version) === currentVersion) ??
    versions.sort((left, right) => number(right.version) - number(left.version))[0] ??
    {};
  return {
    id: text(row.id),
    organizationId,
    name: text(row.name),
    description: text(row.description),
    categoryId: text(row.category_id, text(record(row.category).id)) || null,
    priority: number(row.priority, 50),
    active: Boolean(row.active),
    matchMode: version.match_mode === "any" ? "any" : "all",
    conditions: array<DbRecord>(version.conditions).map(
      (condition, index): RuleCondition => ({
        id: text(condition.id, `condition-${row.id}-${index}`),
        field: text(condition.field, "subject") as RuleCondition["field"],
        operator: text(
          condition.operator,
          "contains",
        ) as RuleCondition["operator"],
        value: text(condition.value),
      }),
    ),
    actions: array<DbRecord>(version.actions).map(
      (action, index): RuleAction => ({
        id: text(action.id, `action-${row.id}-${index}`),
        type: text(action.type, "add_tag") as RuleAction["type"],
        value: text(action.value),
      }),
    ),
    hits: number(row.hit_count),
    version: currentVersion,
    updatedAt: date(row.updated_at),
    updatedBy: text(row.updated_by, "System"),
  };
};

const automationStepLabel = (step: unknown) => {
  if (typeof step === "string") return step;
  const item = record(step);
  const labels: Record<string, string> = {
    set_category: "Ustaw kategorię",
    assign_category: "Ustaw kategorię",
    set_score: "Ustaw wynik",
    add_score: "Dodaj wynik",
    add_tag: "Dodaj tag",
    set_review: "Wyślij do weryfikacji",
    archive: "Archiwizuj",
    send_webhook: "Wyślij webhook",
    forward_smtp: "Przekaż wiadomość",
    send_email: "Wyślij e-mail",
    create_task: "Utwórz zadanie",
    notify_team: "Powiadom zespół",
    delay: "Odczekaj",
    stop: "Zakończ przepływ",
  };
  return labels[text(item.type)] ?? text(item.type, "Krok");
};

const mapAutomation = (row: DbRecord, organizationId: string): Automation => {
  const recentRuns = array<DbRecord>(row.recent_runs);
  const runCount = number(row.run_count);
  const successCount = number(row.success_count);
  return {
    id: text(row.id),
    organizationId,
    name: text(row.name),
    description: text(row.description),
    trigger: text(row.trigger_type),
    triggerType: text(row.trigger_type),
    triggerConfig: record(row.trigger_config),
    steps: array(row.steps).map(automationStepLabel),
    stepDefinitions: array<DbRecord>(row.steps),
    active: Boolean(row.active),
    runs: runCount,
    successRate: runCount > 0 ? (successCount / runCount) * 100 : 0,
    lastRunAt: date(
      row.last_run_at,
      text(recentRuns[0]?.created_at, new Date(0).toISOString()),
    ),
    nextRunAt: text(row.next_run_at) || undefined,
    version: number(row.version, 1),
    recentRuns,
  };
};

const mapSource = (row: DbRecord, organizationId: string): SourceConnector => ({
  id: text(row.id),
  organizationId,
  name: text(row.name),
  address: text(row.address),
  type: text(row.type, "webhook") as SourceConnector["type"],
  status: text(row.status, "paused") as SourceConnector["status"],
  unread: number(row.unread_count),
  total: number(row.message_count),
  lastSyncAt: date(row.last_sync_at),
  nextSyncSeconds: Math.max(
    0,
    Math.round((Date.parse(text(row.next_sync_at)) - Date.now()) / 1000) || 0,
  ),
  folders: array<string>(row.folders),
  syncIntervalMinutes: number(row.sync_interval_minutes, 5),
  publicConfig: record(row.public_config),
  credentialsConfigured: number(row.credentials_version) > 0,
  lastTestAt: text(row.last_test_at) || null,
  lastError: text(row.last_error) || null,
  createdAt: text(row.created_at),
});

const mapDeliveryAccount = (
  row: DbRecord,
  organizationId: string,
): DeliveryAccount => ({
  id: text(row.id),
  organizationId,
  provider: text(row.provider, "smtp") as DeliveryAccount["provider"],
  sourceConnectorId: text(row.source_connector_id) || null,
  name: text(row.name),
  fromEmail: text(row.from_email),
  fromName: text(row.from_name),
  replyTo: text(row.reply_to),
  status: text(row.status, "paused") as DeliveryAccount["status"],
  serverLabel: text(record(row.public_config).host, text(row.provider)),
  authenticationLabel: number(row.credentials_version) > 0
    ? "Sekret skonfigurowany"
    : "Brak sekretu",
  dailyLimit: number(row.daily_limit, 1000),
  hourlyLimit: number(row.hourly_limit, 200),
  sentToday: number(row.sent_today),
  deliveryRate: number(row.delivery_rate),
  credentialsConfigured: number(row.credentials_version) > 0,
  publicConfig: record(row.public_config),
  lastTestAt: text(row.last_test_at) || null,
  lastError: text(row.last_error) || null,
  createdAt: date(row.created_at),
});

const mapTemplate = (row: DbRecord, organizationId: string): EmailTemplate => ({
  id: text(row.id),
  organizationId,
  name: text(row.name),
  description: text(row.description),
  kind: text(row.template_type, "notification") as EmailTemplate["kind"],
  subject: text(row.subject_template),
  textBody: text(row.text_template),
  htmlBody: text(row.html_template),
  variables: array<string>(row.variables),
  active: row.active !== false,
  version: number(row.version, 1),
  updatedAt: date(row.updated_at),
  updatedBy: text(row.updated_by, "System"),
});

const mapCampaign = (
  row: DbRecord,
  organizationId: string,
): OutboundCampaign => {
  const account = record(row.account);
  const statusMap: Record<string, OutboundCampaign["status"]> = {
    draft: "draft",
    scheduled: "scheduled",
    pending: "sending",
    processing: "sending",
    complete: "sent",
    sent: "sent",
    failed: "failed",
    cancelled: "failed",
  };
  return {
    id: text(row.id),
    organizationId,
    subject: text(row.subject),
    sender: text(account.from_email),
    audience: text(record(row.audience_definition).label, "Odbiorcy jawni"),
    status: statusMap[text(row.status)] ?? "draft",
    recipients: number(row.recipient_count),
    delivered: number(row.delivered_count),
    opened: number(row.opened_count),
    createdAt: date(row.created_at),
    templateId: text(row.template_id) || null,
    deliveryAccountId: text(row.delivery_account_id) || null,
    scheduledAt: text(row.scheduled_at) || null,
    textBody: text(row.text_body),
    htmlBody: text(row.html_body),
  };
};

const mapUser = (row: DbRecord): TeamUser => {
  const profile = record(row.profile);
  const name = text(profile.full_name, text(row.email, "Użytkownik"));
  return {
    id: text(row.user_id),
    name,
    email: text(row.email, "adres ukryty"),
    initials: initials(name),
    role: roleKey(record(row.role_definition).key ?? row.role),
    status: text(row.status, "invited") as TeamUser["status"],
    lastActiveAt: date(profile.last_seen_at),
    twoFactorEnabled: false,
    assignedReviews: number(row.assigned_reviews),
  };
};

const mapAudit = (row: DbRecord, organizationId: string): AuditEvent => ({
  id: text(row.id),
  organizationId,
  actor: text(record(row.actor).full_name, text(row.actor_type, "System")),
  action: text(row.action),
  target: text(row.target_label, text(row.target_type)),
  createdAt: date(row.created_at),
  severity: ["info", "success", "warning", "error"].includes(text(row.severity))
    ? (text(row.severity) as AuditEvent["severity"])
    : "info",
  ip: text(row.ip_address, "brak"),
});

export async function loadProductionWorkspace(
  organizationId: string,
): Promise<WorkspaceSnapshot> {
  const [
    messageResult,
    categoryRows,
    ruleRows,
    sourceRows,
    automationRows,
    campaignRows,
    deliveryRows,
    templateRows,
    userRows,
    roleRows,
    auditResult,
  ] = await Promise.all([
    api.get<{ data: DbRecord[]; next_cursor: string | null }>(
      "messages?limit=100",
      organizationId,
    ),
    api.get<DbRecord[]>("categories", organizationId),
    api.get<DbRecord[]>("rules", organizationId),
    api.get<DbRecord[]>("sources", organizationId),
    api.get<DbRecord[]>("automations", organizationId),
    api.get<DbRecord[]>("outbound-messages?limit=100", organizationId),
    api.get<DbRecord[]>("delivery-accounts", organizationId),
    api.get<DbRecord[]>("templates", organizationId),
    api.get<DbRecord[]>("users", organizationId),
    api.get<DbRecord[]>("roles", organizationId),
    api.get<{ data: DbRecord[]; next_cursor: string | null }>(
      "audit?limit=100",
      organizationId,
    ),
  ]);
  const messages = messageResult.data.map((row) =>
    mapMessage(row, organizationId),
  );
  const automations = automationRows.map((row) =>
    mapAutomation(row, organizationId),
  );
  const categories = categoryRows.map((row) =>
    mapCategory(row, organizationId, messages, automations),
  );
  const roles = roleRows.map((row) => mapRole(row, organizationId));
  const memberships = userRows.map(
    (row): OrganizationMembership => ({
      organizationId,
      userId: text(row.user_id),
      roleId: text(row.role_id),
      status: text(row.status, "invited") as OrganizationMembership["status"],
      joinedAt: text(row.joined_at) || null,
      invitedAt: text(row.invited_at) || null,
    }),
  );
  return {
    messages,
    categories,
    rules: ruleRows.map((row) => mapRule(row, organizationId)),
    sources: sourceRows.map((row) => mapSource(row, organizationId)),
    automations,
    campaigns: campaignRows.map((row) => mapCampaign(row, organizationId)),
    deliveryAccounts: deliveryRows.map((row) =>
      mapDeliveryAccount(row, organizationId),
    ),
    templates: templateRows.map((row) => mapTemplate(row, organizationId)),
    users: userRows.map(mapUser),
    memberships,
    roles,
    auditEvents: auditResult.data.map((row) => mapAudit(row, organizationId)),
  };
}

export const categoryToApi = (category: Category) => ({
  name: category.name,
  description: category.description,
  color: category.color,
  icon: category.icon,
  default_score: category.defaultScore,
  active: category.active,
});

export const ruleToApi = (rule: AutomationRule) => ({
  name: rule.name,
  description: rule.description,
  category_id: rule.categoryId,
  priority: rule.priority,
  active: rule.active,
  match_mode: rule.matchMode,
  conditions: rule.conditions,
  actions: rule.actions,
});

export const templateToApi = (template: EmailTemplate) => ({
  name: template.name,
  description: template.description,
  kind: template.kind,
  subject: template.subject,
  text_body: template.textBody,
  html_body: template.htmlBody,
  variables: template.variables,
  active: template.active,
});

export const automationToApi = (automation: Automation) => ({
  name: automation.name,
  description: automation.description ?? "",
  trigger_type: automation.triggerType ?? automation.trigger,
  trigger_config: automation.triggerConfig ?? {},
  steps:
    automation.stepDefinitions ??
    automation.steps.map((step) => ({ type: "notify_team", config: { title: step } })),
  active: automation.active,
  next_run_at: automation.nextRunAt ?? null,
});
