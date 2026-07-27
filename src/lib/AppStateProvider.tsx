import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  automations as initialAutomations,
  auditEvents as initialAuditEvents,
  campaigns as initialCampaigns,
  categories as initialCategories,
  messages as initialMessages,
  rules as initialRules,
  sources as initialSources,
  users as initialUsers,
} from "../data/demo";
import type {
  AutomationRule,
  Category,
  EmailMessage,
  TeamUser,
} from "../types";
import {
  AppStateContext,
  type AppStateValue,
  type ToastMessage,
} from "./AppState";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState(initialMessages);
  const [categories, setCategories] = useState(initialCategories);
  const [rules, setRules] = useState(initialRules);
  const [sources, setSources] = useState(initialSources);
  const [automations, setAutomations] = useState(initialAutomations);
  const [campaigns] = useState(initialCampaigns);
  const [users, setUsers] = useState(initialUsers);
  const [auditEvents] = useState(initialAuditEvents);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const updateMessage = useCallback(
    (id: string, patch: Partial<EmailMessage>) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id ? { ...message, ...patch } : message,
        ),
      );
    },
    [],
  );

  const updateRule = useCallback(
    (id: string, patch: Partial<AutomationRule>) => {
      setRules((current) =>
        current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      );
    },
    [],
  );

  const addRule = useCallback((rule: AutomationRule) => {
    setRules((current) => [rule, ...current]);
  }, []);

  const toggleSource = useCallback((id: string) => {
    setSources((current) =>
      current.map((source) =>
        source.id === id
          ? {
              ...source,
              status: source.status === "paused" ? "active" : "paused",
            }
          : source,
      ),
    );
  }, []);

  const toggleAutomation = useCallback((id: string) => {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === id
          ? { ...automation, active: !automation.active }
          : automation,
      ),
    );
  }, []);

  const addCategory = useCallback((category: Category) => {
    setCategories((current) => [...current, category]);
  }, []);

  const addUser = useCallback((user: TeamUser) => {
    setUsers((current) => [...current, user]);
  }, []);

  const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      messages,
      categories,
      rules,
      sources,
      automations,
      campaigns,
      users,
      auditEvents,
      toasts,
      updateMessage,
      updateRule,
      addRule,
      toggleSource,
      toggleAutomation,
      addCategory,
      addUser,
      addToast,
      dismissToast,
    }),
    [
      messages,
      categories,
      rules,
      sources,
      automations,
      campaigns,
      users,
      auditEvents,
      toasts,
      updateMessage,
      updateRule,
      addRule,
      toggleSource,
      toggleAutomation,
      addCategory,
      addUser,
      addToast,
      dismissToast,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
