import { useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  UserRoundCog,
  Users,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { formatDateTime } from "../lib/format";
import type { TeamUser, UserRole } from "../types";

const roleLabels: Record<UserRole, string> = {
  owner: "Właściciel",
  admin: "Administrator",
  operator: "Operator",
  reviewer: "Recenzent",
  viewer: "Tylko odczyt",
};

const statusLabels = {
  active: "Aktywny",
  invited: "Zaproszony",
  suspended: "Zawieszony",
};

export function UsersPage() {
  const { users, addUser, addToast } = useAppState();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("operator");

  const filteredUsers = useMemo(() => {
    const normalized = query.toLocaleLowerCase("pl").trim();
    return users.filter((user) =>
      [user.name, user.email, roleLabels[user.role]]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized),
    );
  }, [query, users]);

  const inviteUser = () => {
    if (!inviteEmail.trim()) return;
    const localName = inviteEmail.split("@")[0].replace(/[._-]/g, " ");
    const name = localName.replace(/\b\w/g, (letter) => letter.toUpperCase());
    const newUser: TeamUser = {
      id: `user-${crypto.randomUUID()}`,
      name,
      email: inviteEmail.trim(),
      initials: name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      role: inviteRole,
      status: "invited",
      lastActiveAt: new Date().toISOString(),
      twoFactorEnabled: false,
      assignedReviews: 0,
    };
    addUser(newUser);
    setInviteOpen(false);
    setInviteEmail("");
    addToast({
      title: "Zaproszenie przygotowane",
      message: `${newUser.email} otrzyma dostęp z rolą ${roleLabels[newUser.role]}.`,
      tone: "success",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <Button
            icon={Plus}
            onClick={() => setInviteOpen(true)}
            variant="primary"
          >
            Zaproś użytkownika
          </Button>
        }
        description="Role, uprawnienia, bezpieczeństwo kont i kolejki weryfikacji."
        title="Użytkownicy"
      />

      <section className="summary-strip">
        <div>
          <Users size={18} />
          <span>Użytkownicy</span>
          <strong>{users.length}</strong>
        </div>
        <div>
          <UserCheck size={18} />
          <span>Aktywni</span>
          <strong>{users.filter((user) => user.status === "active").length}</strong>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>Włączone 2FA</span>
          <strong>{users.filter((user) => user.twoFactorEnabled).length}</strong>
        </div>
        <div>
          <UserRoundCog size={18} />
          <span>Przypisane przeglądy</span>
          <strong>
            {users.reduce((sum, user) => sum + user.assignedReviews, 0)}
          </strong>
        </div>
      </section>

      <div className="users-layout">
        <section className="workspace-panel">
          <div className="workspace-panel__header">
            <div>
              <h2>Zespół</h2>
              <p>Dostęp do organizacji jest kontrolowany przez role i RLS.</p>
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
                  <th>Rola</th>
                  <th>Status</th>
                  <th>2FA</th>
                  <th>Przypisane przeglądy</th>
                  <th>Ostatnia aktywność</th>
                  <th aria-label="Akcje" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
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
                      <Badge
                        tone={
                          user.role === "owner" || user.role === "admin"
                            ? "teal"
                            : "neutral"
                        }
                      >
                        {roleLabels[user.role]}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        dot
                        tone={
                          user.status === "active"
                            ? "success"
                            : user.status === "invited"
                              ? "info"
                              : "danger"
                        }
                      >
                        {statusLabels[user.status]}
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
                    <td>{user.assignedReviews}</td>
                    <td>{formatDateTime(user.lastActiveAt)}</td>
                    <td>
                      <button className="icon-button" type="button">
                        <MoreHorizontal size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="users-rail panel">
          <div className="panel__header">
            <div>
              <h2>Macierz uprawnień</h2>
              <p>Zakres dostępu według roli.</p>
            </div>
            <KeyRound size={18} />
          </div>
          <div className="permission-matrix">
            <div className="permission-matrix__header">
              <span>Obszar</span>
              <span>Admin</span>
              <span>Operator</span>
              <span>Recenzent</span>
            </div>
            {[
              ["Wiadomości", true, true, true],
              ["Reguły", true, true, false],
              ["Wysyłka", true, true, false],
              ["Konta SMTP", true, false, false],
              ["Użytkownicy", true, false, false],
              ["Audyt", true, true, true],
            ].map(([label, admin, operator, reviewer]) => (
              <div key={label as string}>
                <span>{label as string}</span>
                {[admin, operator, reviewer].map((allowed, index) => (
                  <span key={`${label}-${index}`}>
                    {allowed ? <CheckCircle2 size={15} /> : "—"}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <Modal
        description="Użytkownik otrzyma jednorazowy link do ustawienia hasła i 2FA."
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Anuluj</Button>
            <Button
              disabled={!inviteEmail.trim()}
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
          <FormField label="Rola">
            <select
              onChange={(event) =>
                setInviteRole(event.target.value as UserRole)
              }
              value={inviteRole}
            >
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <div className="invite-permission-preview">
            <ShieldCheck size={18} />
            <div>
              <strong>Uprawnienia roli: {roleLabels[inviteRole]}</strong>
              <p>
                Zakres zostanie ograniczony przez polityki RLS organizacji i
                zapisany w dzienniku audytu.
              </p>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

