import { Bell, Building2, Command, Menu, Search } from "lucide-react";
import { useLocation } from "react-router";
import { pageMetadata } from "../../lib/navigation";
import { useAppState } from "../../lib/AppState";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation();
  const {
    activeOrganization,
    activeRole,
    organizations,
    setActiveOrganization,
  } = useAppState();
  const metadata =
    pageMetadata.get(location.pathname as never) ?? pageMetadata.get("/");

  return (
    <header className="topbar">
      <div className="topbar__context">
        <button
          aria-label="Otwórz menu"
          className="icon-button topbar__menu"
          onClick={onMenuClick}
          type="button"
        >
          <Menu size={20} />
        </button>
        <div>
          <strong>{metadata?.label}</strong>
          <span>{metadata?.description}</span>
        </div>
      </div>

      <div className="topbar__tools">
        <label className="organization-switcher">
          <Building2 size={16} />
          <span>
            <small>Organizacja</small>
            <select
              aria-label="Aktywna organizacja"
              onChange={(event) => setActiveOrganization(event.target.value)}
              value={activeOrganization.id}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <button className="command-search" type="button">
          <Search size={16} />
          <span>Szukaj w aplikacji...</span>
          <kbd>
            <Command size={12} /> K
          </kbd>
        </button>
        <button aria-label="Powiadomienia" className="icon-button" type="button">
          <Bell size={18} />
          <span className="notification-count">3</span>
        </button>
        <button className="profile-button" type="button">
          <span className="profile-button__avatar">JK</span>
          <span className="profile-button__copy">
            <strong>Jakub</strong>
            <small>{activeRole?.name ?? "Brak roli"}</small>
          </span>
        </button>
      </div>
    </header>
  );
}
