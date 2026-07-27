import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserRoundCog,
  Users,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { formatDateTime } from "../lib/format";
import { permissionGroups } from "../lib/permissions";
import type {
  Permission,
  RoleDefinition,
  TeamUser,
  UserRole,
} from "../types";

const statusLabels = {
  active: "Aktywny",
  invited: "Zaproszony",
  suspended: "Zawieszony",
};

const roleFallback: Record<UserRole, string> = {
  owner: "Właściciel",
  admin: "Administrator",
  operator: "Operator",
  reviewer: "Recenzent",
  viewer: "Tylko odczyt",
};

const createRoleDraft = (
  organizationId: string,
  source?: RoleDefinition,
): RoleDefinition => ({
  id: `role-${crypto.randomUUID()}`,
  organizationId,
  key: source ? `${source.key}_copy` : "custom_role",
  name: source ? `Kopia: ${source.name}` : "Nowa rola",
  description: source?.description ?? "Własny zestaw uprawnień zespołu.",
  color: source?.color ?? "#0f9f96",
  builtIn: false,
  permissions: source?.permissions ?? [
    "dashboard.view",
    "messages.view",
    "categories.view",
    "reports.view",
  ],
  memberCount: 0,
});

export function UsersPage() {
  const {
    users,
    roles,
    memberships,
    organizations,
    activeOrganization,
    activeOrganizationId,
    addUser,
    updateMembership,
    addRole,
    updateRole,
    removeRole,
    addToast,
  } = useAppState();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState(
    roles.find((role) => role.key === "operator")?.id ?? roles[0]?.id ?? "",
  );
  const [selectedUser, setSelectedUser] = useState<TeamUser | null>(null);
  const [selectedUserRoleId, setSelectedUserRoleId] = useState("");
  const [selectedUserStatus, setSelectedUserStatus] =
    useState<"active" | "invited" | "suspended">("active");
  const [roleDraft, setRoleDraft] = useState<RoleDefinition | null>(
    roles[0] ? structuredClone(roles[0]) : null,
  );

  const membershipByUser = useMemo(
    () =>
      new Map(
        memberships
          .filter(
            (membership) =>
              membership.organizationId === activeOrganizationId,
          )
          .map((membership) => [membership.userId, membership]),
      ),
    [activeOrganizationId, memberships],
  );

  const filteredUsers = useMemo(() => {
    const normalized = query.toLocaleLowerCase("pl").trim();
    return users.filter((user) => {
      const membership = membershipByUser.get(user.id);
      const role = roles.find((item) => item.id === membership?.roleId);
      return [user.name, user.email, role?.name ?? roleFallback[user.role]]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized);
    });
  }, [membershipByUser, query, roles, users]);

  const inviteUser = () => {
    if (!inviteEmail.trim() || !inviteRoleId) return;
    const localName = inviteEmail.split("@")[0].replace(/[._-]/g, " ");
    const name = localName.replace(/\b\w/g, (letter) => letter.toUpperCase());
    const role = roles.find((item) => item.id === inviteRoleId);
    const builtInRole = ["owner", "admin", "operator", "reviewer", "viewer"].includes(
      role?.key ?? "",
    )
      ? (role?.key as UserRole)
      : "viewer";
    const newUser: TeamUser = {
      id: `user-${crypto.randomUUID()}`,
      name,
      email: inviteEmail.trim().toLowerCase(),
      initials: name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      role: builtInRole,
      status: "invited",
      lastActiveAt: new Date().toISOString(),
      twoFactorEnabled: false,
      assignedReviews: 0,
      membershipCount: 1,
    };
    addUser(newUser, inviteRoleId);
    setInviteOpen(false);
    setInviteEmail("");
    addToast({
      title: "Zaproszenie przygotowane",
      message: `${newUser.email} otrzyma rolę ${role?.name ?? "użytkownika"} w ${activeOrganization.name}.`,
      tone: "success",
    });
  };

  const openUser = (user: TeamUser) => {
    const membership = membershipByUser.get(user.id);
    setSelectedUser(user);
    setSelectedUserRoleId(membership?.roleId ?? roles[0]?.id ?? "");
    setSelectedUserStatus(membership?.status ?? "active");
  };

  const saveUserMembership = () => {
    if (!selectedUser) return;
    updateMembership(selectedUser.id, {
      roleId: selectedUserRoleId,
      status: selectedUserStatus,
    });
    setSelectedUser(null);
    addToast({
      title: "Dostęp użytkownika zapisany",
      message: "Nowa rola i status obowiązują w aktywnej organizacji.",
      tone: "success",
    });
  };

  const saveRole = () => {
    if (!roleDraft?.name.trim()) return;
    const existing = roles.find((role) => role.id === roleDraft.id);
    if (existing) {
      if (existing.builtIn) {
        addToast({
          title: "Rola systemowa jest chroniona",
          message: "Skopiuj ją, aby utworzyć własny wariant uprawnień.",
          tone: "warning",
        });
        return;
      }
      updateRole(roleDraft.id, roleDraft);
    } else {
      addRole(roleDraft);
    }
    addToast({
      title: "Rola zapisana",
      message: `${roleDraft.name} ma ${roleDraft.permissions.length} uprawnień.`,
      tone: "success",
    });
  };

  const togglePermission = (permission: Permission) => {
    if (!roleDraft || roleDraft.builtIn) return;
    setRoleDraft((current) =>
      current
        ? {
            ...current,
            permissions: current.permissions.includes(permission)
              ? current.permissions.filter((item) => item !== permission)
              : [...current.permissions, permission],
          }
        : current,
    );
  };

  const activeMemberships = memberships.filter(
    (membership) =>
      membership.organizationId === activeOrganizationId &&
      membership.status === "active",
  );
  const twoFactorCount = users.filter(
    (user) =>
      membershipByUser.has(user.id) && user.twoFactorEnabled,
  ).length;

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button
              icon={KeyRound}
              onClick={() => {
                setRoleDraft(
                  roles[0] ? structuredClone(roles[0]) : null,
                );
                setRolesOpen(true);
              }}
            >
              Zarządzaj rolami
            </Button>
            <Button
              icon={Plus}
              onClick={() => setInviteOpen(true)}
              variant="primary"
            >
              Zaproś użytkownika
            </Button>
          </>
        }
        description={`Role i uprawnienia są przypisywane osobno w organizacji ${activeOrganization.name}.`}
        title="Użytkownicy"
      />

      <section className="summary-strip">
        <div>
          <Users size={18} />
          <span>Członkowie organizacji</span>
          <strong>{users.length}</strong>
        </div>
        <div>
          <UserCheck size={18} />
          <span>Aktywni</span>
          <strong>{activeMemberships.length}</strong>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>Włączone 2FA</span>
          <strong>{twoFactorCount}</strong>
        </div>
        <div>
          <UserRoundCog size={18} />
          <span>Role w organizacji</span>
          <strong>{roles.length}</strong>
        </div>
      </section>

      <div className="users-layout">
        <section className="workspace-panel">
          <div className="workspace-panel__header">
            <div>
              <h2>Zespół</h2>
              <p>
                Ta sama osoba może mieć inną rolę w każdej dostępnej firmie.
              </p>
            </div>
            <label className="search-field search-field--compact">
              <Search size={15} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj użytkownika..."
                value={query}
              />
            </label>
          </div>

          <div className="table-wrap">
            <table className="data-table users-table">
              <thead>
                <tr>
                  <th>Użytkownik</th>
                  <th>Rola w tej firmie</th>
                  <th>Status</th>
                  <th>2FA</th>
                  <th>Firmy</th>
                  <th>Przypisane przeglądy</th>
                  <th>Ostatnia aktywność</th>
                  <th aria-label="Akcje" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const membership = membershipByUser.get(user.id);
                  const role = roles.find(
                    (item) => item.id === membership?.roleId,
                  );
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="user-identity">
                          <span>{user.initials}</span>
                          <div>
                            <strong>{user.name}</strong>
                            <small>{user.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={role?.builtIn ? "teal" : "info"}>
                          {role?.name ?? roleFallback[user.role]}
                        </Badge>
                      </td>
                      <td>
                        <Badge
                          dot
                          tone={
                            membership?.status === "active"
                              ? "success"
                              : membership?.status === "invited"
                                ? "info"
                                : "danger"
                          }
                        >
                          {statusLabels[membership?.status ?? user.status]}
                        </Badge>
                      </td>
                      <td>
                        {user.twoFactorEnabled ? (
                          <span className="security-state security-state--enabled">
                            <ShieldCheck size={15} /> Włączone
                          </span>
                        ) : (
                          <span className="security-state">
                            <Shield size={15} /> Wyłączone
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone="neutral">
                          {memberships.filter(
                            (item) => item.userId === user.id,
                          ).length}
                        </Badge>
                      </td>
                      <td>{user.assignedReviews}</td>
                      <td>{formatDateTime(user.lastActiveAt)}</td>
                      <td>
                        <button
                          aria-label={`Zarządzaj ${user.name}`}
                          className="icon-button"
                          onClick={() => openUser(user)}
                          type="button"
                        >
                          <UserRoundCog size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="users-rail panel">
          <div className="panel__header">
            <div>
              <h2>Role w tej firmie</h2>
              <p>Liczba członków i zakres dostępu.</p>
            </div>
            <KeyRound size={18} />
          </div>
          <div className="role-summary-list">
            {roles.map((role) => {
              const count = memberships.filter(
                (membership) =>
                  membership.organizationId === activeOrganizationId &&
                  membership.roleId === role.id,
              ).length;
              return (
                <button
                  key={role.id}
                  onClick={() => {
                    setRoleDraft(structuredClone(role));
                    setRolesOpen(true);
                  }}
                  type="button"
                >
                  <i style={{ backgroundColor: role.color }} />
                  <span>
                    <strong>{role.name}</strong>
                    <small>{role.permissions.length} uprawnień</small>
                  </span>
                  <b>{count}</b>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <Modal
        description={`Użytkownik otrzyma dostęp wyłącznie do organizacji ${activeOrganization.name}.`}
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Anuluj</Button>
            <Button
              disabled={!inviteEmail.trim() || !inviteRoleId}
              onClick={inviteUser}
              variant="primary"
            >
              Wyślij zaproszenie
            </Button>
          </>
        }
        onClose={() => setInviteOpen(false)}
        open={inviteOpen}
        title="Zaproś użytkownika"
      >
        <div className="form-stack">
          <FormField label="Adres e-mail">
            <input
              autoFocus
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="operator@example.com"
              type="email"
              value={inviteEmail}
            />
          </FormField>
          <FormField label="Rola w tej organizacji">
            <select
              onChange={(event) => setInviteRoleId(event.target.value)}
              value={inviteRoleId}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} · {role.permissions.length} uprawnień
                </option>
              ))}
            </select>
          </FormField>
          <div className="invite-permission-preview">
            <ShieldCheck size={18} />
            <div>
              <strong>
                {roles.find((role) => role.id === inviteRoleId)?.name}
              </strong>
              <p>
                Dostęp będzie egzekwowany w API i politykach RLS dla każdego
                rekordu z organization_id.
              </p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        description="Zmiana dotyczy tylko aktywnej firmy. Pozostałe członkostwa użytkownika nie zostaną zmienione."
        footer={
          <>
            <Button onClick={() => setSelectedUser(null)}>Anuluj</Button>
            <Button onClick={saveUserMembership} variant="primary">
              Zapisz dostęp
            </Button>
          </>
        }
        onClose={() => setSelectedUser(null)}
        open={Boolean(selectedUser)}
        size="lg"
        title="Dostęp użytkownika"
      >
        {selectedUser ? (
          <div className="user-access-editor">
            <div className="user-access-editor__identity">
              <span>{selectedUser.initials}</span>
              <div>
                <strong>{selectedUser.name}</strong>
                <small>{selectedUser.email}</small>
              </div>
            </div>
            <div className="form-grid form-grid--two">
              <FormField label={`Rola w ${activeOrganization.name}`}>
                <select
                  onChange={(event) =>
                    setSelectedUserRoleId(event.target.value)
                  }
                  value={selectedUserRoleId}
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Status członkostwa">
                <select
                  onChange={(event) =>
                    setSelectedUserStatus(
                      event.target.value as typeof selectedUserStatus,
                    )
                  }
                  value={selectedUserStatus}
                >
                  <option value="active">Aktywny</option>
                  <option value="invited">Zaproszony</option>
                  <option value="suspended">Zawieszony</option>
                </select>
              </FormField>
            </div>
            <section className="cross-organization-access">
              <h3>Dostęp w pozostałych firmach</h3>
              {memberships
                .filter(
                  (membership) =>
                    membership.userId === selectedUser.id &&
                    membership.organizationId !== activeOrganizationId,
                )
                .map((membership) => {
                  const organization = organizations.find(
                    (item) => item.id === membership.organizationId,
                  );
                  const role = roles.find(
                    (item) => item.id === membership.roleId,
                  );
                  return (
                    <div key={membership.organizationId}>
                      <span>
                        <strong>{organization?.name ?? "Inna organizacja"}</strong>
                        <small>{role?.name ?? "Rola z innej organizacji"}</small>
                      </span>
                      <Badge tone="neutral">
                        {statusLabels[membership.status]}
                      </Badge>
                    </div>
                  );
                })}
              {!memberships.some(
                (membership) =>
                  membership.userId === selectedUser.id &&
                  membership.organizationId !== activeOrganizationId,
              ) ? (
                <p>Użytkownik nie ma dostępu do innych organizacji.</p>
              ) : null}
            </section>
          </div>
        ) : null}
      </Modal>

      <Drawer
        footer={
          <>
            <Button onClick={() => setRolesOpen(false)}>Zamknij</Button>
            <Button
              disabled={!roleDraft || roleDraft.builtIn}
              onClick={saveRole}
              variant="primary"
            >
              Zapisz rolę
            </Button>
          </>
        }
        onClose={() => setRolesOpen(false)}
        open={rolesOpen}
        subtitle="Uprawnienia są sprawdzane dla konkretnej organizacji przy każdym żądaniu."
        size="lg"
        title="Role i uprawnienia"
      >
        <div className="role-manager">
          <div className="role-manager__list">
            <Button
              icon={Plus}
              onClick={() =>
                setRoleDraft(createRoleDraft(activeOrganizationId))
              }
              size="sm"
              variant="primary"
            >
              Nowa rola
            </Button>
            {roles.map((role) => (
              <button
                className={roleDraft?.id === role.id ? "is-selected" : ""}
                key={role.id}
                onClick={() => setRoleDraft(structuredClone(role))}
                type="button"
              >
                <i style={{ backgroundColor: role.color }} />
                <span>
                  <strong>{role.name}</strong>
                  <small>
                    {role.builtIn ? "systemowa" : "własna"} ·{" "}
                    {role.permissions.length}
                  </small>
                </span>
              </button>
            ))}
          </div>

          {roleDraft ? (
            <div className="role-manager__editor">
              <header>
                <div>
                  <h3>{roleDraft.name}</h3>
                  <p>
                    {roleDraft.builtIn
                      ? "Rola systemowa jest tylko do odczytu. Utwórz kopię, aby ją zmienić."
                      : "Zaznacz dokładnie te działania, które użytkownik może wykonać."}
                  </p>
                </div>
                <Button
                  icon={Copy}
                  onClick={() =>
                    setRoleDraft(
                      createRoleDraft(activeOrganizationId, roleDraft),
                    )
                  }
                  size="sm"
                >
                  Utwórz kopię
                </Button>
              </header>
              <div className="form-grid form-grid--two">
                <FormField label="Nazwa roli">
                  <input
                    disabled={roleDraft.builtIn}
                    onChange={(event) =>
                      setRoleDraft((current) =>
                        current
                          ? { ...current, name: event.target.value }
                          : current,
                      )
                    }
                    value={roleDraft.name}
                  />
                </FormField>
                <FormField label="Kolor">
                  <input
                    disabled={roleDraft.builtIn}
                    onChange={(event) =>
                      setRoleDraft((current) =>
                        current
                          ? { ...current, color: event.target.value }
                          : current,
                      )
                    }
                    type="color"
                    value={roleDraft.color}
                  />
                </FormField>
              </div>
              <FormField label="Opis">
                <textarea
                  disabled={roleDraft.builtIn}
                  onChange={(event) =>
                    setRoleDraft((current) =>
                      current
                        ? { ...current, description: event.target.value }
                        : current,
                    )
                  }
                  rows={2}
                  value={roleDraft.description}
                />
              </FormField>

              <div className="permission-editor">
                {permissionGroups.map((group) => (
                  <section key={group.key}>
                    <header>
                      <div>
                        <h4>{group.label}</h4>
                        <p>{group.description}</p>
                      </div>
                      <span>
                        {
                          group.permissions.filter((permission) =>
                            roleDraft.permissions.includes(permission.key),
                          ).length
                        }
                        /{group.permissions.length}
                      </span>
                    </header>
                    <div>
                      {group.permissions.map((permission) => {
                        const checked = roleDraft.permissions.includes(
                          permission.key,
                        );
                        return (
                          <label key={permission.key}>
                            <input
                              checked={checked}
                              disabled={roleDraft.builtIn}
                              onChange={() =>
                                togglePermission(permission.key)
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong>{permission.label}</strong>
                              <code>{permission.key}</code>
                            </span>
                            {checked ? <Check size={15} /> : null}
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              {!roleDraft.builtIn &&
              roles.some((role) => role.id === roleDraft.id) ? (
                <Button
                  icon={Trash2}
                  onClick={() => {
                    removeRole(roleDraft.id);
                    setRoleDraft(
                      roles.find((role) => role.id !== roleDraft.id) ?? null,
                    );
                  }}
                  size="sm"
                  variant="danger"
                >
                  Usuń rolę
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
