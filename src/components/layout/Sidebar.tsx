import { ChevronLeft, Database, Sparkles } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "../../lib/format";
import { navigationItems } from "../../lib/navigation";

export function Sidebar({
  collapsed,
  mobileOpen,
  onCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <div
        className={cn("sidebar-scrim", mobileOpen && "sidebar-scrim--visible")}
        onClick={onNavigate}
        role="presentation"
      />
      <aside
        className={cn(
          "sidebar",
          collapsed && "sidebar--collapsed",
          mobileOpen && "sidebar--mobile-open",
        )}
      >
        <div className="sidebar__brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <Sparkles size={13} />
          </div>
          <div className="sidebar__brand-copy">
            <strong>MailFlow Studio</strong>
            <span>Automation workspace</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Główna nawigacja">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                className={({ isActive }) =>
                  cn("nav-item", isActive && "nav-item--active")
                }
                end={item.path === "/"}
                key={item.path}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                to={item.path}
              >
                <span className="nav-item__icon">
                  <Icon size={18} strokeWidth={1.9} />
                </span>
                <span className="nav-item__copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="workspace-usage">
            <Database size={17} />
            <div>
              <strong>Przestrzeń robocza</strong>
              <span>68% limitu przetwarzania</span>
              <div className="workspace-usage__track">
                <span style={{ width: "68%" }} />
              </div>
            </div>
          </div>
          <button
            aria-label={collapsed ? "Rozwiń menu" : "Zwiń menu"}
            className="sidebar__collapse"
            onClick={onCollapse}
            type="button"
          >
            <ChevronLeft size={17} />
            <span>Zwiń menu</span>
          </button>
        </div>
      </aside>
    </>
  );
}
