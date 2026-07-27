import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  automations as initialAutomations,
  auditEvents as initialAuditEvents,
  campaigns as initialCampaigns,
  categories as initialCategories,
  deliveryAccounts as initialDeliveryAccounts,
  memberships as initialMemberships,
  messages as initialMessages,
  organizations as initialOrganizations,
  roles as initialRoles,
  rules as initialRules,
  sources as initialSources,
  templates as initialTemplates,
  users as initialUsers,
} from "../data/demo";
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
  SourceConnector,
  TeamUser,
  UserRole,
} from "../types";
import { api } from "../services/api";
import { demoMode, supabase } from "../services/supabase";
import {
  AppStateContext,
  type AppStateValue,
  type ToastMessage,
} from "./AppState";
import { hasPermission } from "./permissions";
import {
  automationToApi,
  categoryToApi,
  loadProductionOrganizations,
  loadProductionWorkspace,
  ruleToApi,
  templateToApi,
} from "./productionState";

const STORAGE_KEY = "mailflow-studio:demo-state:v5";
const CURRENT_USER_ID = "user-1";
const DEFAULT_ORGANIZATION_ID = "org-acme";

interface PersistedState {
  version: 5;
  currentUserId: string;
  activeOrganizationId: string;
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
  memberships: OrganizationMembership[];
  roles: RoleDefinition[];
  auditEvents: AuditEvent[];
}

const scoped = <T extends { organizationId?: string }>(
  items: T[],
  organizationId: string,
) =>
  items.filter(
    (item) =>
      (item.organizationId ?? DEFAULT_ORGANIZATION_ID) === organizationId,
  );

const assignDefaultOrganization = <T extends { organizationId?: string }>(
  items: T[],
) =>
  items.map((item) => ({
    ...item,
    organizationId: item.organizationId ?? DEFAULT_ORGANIZATION_ID,
  }));

const createInitialState = (): PersistedState => ({
  version: 5,
  currentUserId: CURRENT_USER_ID,
  activeOrganizationId: DEFAULT_ORGANIZATION_ID,
  messages: assignDefaultOrganization(structuredClone(initialMessages)),
  categories: assignDefaultOrganization(structuredClone(initialCategories)),
  rules: assignDefaultOrganization(structuredClone(initialRules)),
  sources: assignDefaultOrganization(structuredClone(initialSources)),
  automations: assignDefaultOrganization(structuredClone(initialAutomations)),
  campaigns: assignDefaultOrganization(structuredClone(initialCampaigns)),
  deliveryAccounts: structuredClone(initialDeliveryAccounts),
  templates: structuredClone(initialTemplates),
  users: structuredClone(initialUsers),
  organizations: structuredClone(initialOrganizations),
  memberships: structuredClone(initialMemberships),
  roles: structuredClone(initialRoles),
  auditEvents: assignDefaultOrganization(structuredClone(initialAuditEvents)),
});

const createProductionState = (): PersistedState => ({
  ...createInitialState(),
  activeOrganizationId: "loading",
  messages: [],
  categories: [],
  rules: [],
  sources: [],
  automations: [],
  campaigns: [],
  deliveryAccounts: [],
  templates: [],
  users: [],
  organizations: [
    {
      id: "loading",
      name: "Ładowanie organizacji",
      slug: "loading",
      initials: "MF",
      timezone: "Europe/Warsaw",
      locale: "pl",
      plan: "trial",
      status: "active",
      createdAt: new Date(0).toISOString(),
    },
  ],
  memberships: [],
  roles: [],
  auditEvents: [],
});

const loadState = (): PersistedState => {
  if (!demoMode) return createProductionState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (parsed.version !== 5) return createInitialState();
    return {
      ...createInitialState(),
      ...parsed,
    } as PersistedState;
  } catch {
    return createInitialState();
  }
};

const newAuditEvent = (
  organizationId: string,
  action: string,
  target: string,
  severity: AuditEvent["severity"] = "info",
): AuditEvent => ({
  id: `event-${crypto.randomUUID()}`,
  organizationId,
  actor: "Jakub Kowalski",
  action,
  target,
  createdAt: new Date().toISOString(),
  severity,
  ip: "sesja lokalna / demo",
});

const builtInRoleKeys = new Set<UserRole>([
  "owner",
  "admin",
  "operator",
  "reviewer",
  "viewer",
]);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [productionReady, setProductionReady] = useState(demoMode);

  useEffect(() => {
    if (demoMode) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [state]);

  const activeOrganization =
    state.organizations.find(
      (organization) => organization.id === state.activeOrganizationId,
    ) ?? state.organizations[0];
  const activeOrganizationId =
    activeOrganization?.id ?? DEFAULT_ORGANIZATION_ID;

  const activeMembership = state.memberships.find(
    (membership) =>
      membership.organizationId === activeOrganizationId &&
      membership.userId === state.currentUserId &&
      membership.status === "active",
  );
  const activeRole = state.roles.find(
    (role) => role.id === activeMembership?.roleId,
  );

  const setActiveOrganization = useCallback((organizationId: string) => {
    setState((current) => {
      const hasAccess = demoMode
        ? current.memberships.some(
            (membership) =>
              membership.organizationId === organizationId &&
              membership.userId === current.currentUserId &&
              membership.status === "active",
          )
        : current.organizations.some(
            (organization) => organization.id === organizationId,
          );
      if (hasAccess && !demoMode) {
        window.localStorage.setItem(
          "mailflow-studio:active-organization",
          organizationId,
        );
      }
      return hasAccess
        ? { ...current, activeOrganizationId: organizationId }
        : current;
    });
  }, []);

  const updateOrganization = useCallback(
    (organizationId: string, patch: Partial<Organization>) => {
      setState((current) => {
        const organization = current.organizations.find(
          (item) => item.id === organizationId,
        );
        if (!organization) return current;
        return {
          ...current,
          organizations: current.organizations.map((item) =>
            item.id === organizationId ? { ...item, ...patch } : item,
          ),
          auditEvents: demoMode
            ? [
                newAuditEvent(
                  organizationId,
                  "Zmieniono ustawienia organizacji",
                  organization.name,
                ),
                ...current.auditEvents,
              ]
            : current.auditEvents,
        };
      });
    },
    [],
  );

  const can = useCallback(
    (permission: Permission) => hasPermission(activeRole, permission),
    [activeRole],
  );

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

  useEffect(() => {
    if (demoMode || !supabase) return undefined;
    let mounted = true;
    void supabase.auth
      .getUser()
      .then(async ({ data, error }) => {
        if (error || !data.user) {
          throw error ?? new Error("Nie udało się odczytać użytkownika.");
        }
        const access = await loadProductionOrganizations(data.user.id);
        if (!mounted) return;
        if (access.length === 0) {
          throw new Error("Użytkownik nie ma aktywnej organizacji.");
        }
        const preferred = window.localStorage.getItem(
          "mailflow-studio:active-organization",
        );
        const active =
          access.find((item) => item.organization.id === preferred) ?? access[0];
        setState((current) => ({
          ...current,
          currentUserId: data.user.id,
          activeOrganizationId: active.organization.id,
          organizations: access.map((item) => item.organization),
          memberships: access.map((item) => item.membership),
          roles: access.map((item) => item.role),
        }));
        setProductionReady(true);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        addToast({
          title: "Nie udało się uruchomić przestrzeni",
          message: error instanceof Error ? error.message : "Spróbuj ponownie.",
          tone: "error",
        });
      });
    return () => {
      mounted = false;
    };
  }, [addToast]);

  useEffect(() => {
    if (demoMode || !productionReady || activeOrganizationId === "loading") {
      return undefined;
    }
    let mounted = true;
    void loadProductionWorkspace(activeOrganizationId)
      .then((snapshot) => {
        if (!mounted) return;
        setState((current) => ({
          ...current,
          messages: snapshot.messages,
          categories: snapshot.categories,
          rules: snapshot.rules,
          sources: snapshot.sources,
          automations: snapshot.automations,
          campaigns: snapshot.campaigns,
          deliveryAccounts: snapshot.deliveryAccounts,
          templates: snapshot.templates,
          users: snapshot.users,
          memberships: [
            ...current.memberships.filter(
              (item) => item.organizationId !== activeOrganizationId,
            ),
            ...snapshot.memberships,
          ],
          roles: [
            ...current.roles.filter(
              (item) => item.organizationId !== activeOrganizationId,
            ),
            ...snapshot.roles,
          ],
          auditEvents: snapshot.auditEvents,
        }));
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        addToast({
          title: "Nie udało się pobrać danych firmy",
          message: error instanceof Error ? error.message : "Spróbuj ponownie.",
          tone: "error",
        });
      });
    return () => {
      mounted = false;
    };
  }, [activeOrganizationId, addToast, productionReady]);

  const reportApiError = useCallback(
    (title: string, error: unknown) => {
      addToast({
        title,
        message: error instanceof Error ? error.message : "Spróbuj ponownie.",
        tone: "error",
      });
    },
    [addToast],
  );

  const updateMessage = useCallback(
    (id: string, patch: Partial<EmailMessage>) => {
      if (!demoMode) {
        void api
          .patch(
            `messages/${id}`,
            {
              ...(patch.status !== undefined ? { status: patch.status } : {}),
              ...(patch.categoryId !== undefined
                ? { category_id: patch.categoryId }
                : {}),
              ...(patch.score !== undefined ? { score: patch.score } : {}),
              ...(patch.reviewReason !== undefined
                ? { review_reason: patch.reviewReason }
                : {}),
              ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
            },
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zapisać wiadomości", error),
          );
      }
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === id ? { ...message, ...patch } : message,
        ),
        auditEvents: [
          newAuditEvent(
            current.activeOrganizationId,
            "Zaktualizowano wiadomość",
            id,
            "success",
          ),
          ...current.auditEvents,
        ],
      }));
    },
    [activeOrganizationId, reportApiError],
  );

  const updateRule = useCallback(
    (id: string, patch: Partial<AutomationRule>) => {
      const currentRule = state.rules.find((rule) => rule.id === id);
      if (!demoMode && currentRule) {
        void api
          .patch(
            `rules/${id}`,
            ruleToApi({ ...currentRule, ...patch }),
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zapisać reguły", error),
          );
      }
      setState((current) => ({
        ...current,
        rules: current.rules.map((rule) =>
          rule.id === id ? { ...rule, ...patch } : rule,
        ),
        auditEvents: [
          newAuditEvent(
            current.activeOrganizationId,
            "Zaktualizowano regułę",
            String(patch.name ?? id),
          ),
          ...current.auditEvents,
        ],
      }));
    },
    [activeOrganizationId, reportApiError, state.rules],
  );

  const addRule = useCallback((rule: AutomationRule) => {
    if (!demoMode) {
      void api
        .post<Record<string, unknown>>(
          "rules",
          ruleToApi(rule),
          activeOrganizationId,
        )
        .then((saved) => {
          setState((current) => ({
            ...current,
            rules: current.rules.map((item) =>
              item.id === rule.id
                ? {
                    ...item,
                    id: String(saved.id ?? item.id),
                    version: Number(saved.current_version ?? item.version),
                  }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            rules: current.rules.filter((item) => item.id !== rule.id),
          }));
          reportApiError("Nie udało się utworzyć reguły", error);
        });
    }
    setState((current) => ({
      ...current,
      rules: [
        {
          ...rule,
          organizationId: current.activeOrganizationId,
        },
        ...current.rules,
      ],
      auditEvents: [
        newAuditEvent(
          current.activeOrganizationId,
          "Utworzono regułę",
          rule.name,
          "success",
        ),
        ...current.auditEvents,
      ],
    }));
  }, [activeOrganizationId, reportApiError]);

  const toggleSource = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === id
          ? {
              ...source,
              status: source.status === "paused" ? "active" : "paused",
            }
          : source,
      ),
    }));
  }, []);

  const addSource = useCallback((source: SourceConnector) => {
    setState((current) => ({
      ...current,
      sources: [
        {
          ...source,
          organizationId: current.activeOrganizationId,
        },
        ...current.sources,
      ],
      auditEvents: [
        newAuditEvent(
          current.activeOrganizationId,
          "Utworzono źródło danych",
          source.name,
          "success",
        ),
        ...current.auditEvents,
      ],
    }));
  }, []);

  const updateSource = useCallback(
    (id: string, patch: Partial<SourceConnector>) => {
      setState((current) => ({
        ...current,
        sources: current.sources.map((source) =>
          source.id === id ? { ...source, ...patch } : source,
        ),
        auditEvents: [
          newAuditEvent(
            current.activeOrganizationId,
            "Zmieniono konfigurację źródła",
            String(patch.name ?? id),
          ),
          ...current.auditEvents,
        ],
      }));
    },
    [],
  );

  const removeSource = useCallback((id: string) => {
    setState((current) => {
      const source = current.sources.find((item) => item.id === id);
      return {
        ...current,
        sources: current.sources.filter((item) => item.id !== id),
        auditEvents: [
          newAuditEvent(
            current.activeOrganizationId,
            "Usunięto źródło danych",
            source?.name ?? id,
            "warning",
          ),
          ...current.auditEvents,
        ],
      };
    });
  }, []);

  const toggleAutomation = useCallback((id: string) => {
    const currentAutomation = state.automations.find(
      (automation) => automation.id === id,
    );
    if (!demoMode && currentAutomation) {
      void api
        .patch(
          `automations/${id}`,
          automationToApi({
            ...currentAutomation,
            active: !currentAutomation.active,
          }),
          activeOrganizationId,
        )
        .catch((error: unknown) =>
          reportApiError("Nie udało się zmienić automatyzacji", error),
        );
    }
    setState((current) => ({
      ...current,
      automations: current.automations.map((automation) =>
        automation.id === id
          ? { ...automation, active: !automation.active }
          : automation,
      ),
    }));
  }, [activeOrganizationId, reportApiError, state.automations]);

  const addAutomation = useCallback(
    (automation: Automation) => {
      if (!demoMode) {
        void api
          .post<Record<string, unknown>>(
            "automations",
            automationToApi(automation),
            activeOrganizationId,
          )
          .then((saved) => {
            setState((current) => ({
              ...current,
              automations: current.automations.map((item) =>
                item.id === automation.id
                  ? { ...item, id: String(saved.id ?? item.id) }
                  : item,
              ),
            }));
          })
          .catch((error: unknown) => {
            setState((current) => ({
              ...current,
              automations: current.automations.filter(
                (item) => item.id !== automation.id,
              ),
            }));
            reportApiError("Nie udało się utworzyć automatyzacji", error);
          });
      }
      setState((current) => ({
        ...current,
        automations: [
          {
            ...automation,
            organizationId: current.activeOrganizationId,
          },
          ...current.automations,
        ],
      }));
    },
    [activeOrganizationId, reportApiError],
  );

  const updateAutomation = useCallback(
    (id: string, patch: Partial<Automation>) => {
      const currentAutomation = state.automations.find(
        (automation) => automation.id === id,
      );
      if (!demoMode && currentAutomation) {
        void api
          .patch(
            `automations/${id}`,
            automationToApi({ ...currentAutomation, ...patch }),
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zapisać automatyzacji", error),
          );
      }
      setState((current) => ({
        ...current,
        automations: current.automations.map((automation) =>
          automation.id === id ? { ...automation, ...patch } : automation,
        ),
      }));
    },
    [activeOrganizationId, reportApiError, state.automations],
  );

  const removeAutomation = useCallback(
    (id: string) => {
      const removed = state.automations.find(
        (automation) => automation.id === id,
      );
      if (!demoMode) {
        void api
          .delete(`automations/${id}`, activeOrganizationId)
          .catch((error: unknown) => {
            if (removed) {
              setState((current) => ({
                ...current,
                automations: [...current.automations, removed],
              }));
            }
            reportApiError("Nie udało się usunąć automatyzacji", error);
          });
      }
      setState((current) => ({
        ...current,
        automations: current.automations.filter(
          (automation) => automation.id !== id,
        ),
      }));
    },
    [activeOrganizationId, reportApiError, state.automations],
  );

  const runAutomation = useCallback(
    (id: string) => {
      if (!demoMode) {
        void api
          .post(`automations/${id}/run`, { input: {} }, activeOrganizationId)
          .catch((error: unknown) =>
            reportApiError("Nie udało się uruchomić automatyzacji", error),
          );
      }
      setState((current) => ({
        ...current,
        automations: current.automations.map((automation) =>
          automation.id === id
            ? {
                ...automation,
                runs: automation.runs + 1,
                lastRunAt: new Date().toISOString(),
              }
            : automation,
        ),
      }));
    },
    [activeOrganizationId, reportApiError],
  );

  const addCategory = useCallback((category: Category) => {
    if (!demoMode) {
      void api
        .post<Record<string, unknown>>(
          "categories",
          categoryToApi(category),
          activeOrganizationId,
        )
        .then((saved) => {
          setState((current) => ({
            ...current,
            categories: current.categories.map((item) =>
              item.id === category.id
                ? { ...item, id: String(saved.id ?? item.id) }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            categories: current.categories.filter(
              (item) => item.id !== category.id,
            ),
          }));
          reportApiError("Nie udało się utworzyć kategorii", error);
        });
    }
    setState((current) => ({
      ...current,
      categories: [
        ...current.categories,
        {
          ...category,
          organizationId: current.activeOrganizationId,
        },
      ],
      auditEvents: [
        newAuditEvent(
          current.activeOrganizationId,
          "Utworzono kategorię",
          category.name,
          "success",
        ),
        ...current.auditEvents,
      ],
    }));
  }, [activeOrganizationId, reportApiError]);

  const updateCategory = useCallback(
    (id: string, patch: Partial<Category>) => {
      const currentCategory = state.categories.find(
        (category) => category.id === id,
      );
      if (!demoMode && currentCategory) {
        void api
          .patch(
            `categories/${id}`,
            categoryToApi({ ...currentCategory, ...patch }),
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zapisać kategorii", error),
          );
      }
      setState((current) => ({
        ...current,
        categories: current.categories.map((category) =>
          category.id === id ? { ...category, ...patch } : category,
        ),
      }));
    },
    [activeOrganizationId, reportApiError, state.categories],
  );

  const removeCategory = useCallback((id: string) => {
    const removed = state.categories.find((category) => category.id === id);
    if (!demoMode) {
      void api
        .delete(`categories/${id}`, activeOrganizationId)
        .catch((error: unknown) => {
          if (removed) {
            setState((current) => ({
              ...current,
              categories: [...current.categories, removed],
            }));
          }
          reportApiError("Nie udało się usunąć kategorii", error);
        });
    }
    setState((current) => ({
      ...current,
      categories: current.categories.filter((category) => category.id !== id),
      rules: current.rules.map((rule) =>
        rule.categoryId === id ? { ...rule, categoryId: null } : rule,
      ),
    }));
  }, [activeOrganizationId, reportApiError, state.categories]);

  const addCampaign = useCallback((campaign: OutboundCampaign) => {
    if (!demoMode) {
      const status =
        campaign.status === "sending"
          ? "pending"
          : campaign.status === "sent"
            ? "pending"
            : campaign.status;
      void api
        .post<Record<string, unknown>>(
          "outbound-messages",
          {
            delivery_account_id: campaign.deliveryAccountId,
            template_id: campaign.templateId,
            subject: campaign.subject,
            text_body: campaign.textBody,
            html_body: campaign.htmlBody,
            status,
            scheduled_at: campaign.scheduledAt,
            recipients: campaign.recipientList ?? [],
            audience_definition: {
              type: "explicit",
              label: campaign.audience,
              count: campaign.recipientList?.length ?? 0,
            },
          },
          activeOrganizationId,
        )
        .then((saved) => {
          setState((current) => ({
            ...current,
            campaigns: current.campaigns.map((item) =>
              item.id === campaign.id
                ? { ...item, id: String(saved.id ?? item.id) }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            campaigns: current.campaigns.filter(
              (item) => item.id !== campaign.id,
            ),
          }));
          reportApiError("Nie udało się utworzyć wysyłki", error);
        });
    }
    setState((current) => ({
      ...current,
      campaigns: [
        {
          ...campaign,
          organizationId: current.activeOrganizationId,
        },
        ...current.campaigns,
      ],
      auditEvents: [
        newAuditEvent(
          current.activeOrganizationId,
          campaign.status === "scheduled"
            ? "Zaplanowano wysyłkę"
            : campaign.status === "draft"
              ? "Zapisano wersję roboczą"
              : "Dodano wiadomość do kolejki",
          campaign.subject,
          "success",
        ),
        ...current.auditEvents,
      ],
    }));
  }, [activeOrganizationId, reportApiError]);

  const addDeliveryAccount = useCallback((account: DeliveryAccount) => {
    setState((current) => ({
      ...current,
      deliveryAccounts: [
        { ...account, organizationId: current.activeOrganizationId },
        ...current.deliveryAccounts,
      ],
    }));
  }, []);

  const updateDeliveryAccount = useCallback(
    (id: string, patch: Partial<DeliveryAccount>) => {
      setState((current) => ({
        ...current,
        deliveryAccounts: current.deliveryAccounts.map((account) =>
          account.id === id ? { ...account, ...patch } : account,
        ),
      }));
    },
    [],
  );

  const removeDeliveryAccount = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      deliveryAccounts: current.deliveryAccounts.filter(
        (account) => account.id !== id,
      ),
    }));
  }, []);

  const addTemplate = useCallback((template: EmailTemplate) => {
    if (!demoMode) {
      void api
        .post<Record<string, unknown>>(
          "templates",
          templateToApi(template),
          activeOrganizationId,
        )
        .then((saved) => {
          setState((current) => ({
            ...current,
            templates: current.templates.map((item) =>
              item.id === template.id
                ? { ...item, id: String(saved.id ?? item.id) }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            templates: current.templates.filter(
              (item) => item.id !== template.id,
            ),
          }));
          reportApiError("Nie udało się utworzyć szablonu", error);
        });
    }
    setState((current) => ({
      ...current,
      templates: [
        {
          ...template,
          organizationId: current.activeOrganizationId,
        },
        ...current.templates,
      ],
    }));
  }, [activeOrganizationId, reportApiError]);

  const updateTemplate = useCallback(
    (id: string, patch: Partial<EmailTemplate>) => {
      const currentTemplate = state.templates.find(
        (template) => template.id === id,
      );
      if (!demoMode && currentTemplate) {
        void api
          .patch(
            `templates/${id}`,
            templateToApi({ ...currentTemplate, ...patch }),
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zapisać szablonu", error),
          );
      }
      setState((current) => ({
        ...current,
        templates: current.templates.map((template) =>
          template.id === id
            ? {
                ...template,
                ...patch,
                version:
                  patch.version ??
                  (Object.keys(patch).length > 0
                    ? template.version + 1
                    : template.version),
                updatedAt: new Date().toISOString(),
              }
            : template,
        ),
      }));
    },
    [activeOrganizationId, reportApiError, state.templates],
  );

  const removeTemplate = useCallback((id: string) => {
    const removed = state.templates.find((template) => template.id === id);
    if (!demoMode) {
      void api
        .delete(`templates/${id}`, activeOrganizationId)
        .catch((error: unknown) => {
          if (removed) {
            setState((current) => ({
              ...current,
              templates: [...current.templates, removed],
            }));
          }
          reportApiError("Nie udało się usunąć szablonu", error);
        });
    }
    setState((current) => ({
      ...current,
      templates: current.templates.filter((template) => template.id !== id),
    }));
  }, [activeOrganizationId, reportApiError, state.templates]);

  const addUser = useCallback((user: TeamUser, roleId?: string) => {
    if (!demoMode) {
      void api
        .post<Record<string, unknown>>(
          "users/invite",
          {
            email: user.email,
            full_name: user.name,
            role_id: roleId,
            role: user.role,
          },
          activeOrganizationId,
        )
        .then((membership) => {
          const serverUserId = String(membership.user_id ?? user.id);
          setState((current) => ({
            ...current,
            users: current.users.map((item) =>
              item.id === user.id ? { ...item, id: serverUserId } : item,
            ),
            memberships: current.memberships.map((item) =>
              item.organizationId === activeOrganizationId &&
              item.userId === user.id
                ? {
                    ...item,
                    userId: serverUserId,
                    roleId: String(membership.role_id ?? item.roleId),
                    status:
                      (membership.status as OrganizationMembership["status"]) ??
                      item.status,
                  }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            users: current.users.filter((item) => item.id !== user.id),
            memberships: current.memberships.filter(
              (item) =>
                !(
                  item.organizationId === activeOrganizationId &&
                  item.userId === user.id
                ),
            ),
          }));
          reportApiError("Nie udało się zaprosić użytkownika", error);
        });
    }
    setState((current) => {
      const selectedRoleId =
        roleId ??
        current.roles.find(
          (role) =>
            role.organizationId === current.activeOrganizationId &&
            role.key === user.role,
        )?.id ??
        "";
      const membership: OrganizationMembership = {
        organizationId: current.activeOrganizationId,
        userId: user.id,
        roleId: selectedRoleId,
        status: user.status,
        joinedAt: user.status === "active" ? new Date().toISOString() : null,
        invitedAt: new Date().toISOString(),
      };
      return {
        ...current,
        users: [...current.users, user],
        memberships: [...current.memberships, membership],
        auditEvents: [
          newAuditEvent(
            current.activeOrganizationId,
            "Zaproszono użytkownika",
            user.email,
            "success",
          ),
          ...current.auditEvents,
        ],
      };
    });
  }, [activeOrganizationId, reportApiError]);

  const updateMembership = useCallback(
    (userId: string, patch: Partial<OrganizationMembership>) => {
      if (!demoMode) {
        void api
          .patch(
            `users/${userId}/membership`,
            {
              ...(patch.roleId !== undefined
                ? { role_id: patch.roleId }
                : {}),
              ...(patch.status !== undefined ? { status: patch.status } : {}),
            },
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zmienić członkostwa", error),
          );
      }
      setState((current) => ({
        ...current,
        memberships: current.memberships.map((membership) =>
          membership.organizationId === current.activeOrganizationId &&
          membership.userId === userId
            ? { ...membership, ...patch }
            : membership,
        ),
      }));
    },
    [activeOrganizationId, reportApiError],
  );

  const addRole = useCallback((role: RoleDefinition) => {
    if (!demoMode) {
      void api
        .post<Record<string, unknown>>(
          "roles",
          {
            key: role.key,
            name: role.name,
            description: role.description,
            color: role.color,
            permissions: role.permissions,
          },
          activeOrganizationId,
        )
        .then((saved) => {
          setState((current) => ({
            ...current,
            roles: current.roles.map((item) =>
              item.id === role.id
                ? { ...item, id: String(saved.id ?? item.id) }
                : item,
            ),
          }));
        })
        .catch((error: unknown) => {
          setState((current) => ({
            ...current,
            roles: current.roles.filter((item) => item.id !== role.id),
          }));
          reportApiError("Nie udało się utworzyć roli", error);
        });
    }
    setState((current) => ({
      ...current,
      roles: [
        ...current.roles,
        { ...role, organizationId: current.activeOrganizationId },
      ],
    }));
  }, [activeOrganizationId, reportApiError]);

  const updateRole = useCallback(
    (id: string, patch: Partial<RoleDefinition>) => {
      const currentRole = state.roles.find((role) => role.id === id);
      if (!demoMode && currentRole) {
        const role = { ...currentRole, ...patch };
        void api
          .patch(
            `roles/${id}`,
            {
              key: role.key,
              name: role.name,
              description: role.description,
              color: role.color,
              permissions: role.permissions,
            },
            activeOrganizationId,
          )
          .catch((error: unknown) =>
            reportApiError("Nie udało się zapisać roli", error),
          );
      }
      setState((current) => ({
        ...current,
        roles: current.roles.map((role) =>
          role.id === id ? { ...role, ...patch } : role,
        ),
      }));
    },
    [activeOrganizationId, reportApiError, state.roles],
  );

  const removeRole = useCallback((id: string) => {
    const removed = state.roles.find((role) => role.id === id);
    if (!demoMode) {
      void api.delete(`roles/${id}`, activeOrganizationId).catch(
        (error: unknown) => {
          if (removed) {
            setState((current) => ({
              ...current,
              roles: [...current.roles, removed],
            }));
          }
          reportApiError("Nie udało się usunąć roli", error);
        },
      );
    }
    setState((current) => {
      const role = current.roles.find((item) => item.id === id);
      if (!role || role.builtIn) return current;
      const fallbackRole = current.roles.find(
        (item) =>
          item.organizationId === current.activeOrganizationId &&
          item.key === "viewer",
      );
      return {
        ...current,
        roles: current.roles.filter((item) => item.id !== id),
        memberships: current.memberships.map((membership) =>
          membership.roleId === id && fallbackRole
            ? { ...membership, roleId: fallbackRole.id }
            : membership,
        ),
      };
    });
  }, [activeOrganizationId, reportApiError, state.roles]);

  const resetDemoState = useCallback(() => {
    if (!demoMode) return;
    window.localStorage.removeItem(STORAGE_KEY);
    setState(createInitialState());
  }, []);

  const scopedMemberships = useMemo(
    () =>
      state.memberships.filter(
        (membership) => membership.organizationId === activeOrganizationId,
      ),
    [activeOrganizationId, state.memberships],
  );

  const scopedUsers = useMemo(
    () =>
      scopedMemberships.flatMap((membership): TeamUser[] => {
          const user = state.users.find(
            (candidate) => candidate.id === membership.userId,
          );
          if (!user) return [];
          const role = state.roles.find(
            (candidate) => candidate.id === membership.roleId,
          );
          const roleKey =
            role && builtInRoleKeys.has(role.key as UserRole)
              ? (role.key as UserRole)
              : "viewer";
          return [
            {
              ...user,
              role: roleKey,
              status: membership.status,
              membershipCount: state.memberships.filter(
                (item) => item.userId === user.id,
              ).length,
            },
          ];
        }),
    [scopedMemberships, state.memberships, state.roles, state.users],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      messages: scoped(state.messages, activeOrganizationId),
      categories: scoped(state.categories, activeOrganizationId),
      rules: scoped(state.rules, activeOrganizationId),
      sources: scoped(state.sources, activeOrganizationId),
      automations: scoped(state.automations, activeOrganizationId),
      campaigns: scoped(state.campaigns, activeOrganizationId),
      deliveryAccounts: scoped(
        state.deliveryAccounts,
        activeOrganizationId,
      ),
      templates: scoped(state.templates, activeOrganizationId),
      users: scopedUsers,
      organizations: state.organizations.filter((organization) =>
        state.memberships.some(
          (membership) =>
            membership.organizationId === organization.id &&
            membership.userId === state.currentUserId &&
            membership.status === "active",
        ),
      ),
      activeOrganization,
      activeOrganizationId,
      memberships: state.memberships,
      roles: scoped(state.roles, activeOrganizationId),
      activeRole,
      auditEvents: scoped(state.auditEvents, activeOrganizationId),
      toasts,
      setActiveOrganization,
      updateOrganization,
      can,
      updateMessage,
      updateRule,
      addRule,
      toggleSource,
      addSource,
      updateSource,
      removeSource,
      toggleAutomation,
      addAutomation,
      updateAutomation,
      removeAutomation,
      runAutomation,
      addCategory,
      updateCategory,
      removeCategory,
      addCampaign,
      addDeliveryAccount,
      updateDeliveryAccount,
      removeDeliveryAccount,
      addTemplate,
      updateTemplate,
      removeTemplate,
      addUser,
      updateMembership,
      addRole,
      updateRole,
      removeRole,
      addToast,
      dismissToast,
      resetDemoState,
    }),
    [
      activeOrganization,
      activeOrganizationId,
      activeRole,
      addAutomation,
      addCategory,
      addCampaign,
      addDeliveryAccount,
      addRole,
      addRule,
      addSource,
      addTemplate,
      addToast,
      addUser,
      can,
      dismissToast,
      removeCategory,
      removeDeliveryAccount,
      removeAutomation,
      removeRole,
      removeSource,
      removeTemplate,
      resetDemoState,
      runAutomation,
      scopedUsers,
      setActiveOrganization,
      state,
      toasts,
      toggleAutomation,
      toggleSource,
      updateCategory,
      updateAutomation,
      updateDeliveryAccount,
      updateMembership,
      updateMessage,
      updateOrganization,
      updateRole,
      updateRule,
      updateSource,
      updateTemplate,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
