import {
  Activity,
  Bot,
  Boxes,
  ChartNoAxesCombined,
  FileSearch,
  FolderKanban,
  Gauge,
  History,
  Mail,
  Send,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";

export const navigationItems = [
  { label: "Pulpit", path: "/", icon: Gauge, description: "Centrum operacyjne" },
  {
    label: "Wiadomości",
    path: "/messages",
    icon: Mail,
    description: "Poczta i klasyfikacja",
  },
  {
    label: "Źródła i scraping",
    path: "/sources",
    icon: FileSearch,
    description: "Kanały wejściowe",
  },
  {
    label: "Kategorie",
    path: "/categories",
    icon: FolderKanban,
    description: "Taksonomia wiadomości",
  },
  {
    label: "Reguły i scoring",
    path: "/rules",
    icon: SlidersHorizontal,
    description: "Warunki i ocena",
  },
  {
    label: "Automatyzacje",
    path: "/automations",
    icon: Bot,
    description: "Przepływy pracy",
  },
  {
    label: "Wysyłka",
    path: "/send",
    icon: Send,
    description: "SMTP i kampanie",
  },
  {
    label: "Skrzynki i SMTP",
    path: "/accounts",
    icon: Boxes,
    description: "Konta i połączenia",
  },
  {
    label: "Użytkownicy",
    path: "/users",
    icon: Users,
    description: "Zespół i role",
  },
  {
    label: "Raporty",
    path: "/reports",
    icon: ChartNoAxesCombined,
    description: "Wyniki i jakość",
  },
  {
    label: "Dziennik zdarzeń",
    path: "/audit",
    icon: History,
    description: "Pełny audyt",
  },
  {
    label: "Ustawienia",
    path: "/settings",
    icon: Settings,
    description: "Konfiguracja systemu",
  },
] as const;

export const pageMetadata = new Map(
  navigationItems.map((item) => [item.path, item]),
);

export const healthIcon = Activity;

