import { useMemo, useState } from "react";
import {
  Archive,
  Bot,
  BriefcaseBusiness,
  CircleDollarSign,
  Edit3,
  FolderKanban,
  Handshake,
  LifeBuoy,
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  Tags,
} from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useAppState } from "../lib/AppState";
import { formatNumber } from "../lib/format";
import type { Category } from "../types";

const iconMap = {
  briefcase: BriefcaseBusiness,
  "life-buoy": LifeBuoy,
  "triangle-alert": ShieldAlert,
  receipt: CircleDollarSign,
  handshake: Handshake,
  cpu: Bot,
};

const palette = [
  "#0f9f96",
  "#2563eb",
  "#ef5a4f",
  "#e5a326",
  "#8b5cf6",
  "#64748b",
  "#0f766e",
  "#c2410c",
];

export function CategoriesPage() {
  const { categories, addCategory, addToast } = useAppState();
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newColor, setNewColor] = useState(palette[0]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl");
    return categories.filter((category) =>
      [category.name, category.description]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized),
    );
  }, [categories, query]);

  const totalMessages = categories.reduce(
    (sum, category) => sum + category.messageCount,
    0,
  );

  const createCategory = () => {
    if (!newName.trim()) return;
    const category: Category = {
      id: `category-${crypto.randomUUID()}`,
      name: newName.trim(),
      description:
        newDescription.trim() || "Nowa kategoria utworzona ręcznie.",
      color: newColor,
      icon: "briefcase",
      defaultScore: 10,
      messageCount: 0,
      automationCount: 0,
      active: true,
    };
    addCategory(category);
    setModalOpen(false);
    setNewName("");
    setNewDescription("");
    addToast({
      title: "Kategoria utworzona",
      message: `${category.name} jest już dostępna w regułach i ręcznej klasyfikacji.`,
      tone: "success",
    });
  };

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Plus} onClick={() => setModalOpen(true)} variant="primary">
            Nowa kategoria
          </Button>
        }
        description="Własna taksonomia wiadomości, priorytety i domyślne zachowania."
        title="Kategorie"
      />

      <section className="summary-strip">
        <div>
          <FolderKanban size={18} />
          <span>Wszystkie kategorie</span>
          <strong>{categories.length}</strong>
        </div>
        <div>
          <Archive size={18} />
          <span>Sklasyfikowane wiadomości</span>
          <strong>{formatNumber(totalMessages)}</strong>
        </div>
        <div>
          <Bot size={18} />
          <span>Powiązane automatyzacje</span>
          <strong>
            {categories.reduce(
              (sum, category) => sum + category.automationCount,
              0,
            )}
          </strong>
        </div>
        <div>
          <Tags size={18} />
          <span>Aktywne</span>
          <strong>{categories.filter((category) => category.active).length}</strong>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel__header">
          <div>
            <h2>Taksonomia wiadomości</h2>
            <p>Kategorie są dostępne w filtrach, regułach, raportach i wysyłce.</p>
          </div>
          <label className="search-field search-field--compact">
            <Search size={15} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj kategorii..."
              value={query}
            />
          </label>
        </div>

        <div className="category-grid">
          {filtered.map((category) => {
            const Icon =
              iconMap[category.icon as keyof typeof iconMap] ?? FolderKanban;
            const share = totalMessages
              ? (category.messageCount / totalMessages) * 100
              : 0;
            return (
              <article className="category-card" key={category.id}>
                <header>
                  <span
                    className="category-card__icon"
                    style={{
                      backgroundColor: `${category.color}16`,
                      color: category.color,
                    }}
                  >
                    <Icon size={20} />
                  </span>
                  <Badge dot tone={category.active ? "success" : "neutral"}>
                    {category.active ? "Aktywna" : "Wyłączona"}
                  </Badge>
                  <button aria-label="Więcej opcji" className="icon-button" type="button">
                    <MoreHorizontal size={17} />
                  </button>
                </header>
                <div className="category-card__copy">
                  <h3>{category.name}</h3>
                  <p>{category.description}</p>
                </div>
                <div className="category-card__stats">
                  <div>
                    <span>Wiadomości</span>
                    <strong>{formatNumber(category.messageCount)}</strong>
                  </div>
                  <div>
                    <span>Automatyzacje</span>
                    <strong>{category.automationCount}</strong>
                  </div>
                  <div>
                    <span>Domyślny score</span>
                    <strong>+{category.defaultScore}</strong>
                  </div>
                </div>
                <div className="category-card__share">
                  <span>
                    Udział w całej bazie <b>{share.toFixed(1)}%</b>
                  </span>
                  <div>
                    <span
                      style={{
                        backgroundColor: category.color,
                        width: `${Math.max(share, 2)}%`,
                      }}
                    />
                  </div>
                </div>
                <footer>
                  <Button icon={Edit3} size="sm">
                    Edytuj zasady
                  </Button>
                  <Button icon={Bot} size="sm" variant="ghost">
                    Automatyzacje
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      <Modal
        description="Kategorie można później wykorzystać w warunkach, automatyzacjach i raportach."
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Anuluj</Button>
            <Button
              disabled={!newName.trim()}
              onClick={createCategory}
              variant="primary"
            >
              Utwórz kategorię
            </Button>
          </>
        }
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        title="Nowa kategoria"
      >
        <div className="form-stack">
          <FormField label="Nazwa kategorii">
            <input
              autoFocus
              onChange={(event) => setNewName(event.target.value)}
              placeholder="np. Rekrutacja"
              value={newName}
            />
          </FormField>
          <FormField label="Opis">
            <textarea
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="Jakie wiadomości powinny trafiać do tej kategorii?"
              rows={3}
              value={newDescription}
            />
          </FormField>
          <FormField label="Kolor">
            <div className="color-picker">
              {palette.map((color) => (
                <button
                  aria-label={`Wybierz kolor ${color}`}
                  className={newColor === color ? "is-selected" : ""}
                  key={color}
                  onClick={() => setNewColor(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
            </div>
          </FormField>
          <div className="form-grid form-grid--two">
            <FormField label="Domyślny score">
              <input defaultValue="10" max="100" min="0" type="number" />
            </FormField>
            <FormField label="Status">
              <select defaultValue="active">
                <option value="active">Aktywna</option>
                <option value="draft">Wersja robocza</option>
              </select>
            </FormField>
          </div>
        </div>
      </Modal>
    </>
  );
}

