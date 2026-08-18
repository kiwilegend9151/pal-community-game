import type { Pal } from "../types";
import { getPalImage } from "../utils/palImages";
import { getTypeImage } from "../utils/typeImages";

interface Props {
  pal: Pal | null;
  onClose: () => void;
}

export function PalModal({ pal, onClose }: Props) {
  if (!pal) return null;
const imageUrl = getPalImage(pal.species);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="pal-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

<div className="modal-art">
  {imageUrl ? (
    <img
      src={imageUrl}
      alt={pal.species.trim()}
      className="modal-pal-image"
    />
  ) : (
    <span>{pal.species.trim().slice(0, 2).toUpperCase()}</span>
  )}
</div>

        <h2>{pal.shiny && <span className="lucky-star">★ </span>}{pal.species}</h2>
        <p className="modal-level">Level {pal.level}</p>

<div className="type-row">
  {pal.type1 && (
    <span className="type-badge">
      {getTypeImage(pal.type1) && (
        <img
          src={getTypeImage(pal.type1)}
          alt=""
          className="type-icon"
        />
      )}
      {pal.type1}
    </span>
  )}

  {pal.type2 && (
    <span className="type-badge">
      {getTypeImage(pal.type2) && (
        <img
          src={getTypeImage(pal.type2)}
          alt=""
          className="type-icon"
        />
      )}
      {pal.type2}
    </span>
  )}
</div>

        <dl className="stats-grid">
          <div><dt>HP</dt><dd>{pal.hp}</dd></div>
          <div><dt>Attack</dt><dd>{pal.attack}</dd></div>
          <div><dt>Defence</dt><dd>{pal.defense}</dd></div>
          <div><dt>Speed</dt><dd>{pal.speed}</dd></div>
        </dl>
      </section>
    </div>
  );
}
