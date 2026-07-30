import type { Pal } from "../types";

interface Props {
  pal: Pal;
  selected: boolean;
  onSelect: (pal: Pal) => void;
}

export function PalCard({ pal, selected, onSelect }: Props) {
  const initials = pal.species
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <button
      type="button"
      className={selected ? "pal-card selected" : "pal-card"}
      onClick={() => onSelect(pal)}
    >
      <span className="level-badge">{pal.level}</span>

      <span className="pal-art">
        {pal.imageUrl ? (
          <img src={pal.imageUrl} alt={pal.species} />
        ) : (
          <span className="pal-fallback">{initials}</span>
        )}
      </span>

      <span className="pal-name">
        {pal.shiny && <span className="lucky-star">★ </span>}
        {pal.species}
      </span>
    </button>
  );
}
