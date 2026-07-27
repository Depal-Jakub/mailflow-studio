import { createContext, useContext } from "react";
import type {
  AuditEvent,
  Automation,
  AutomationRule,
  Category,
  DeliveryAccount,
  EmailTemplate,
  EmailMessage,
  Organization,
  OrganizationMembership,
  OutboundCampaign,
  Permission,
  RoleDefinition,
  SourceConnector,
  TeamUser,
} from "../types";

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  tone: "success" | "info" | "warning" | "error";
}

export interface AppStateValue {
  messages: EmailMessage[];
  categories: Category[];
  rules: AutomationRule[];
  sources: SourceConnector[];
  automations: Automation[];
  campaigns: OutboundCampaign[];
  deliveryAccounts: DeliveryAccount[];
  templates: EmailTemplate[];
  users: TeamUser[];
  organizations: Organization[];
  activeOrganization: Organization;
  activeOrganizationId: string;
  memberships: OrganizationMembership[];
  roles: RoleDefinition[];
  activeRole: RoleDefinition | undefined;
  auditEvents: AuditEvent[];
  toasts: ToastMessage[];
  setActiveOrganization: (organizationId: string) => void;
  updateOrganization: (
    organizationId: string,
    patch: Partial<Organization>,
  ) => void;
  can: (permission: Permission) => boolean;
  updateMessage: (id: string, patch: Partial<EmailMessage>) => void;
  updateRule: (id: string, patch: Partial<AutomationRule>) => void;
  addRule: (rule: AutomationRule) => void;
  toggleSource: (id: string) => void;
  addSource: (source: SourceConnector) => void;
  updateSource: (id: string, patch: Partial<SourceConnector>) => void;
  removeSource: (id: string) => void;
  toggleAutomation: (id: string) => void;
  addAutomation: (automation: Automation) => void;
  updateAutomation: (id: string, patch: Partial<Automation>) => void;
  removeAutomation: (id: string) => void;
  runAutomation: (id: string) => void;
  addCategory: (category: Category) => void;
  updateCategory: (id: string, patch: Partial<Category>) => void;
  removeCategory: (id: string) => void;
  addCampaign: (campaign: OutboundCampaign) => void;
  addDeliveryAccount: (account: DeliveryAccount) => void;
  updateDeliveryAccount: (
    id: string,
    patch: Partial<DeliveryAccount>,
  ) => void;
  removeDeliveryAccount: (id: string) => void;
  addTemplate: (template: EmailTemplate) => void;
  updateTemplate: (id: string, patch: Partial<EmailTemplate>) => void;
  removeTemplate: (id: string) => void;
  addUser: (user: TeamUser, roleId?: string) => void;
  updateMembership: (
    userId: string,
    patch: Partial<OrganizationMembership>,
  ) => void;
  addRole: (role: RoleDefinition) => void;
  updateRole: (id: string, patch: Partial<RoleDefinition>) => void;
  removeRole: (id: string) => void;
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
  resetDemoState: () => void;
}

export const AppStateContext = createContext<AppStateValue | null>(null);

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside AppStateProvider");
  }
  return context;
};
