import { Bell, Command, Menu, Search } from "lucide-react";
import { useLocation } from "react-router";
import { pageMetadata } from "../../lib/navigation";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation();
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
            <small>Właściciel</small>
          </span>
        </button>
      </div>
    </header>
  );
}
