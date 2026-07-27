import type { Permission, RoleDefinition, UserRole } from "../types";

export const permissionGroups: Array<{
  key: string;
  label: string;
  description: string;
  permissions: Array<{ key: Permission; label: string }>;
}> = [
  {
    key: "messages",
    label: "Wiadomości",
    description: "Podgląd, klasyfikacja, przypisania i eksport.",
    permissions: [
      { key: "messages.view", label: "Wyświetlanie wiadomości" },
      { key: "messages.classify", label: "Klasyfikowanie i zmiana score" },
      { key: "messages.assign", label: "Przypisywanie do użytkowników" },
      { key: "messages.export", label: "Eksport danych" },
    ],
  },
  {
    key: "configuration",
    label: "Konfiguracja przepływu",
    description: "Źródła, kategorie, reguły i automatyzacje.",
    permissions: [
      { key: "sources.view", label: "Wyświetlanie źródeł" },
      { key: "sources.test", label: "Testowanie i synchronizacja źródeł" },
      { key: "sources.manage", label: "Dodawanie i edycja źródeł" },
      { key: "categories.view", label: "Wyświetlanie kategorii" },
      { key: "categories.manage", label: "Zarządzanie kategoriami" },
      { key: "rules.view", label: "Wyświetlanie reguł" },
      { key: "rules.manage", label: "Edycja reguł" },
      { key: "rules.publish", label: "Publikowanie reguł" },
      { key: "automations.view", label: "Wyświetlanie automatyzacji" },
      { key: "automations.manage", label: "Zarządzanie automatyzacjami" },
    ],
  },
  {
    key: "delivery",
    label: "Wysyłka",
    description: "Kampanie, szablony i konta nadawcze.",
    permissions: [
      { key: "send.view", label: "Historia wysyłek" },
      { key: "send.compose", label: "Tworzenie wiadomości" },
      { key: "send.schedule", label: "Planowanie wysyłki" },
      { key: "send.approve", label: "Zatwierdzanie i wysyłanie" },
      { key: "templates.view", label: "Wyświetlanie szablonów" },
      { key: "templates.manage", label: "Zarządzanie szablonami" },
      { key: "accounts.view", label: "Wyświetlanie kont pocztowych" },
      { key: "accounts.manage", label: "Zarządzanie kontami i sekretami" },
    ],
  },
  {
    key: "developers",
    label: "API dla deweloperów",
    description: "Klucze integracyjne, zakresy i monitoring użycia.",
    permissions: [
      { key: "api_keys.view", label: "Wyświetlanie kluczy i użycia API" },
      { key: "api_keys.manage", label: "Tworzenie, rotacja i unieważnianie kluczy" },
    ],
  },
  {
    key: "administration",
    label: "Administracja",
    description: "Zespół, audyt, ustawienia i organizacja.",
    permissions: [
      { key: "users.view", label: "Wyświetlanie zespołu" },
      { key: "users.invite", label: "Zapraszanie użytkowników" },
      { key: "users.manage", label: "Zarządzanie członkostwami" },
      { key: "roles.manage", label: "Tworzenie ról i uprawnień" },
      { key: "reports.view", label: "Wyświetlanie raportów" },
      { key: "reports.export", label: "Eksport raportów" },
      { key: "audit.view", label: "Wyświetlanie audytu" },
      { key: "settings.view", label: "Wyświetlanie ustawień" },
      { key: "settings.manage", label: "Zmiana ustawień" },
      { key: "organization.manage", label: "Zarządzanie organizacją" },
      { key: "organization.billing", label: "Rozliczenia organizacji" },
    ],
  },
];

export const allPermissions = [
  "dashboard.view",
  ...permissionGroups.flatMap((group) =>
    group.permissions.map((permission) => permission.key),
  ),
] as Permission[];

const without = (...excluded: Permission[]) =>
  allPermissions.filter((permission) => !excluded.includes(permission));

export const builtInPermissions: Record<UserRole, Permission[]> = {
  owner: allPermissions,
  admin: without("organization.billing"),
  operator: [
    "dashboard.view",
    "messages.view",
    "messages.classify",
    "messages.assign",
    "messages.export",
    "sources.view",
    "sources.test",
    "categories.view",
    "categories.manage",
    "rules.view",
    "rules.manage",
    "automations.view",
    "automations.manage",
    "send.view",
    "send.compose",
    "send.schedule",
    "templates.view",
    "accounts.view",
    "users.view",
    "reports.view",
    "audit.view",
    "api_keys.view",
    "settings.view",
  ],
  reviewer: [
    "dashboard.view",
    "messages.view",
    "messages.classify",
    "messages.assign",
    "categories.view",
    "rules.view",
    "automations.view",
    "send.view",
    "templates.view",
    "accounts.view",
    "users.view",
    "reports.view",
    "audit.view",
    "api_keys.view",
    "settings.view",
  ],
  viewer: [
    "dashboard.view",
    "messages.view",
    "sources.view",
    "categories.view",
    "rules.view",
    "automations.view",
    "send.view",
    "templates.view",
    "accounts.view",
    "users.view",
    "reports.view",
    "audit.view",
    "api_keys.view",
    "settings.view",
  ],
};

const roleMeta: Record<
  UserRole,
  Pick<RoleDefinition, "name" | "description" | "color">
> = {
  owner: {
    name: "Właściciel",
    description: "Pełny dostęp, rozliczenia i zarządzanie organizacją.",
    color: "#08736f",
  },
  admin: {
    name: "Administrator",
    description: "Pełna konfiguracja operacyjna bez rozliczeń.",
    color: "#2563eb",
  },
  operator: {
    name: "Operator",
    description: "Codzienna obsługa wiadomości, reguł i wysyłek.",
    color: "#8b5cf6",
  },
  reviewer: {
    name: "Recenzent",
    description: "Weryfikacja klasyfikacji i kolejek wymagających decyzji.",
    color: "#e5a326",
  },
  viewer: {
    name: "Tylko odczyt",
    description: "Bezpieczny dostęp do danych i raportów bez edycji.",
    color: "#64748b",
  },
};

export function createBuiltInRoles(
  organizationId: string,
): RoleDefinition[] {
  return (Object.keys(roleMeta) as UserRole[]).map((key) => ({
    id: `role-${organizationId}-${key}`,
    organizationId,
    key,
    name: roleMeta[key].name,
    description: roleMeta[key].description,
    color: roleMeta[key].color,
    builtIn: true,
    permissions: builtInPermissions[key],
    memberCount: 0,
  }));
}

export function hasPermission(
  role: RoleDefinition | undefined,
  permission: Permission,
) {
  return Boolean(role?.permissions.includes(permission));
}
