export type MessageStatus =
  | "new"
  | "classified"
  | "review"
  | "automated"
  | "failed"
  | "archived";

export type SourceType = "gmail" | "outlook" | "imap" | "webhook" | "scraper";
export type ConnectorStatus = "active" | "warning" | "error" | "paused";
export type UserRole = "owner" | "admin" | "operator" | "reviewer" | "viewer";
export type MembershipStatus = "active" | "invited" | "suspended";

export type Permission =
  | "dashboard.view"
  | "messages.view"
  | "messages.classify"
  | "messages.assign"
  | "messages.export"
  | "sources.view"
  | "sources.manage"
  | "sources.test"
  | "categories.view"
  | "categories.manage"
  | "rules.view"
  | "rules.manage"
  | "rules.publish"
  | "automations.view"
  | "automations.manage"
  | "send.view"
  | "send.compose"
  | "send.approve"
  | "send.schedule"
  | "templates.view"
  | "templates.manage"
  | "accounts.view"
  | "accounts.manage"
  | "users.view"
  | "users.invite"
  | "users.manage"
  | "roles.manage"
  | "reports.view"
  | "reports.export"
  | "audit.view"
  | "api_keys.view"
  | "api_keys.manage"
  | "settings.view"
  | "settings.manage"
  | "organization.manage"
  | "organization.billing";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  initials: string;
  timezone: string;
  locale: string;
  plan: "trial" | "business" | "enterprise";
  status: "active" | "suspended";
  createdAt: string;
}

export interface RoleDefinition {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string;
  color: string;
  builtIn: boolean;
  permissions: Permission[];
  memberCount: number;
}

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  roleId: string;
  status: MembershipStatus;
  joinedAt: string | null;
  invitedAt: string | null;
}

export interface Category {
  id: string;
  organizationId?: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  defaultScore: number;
  messageCount: number;
  automationCount: number;
  active: boolean;
}

export interface EmailMessage {
  id: string;
  organizationId?: string;
  sender: string;
  senderName: string;
  recipient: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string;
  status: MessageStatus;
  categoryId: string | null;
  score: number;
  sourceId: string;
  direction: "incoming" | "outgoing";
  tags: string[];
  hasAttachments: boolean;
  attachmentNames: string[];
  matchedRuleIds: string[];
  reviewReason?: string;
}

export interface SourceConnector {
  id: string;
  organizationId?: string;
  name: string;
  address: string;
  type: SourceType;
  status: ConnectorStatus;
  unread: number;
  total: number;
  lastSyncAt: string;
  nextSyncSeconds: number;
  folders: string[];
  syncIntervalMinutes: number;
  publicConfig?: Record<string, unknown>;
  credentialsConfigured?: boolean;
  lastTestAt?: string | null;
  lastError?: string | null;
  createdAt?: string;
}

export type ConditionField =
  | "sender"
  | "sender_domain"
  | "recipient"
  | "subject"
  | "body"
  | "attachment_name"
  | "attachment_type"
  | "source"
  | "sentiment"
  | "url"
  | "size";

export type ConditionOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "matches"
  | "greater_than"
  | "less_than"
  | "exists";

export interface RuleCondition {
  id: string;
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}

export type RuleActionType =
  | "assign_category"
  | "add_score"
  | "add_tag"
  | "set_review"
  | "forward_smtp"
  | "send_webhook"
  | "scrape_urls"
  | "create_task"
  | "archive"
  | "stop_processing";

export interface RuleAction {
  id: string;
  type: RuleActionType;
  value: string;
}

export interface AutomationRule {
  id: string;
  organizationId?: string;
  name: string;
  description: string;
  categoryId: string | null;
  priority: number;
  active: boolean;
  matchMode: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  hits: number;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Automation {
  id: string;
  organizationId?: string;
  name: string;
  trigger: string;
  steps: string[];
  active: boolean;
  runs: number;
  successRate: number;
  lastRunAt: string;
  nextRunAt?: string;
  description?: string;
  triggerType?: string;
  triggerConfig?: Record<string, unknown>;
  stepDefinitions?: Array<Record<string, unknown>>;
  version?: number;
  recentRuns?: Array<Record<string, unknown>>;
}

export interface OutboundCampaign {
  id: string;
  organizationId?: string;
  subject: string;
  sender: string;
  audience: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed";
  recipients: number;
  delivered: number;
  opened: number;
  createdAt: string;
  templateId?: string | null;
  deliveryAccountId?: string | null;
  scheduledAt?: string | null;
  textBody?: string;
  htmlBody?: string;
  recipientList?: Array<{
    email: string;
    name?: string | null;
    variables?: Record<string, unknown>;
  }>;
}

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: UserRole;
  status: "active" | "invited" | "suspended";
  lastActiveAt: string;
  twoFactorEnabled: boolean;
  assignedReviews: number;
  membershipCount?: number;
}

export type DeliveryProvider =
  | "gmail"
  | "outlook"
  | "smtp"
  | "ses"
  | "sendgrid"
  | "resend";

export interface DeliveryAccount {
  id: string;
  organizationId: string;
  provider: DeliveryProvider;
  sourceConnectorId: string | null;
  name: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  status: ConnectorStatus;
  serverLabel: string;
  authenticationLabel: string;
  dailyLimit: number;
  hourlyLimit: number;
  sentToday: number;
  deliveryRate: number;
  credentialsConfigured: boolean;
  publicConfig: Record<string, unknown>;
  lastTestAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export type TemplateKind =
  | "notification"
  | "support"
  | "sales"
  | "transactional"
  | "blank";

export interface EmailTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  kind: TemplateKind;
  subject: string;
  textBody: string;
  htmlBody: string;
  variables: string[];
  active: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface AuditEvent {
  id: string;
  organizationId?: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  severity: "info" | "success" | "warning" | "error";
  ip: string;
}

export interface SystemHealth {
  key: string;
  label: string;
  detail: string;
  status: ConnectorStatus;
  countdownSeconds: number;
}

export type ApiKeyScope =
  | "messages:read"
  | "messages:write"
  | "categories:read"
  | "categories:write"
  | "sources:read"
  | "sources:sync"
  | "templates:read"
  | "outbound:read"
  | "outbound:write"
  | "audit:read"
  | "*";

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  status: "active" | "revoked";
  rate_limit_per_minute: number;
  allowed_ips: string[];
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  usage_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface ApiRequestLog {
  id: string;
  request_id: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
