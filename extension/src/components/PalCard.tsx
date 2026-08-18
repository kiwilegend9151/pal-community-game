import type { Pal } from "../types";

interface Props {
  pal: Pal;
  selected: boolean;
  onSelect: (pal: Pal) => void;
}

const palImages = import.meta.glob(
  "../assets/pals-webp/*.webp",
  {
    eager: true,
    query: "?url",
    import: "default"
  }
) as Record<string, string>;

function getPalImage(species: string): string | undefined {
  const wantedName =
    `${species.trim().replace(/\s+/g, "_")}.webp`.toLowerCase();

  const match = Object.entries(palImages).find(([path]) => {
    const fileName = path.split("/").pop()?.toLowerCase();
    return fileName === wantedName;
  });

  return match?.[1];
}

export function PalCard({ pal, selected, onSelect }: Props) {
  const initials = pal.species
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const imageUrl = getPalImage(pal.species);

  return (
    <button
      type="button"
      className={selected ? "pal-card selected" : "pal-card"}
      onClick={() => onSelect(pal)}
    >
      <span className="level-badge">{pal.level}</span>

      <span className="pal-art">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={pal.species.trim()}
          />
        ) : (
          <span className="pal-fallback">{initials}</span>
        )}
      </span>

      <span className="pal-name">
        {pal.shiny && <span className="lucky-star">★ </span>}
        {pal.species.trim()}
      </span>
    </button>
  );
}