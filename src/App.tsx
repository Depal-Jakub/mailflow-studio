import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AuthGate } from "./components/auth/AuthGate";
import { AppShell } from "./components/layout/AppShell";

const AccountsPage = lazy(() =>
  import("./pages/AccountsPage").then((module) => ({
    default: module.AccountsPage,
  })),
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((module) => ({
    default: module.AuditPage,
  })),
);
const AutomationsPage = lazy(() =>
  import("./pages/AutomationsPage").then((module) => ({
    default: module.AutomationsPage,
  })),
);
const CategoriesPage = lazy(() =>
  import("./pages/CategoriesPage").then((module) => ({
    default: module.CategoriesPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const MessagesPage = lazy(() =>
  import("./pages/MessagesPage").then((module) => ({
    default: module.MessagesPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((module) => ({
    default: module.NotFoundPage,
  })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((module) => ({
    default: module.ReportsPage,
  })),
);
const RulesPage = lazy(() =>
  import("./pages/RulesPage").then((module) => ({
    default: module.RulesPage,
  })),
);
const SendPage = lazy(() =>
  import("./pages/SendPage").then((module) => ({
    default: module.SendPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const SourcesPage = lazy(() =>
  import("./pages/SourcesPage").then((module) => ({
    default: module.SourcesPage,
  })),
);
const UsersPage = lazy(() =>
  import("./pages/UsersPage").then((module) => ({
    default: module.UsersPage,
  })),
);

export default function App() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <div className="route-loader">
            <span />
            <strong>Ładowanie modułu...</strong>
          </div>
        }
      >
        <Routes>
          <Route element={<AppShell />}>
            <Route element={<DashboardPage />} index />
            <Route element={<MessagesPage />} path="messages" />
            <Route element={<SourcesPage />} path="sources" />
            <Route element={<CategoriesPage />} path="categories" />
            <Route element={<RulesPage />} path="rules" />
            <Route element={<AutomationsPage />} path="automations" />
            <Route element={<SendPage />} path="send" />
            <Route element={<AccountsPage />} path="accounts" />
            <Route element={<UsersPage />} path="users" />
            <Route element={<ReportsPage />} path="reports" />
            <Route element={<AuditPage />} path="audit" />
            <Route element={<SettingsPage />} path="settings" />
            <Route element={<Navigate replace to="/" />} path="dashboard" />
            <Route element={<NotFoundPage />} path="*" />
          </Route>
        </Routes>
      </Suspense>
    </AuthGate>
  );
}
