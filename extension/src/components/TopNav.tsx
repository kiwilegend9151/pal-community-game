import type { TabId } from "../types";

interface Props {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  onRefresh: () => void;
}

const items: Array<{ id: TabId; icon: string; label: string }> = [
  { id: "profile", icon: "▣", label: "Profile" },
  { id: "pals", icon: "🐾", label: "Pals" },
  { id: "inventory", icon: "🎒", label: "Inventory" },
  { id: "paldex", icon: "▤", label: "Paldeck" }
];

export function TopNav({ activeTab, onChange, onRefresh }: Props) {
  return (
    <nav className="top-nav">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={activeTab === item.id ? "nav-button active" : "nav-button"}
          onClick={() => onChange(item.id)}
          aria-label={item.label}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}

      <button
        type="button"
        className="nav-button"
        onClick={onRefresh}
        aria-label="Refresh"
        title="Refresh"
      >
        ↻
      </button>
    </nav>
  );
}
