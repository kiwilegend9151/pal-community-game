
import { useEffect, useState } from "react";
import type { Pal } from "../types";
import { extensionApi } from "../lib/api";
import { getPalImage } from "../utils/palImages";
import { getTypeImage } from "../utils/typeImages";

interface Props {
  pal: Pal | null;
  onClose: () => void;
  onUpdated: (palId: string, nickname: string | null) => void;
  isPartner: boolean;
  onPartnerChanged: (palId: string, isPartner: boolean) => void;
  onReleased: (palId: string) => void;
}

export function PalModal({
  pal,
  onClose,
  onUpdated,
  isPartner,
  onPartnerChanged,
  onReleased
}: Props) {
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerError, setPartnerError] = useState("");
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState("");

  useEffect(() => {
    setNickname(pal?.nickname ?? "");
    setError("");
    setSaved(false);
    setConfirmRelease(false);
    setReleaseError("");
  }, [pal?.id, pal?.nickname]);

  if (!pal) return null;

  const imageUrl = getPalImage(pal.species);

  async function handleSave() {
    if (!pal || saving) return;

    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const cleanedNickname = nickname.trim();

      const result = await extensionApi.renamePal(
        pal.id,
        cleanedNickname
      );

      onUpdated(pal.id, result.nickname);
      setNickname(result.nickname ?? "");
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save nickname"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePartnerToggle() {
    if (!pal || partnerBusy) return;

    setPartnerBusy(true);
    setPartnerError("");

    try {
      if (isPartner) {
        await extensionApi.removePartnerPal();
        onPartnerChanged(pal.id, false);
      } else {
        await extensionApi.setPartnerPal(pal.id);
        onPartnerChanged(pal.id, true);
      }
    } catch (err) {
      setPartnerError(
        err instanceof Error
          ? err.message
          : "Could not update Partner Pal"
      );
    } finally {
      setPartnerBusy(false);
    }
  }

  async function handleRelease() {
    if (!pal || releaseBusy) return;

    setReleaseBusy(true);
    setReleaseError("");

    try {
      await extensionApi.releasePal(pal.id);
      onReleased(pal.id);
    } catch (err) {
      setReleaseError(
        err instanceof Error
          ? err.message
          : "Could not release Pal"
      );
    } finally {
      setReleaseBusy(false);
    }
  }

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
            <span>
              {pal.species.trim().slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <h2>
          {pal.shiny && <span className="lucky-star">★ </span>}
          {pal.nickname?.trim() || pal.species}
        </h2>

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

        <div className="nickname-editor">
          <label htmlFor="pal-nickname">Pal nickname</label>

          <input
            id="pal-nickname"
            type="text"
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setSaved(false);
              setError("");
            }}
            placeholder={pal.species}
            maxLength={20}
          />

          <p className="nickname-hint">
            Original species: {pal.species}
          </p>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || nickname.trim() === (pal.nickname ?? "")}
          >
            {saving ? "Saving..." : "Save Nickname"}
          </button>

          {error && <p className="nickname-error">{error}</p>}
          {saved && <p className="nickname-success">Nickname saved!</p>}
        </div>

        <div className="partner-editor">
          <button
            type="button"
            className="primary-button"
            onClick={handlePartnerToggle}
            disabled={partnerBusy || releaseBusy}
          >
            {partnerBusy
              ? "Updating..."
              : isPartner
                ? "Remove as Partner Pal"
                : "❤️ Set as Partner Pal"}
          </button>

          {isPartner && (
            <p className="nickname-success">❤️ This is your Partner Pal!</p>
          )}

          {partnerError && (
            <p className="nickname-error">{partnerError}</p>
          )}
        </div>

        <div className="release-editor">
          {!confirmRelease ? (
            <button
              type="button"
              onClick={() => {
                setConfirmRelease(true);
                setReleaseError("");
              }}
              disabled={releaseBusy || partnerBusy || saving}
            >
              Release Pal
            </button>
          ) : (
            <div className="release-confirmation">
              <h3>Release this Pal?</h3>

              <p>
                This action cannot be undone. {pal.species} will
                permanently leave your collection.
              </p>

              <p>
                You will receive <strong>1 Training Manual S</strong>.
              </p>

              {isPartner && (
                <p>
                  This is your Partner Pal. Releasing it will remove
                  your current Partner Pal assignment.
                </p>
              )}

              <div className="release-confirmation-buttons">
                <button
                  type="button"
                  onClick={() => setConfirmRelease(false)}
                  disabled={releaseBusy}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={handleRelease}
                  disabled={releaseBusy}
                >
                  {releaseBusy ? "Releasing..." : "Confirm Release"}
                </button>
              </div>

              {releaseError && (
                <p className="nickname-error">{releaseError}</p>
              )}
            </div>
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
