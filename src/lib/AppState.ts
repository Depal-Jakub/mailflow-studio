import { createContext, useContext } from "react";
import type {
  AuditEvent,
  Automation,
  AutomationRule,
  Category,
  EmailMessage,
  OutboundCampaign,
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
  users: TeamUser[];
  auditEvents: AuditEvent[];
  toasts: ToastMessage[];
  updateMessage: (id: string, patch: Partial<EmailMessage>) => void;
  updateRule: (id: string, patch: Partial<AutomationRule>) => void;
  addRule: (rule: AutomationRule) => void;
  toggleSource: (id: string) => void;
  toggleAutomation: (id: string) => void;
  addCategory: (category: Category) => void;
  addUser: (user: TeamUser) => void;
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}

export const AppStateContext = createContext<AppStateValue | null>(null);

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside AppStateProvider");
  }
  return context;
};

