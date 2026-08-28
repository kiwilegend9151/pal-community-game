import type { TabId } from "../types";

interface Props {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  onRefresh: () => void;
}

const items: Array<{
  id: TabId;
  image?: string;
  label: string;
}> = [
  { id: "profile", label: "Profile" },
  { id: "pals", image: "./nav/pals.webp", label: "Pals" },
  { id: "inventory", image: "./nav/inventory.webp", label: "Inventory" },
  { id: "shop", image: "./nav/shop.webp", label: "Shop" },
  { id: "expedition", image: "./nav/expedition.webp", label: "Expedition" },
  { id: "paldex", label: "Paldeck" }
];

export function TopNav({ activeTab, onChange, onRefresh }: Props) {
  return (
    <nav className="top-nav">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            activeTab === item.id
              ? "nav-button active"
              : "nav-button"
          }
          onClick={() => onChange(item.id)}
          aria-label={item.label}
          title={item.label}
        >
          {item.image ? (
            <img
              src={item.image}
              alt=""
              className="nav-button-image"
            />
          ) : (
            <span className="nav-button-placeholder">
              {item.label.charAt(0)}
            </span>
          )}

          <span className="nav-button-label">
            {item.label}
          </span>
        </button>
      ))}

      <button
        type="button"
        className="nav-button refresh-button"
        onClick={onRefresh}
        aria-label="Refresh"
        title="Refresh"
      >
        <span className="refresh-icon">↻</span>
        <span className="nav-button-label">Refresh</span>
      </button>
    </nav>
  );
}