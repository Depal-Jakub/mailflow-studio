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

export interface Category {
  id: string;
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
  name: string;
  trigger: string;
  steps: string[];
  active: boolean;
  runs: number;
  successRate: number;
  lastRunAt: string;
  nextRunAt?: string;
}

export interface OutboundCampaign {
  id: string;
  subject: string;
  sender: string;
  audience: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed";
  recipients: number;
  delivered: number;
  opened: number;
  createdAt: string;
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
}

export interface AuditEvent {
  id: string;
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

