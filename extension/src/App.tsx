import { useCallback, useEffect, useMemo, useState } from "react";
import { TopNav } from "./components/TopNav";
import { PalCard } from "./components/PalCard";
import { PalModal } from "./components/PalModal";
import {
  extensionApi,
  type ExpeditionStatusResponse
} from "./lib/api";
import {
  initialiseTwitch,
  requestIdentityShare,
  type TwitchExtensionMode
} from "./lib/twitch";

import type { Pal, PaldeckSummary, PlayerSummary, TabId } from "./types";
import "./styles.css";
import { getPalImage } from "./utils/palImages";


type LoadState = "loading" | "ready" | "error" | "identity-required";
type InstallState = "installing" | "success" | "error";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("pals");
  const [profile, setProfile] = useState<PlayerSummary | null>(null);
  const [pals, setPals] = useState<Pal[]>([]);
  const [paldex, setPaldex] = useState<PaldeckSummary | null>(null);
  const [selectedPal, setSelectedPal] = useState<Pal | null>(null);
  const [query, setQuery] = useState("");
  const [luckyOnly, setLuckyOnly] = useState(false);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [installState, setInstallState] =
    useState<InstallState>("installing");
const [expedition, setExpedition] =
  useState<ExpeditionStatusResponse>({ active: false });

const [expeditionPalId, setExpeditionPalId] = useState("");
const [expeditionMessage, setExpeditionMessage] = useState("");
const [expeditionBusy, setExpeditionBusy] = useState(false);
const [expeditionNow, setExpeditionNow] = useState(Date.now());

const params = new URLSearchParams(window.location.search);

const [twitchMode, setTwitchMode] =
  useState<TwitchExtensionMode>(undefined);

const isConfigPage =
  window.location.pathname.endsWith("/config.html") ||
  twitchMode === "config" ||
  params.get("mode") === "config" ||
  params.get("configure") === "true";
console.log("[APP] URL:", window.location.href);
console.log("[APP] anchor:", params.get("anchor"));
console.log("[APP] configure:", params.get("configure"));
console.log("[APP] mode:", params.get("mode"));
console.log("[APP] Twitch mode:", twitchMode);
console.log("[APP] isConfigPage:", isConfigPage);
  const loadData = useCallback(async () => {
    setState("loading");
    setError("");

    try {
const [profileData, palsData, paldexData, expeditionData] =
  await Promise.all([
    extensionApi.getProfile(),
    extensionApi.getPals(),
    extensionApi.getPaldex(),
    extensionApi.getExpedition()
  ]);

      setProfile(profileData);
      setPals(palsData.pals);
      setPaldex(paldexData);
      setExpedition(expeditionData);
      setState("ready");
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Unable to load data";

      setError(message);
      setState(
        message.toLowerCase().includes("identity")
          ? "identity-required"
          : "error"
      );
    }
  }, []);

  const installExtension = useCallback(async () => {
    setInstallState("installing");
    setError("");

    try {
      await extensionApi.install();
      setInstallState("success");
    } catch (installError) {
      const message =
        installError instanceof Error
          ? installError.message
          : "Unable to connect the bot";

      setError(message);
      setInstallState("error");
    }
  }, []);

const loadExpedition = useCallback(async () => {
  try {
    const expeditionData = await extensionApi.getExpedition();
    setExpedition(expeditionData);
  } catch (expeditionError) {
    console.error("Could not load expedition:", expeditionError);
  }
}, []);

const sendExpedition = useCallback(async () => {
  if (!expeditionPalId) {
    setExpeditionMessage("Select a Pal first.");
    return;
  }

  setExpeditionBusy(true);
  setExpeditionMessage("");

  try {
    const result = await extensionApi.sendExpedition(
      expeditionPalId
    );

    setExpeditionMessage(result.message);
    setExpeditionPalId("");

    await loadExpedition();
  } catch (sendError) {
    setExpeditionMessage(
      sendError instanceof Error
        ? sendError.message
        : "Could not start expedition"
    );
  } finally {
    setExpeditionBusy(false);
  }
}, [expeditionPalId, loadExpedition]);

const claimExpedition = useCallback(async () => {
  setExpeditionBusy(true);
  setExpeditionMessage("");

  try {
    const result = await extensionApi.claimExpedition();

    setExpeditionMessage(
      `${result.species} returned with ` +
        `${result.coinReward} coins, ` +
        `${result.palSphereReward} Pal Spheres, ` +
        `${result.paldiumReward} Paldium, ` +
        `${result.woodReward} Wood and ` +
        `${result.stoneReward} Stone!`
    );

    await loadData();
  } catch (claimError) {
    setExpeditionMessage(
      claimError instanceof Error
        ? claimError.message
        : "Could not claim expedition"
    );
  } finally {
    setExpeditionBusy(false);
  }
}, [loadData]);

useEffect(() => {
  console.log("[APP] starting Twitch initialisation");

  initialiseTwitch(
    () => {
      console.log("[APP] Twitch authorised");
    },
    (mode) => {
      console.log("[APP] Twitch context mode:", mode);

      setTwitchMode(mode);
    }
  );
}, []);

  const filteredPals = useMemo(() => {
    const value = query.trim().toLowerCase();

    return pals.filter((pal) => {
      const matchesSearch = !value || pal.species.toLowerCase().includes(value);
      return matchesSearch && (!luckyOnly || pal.shiny);
    });
  }, [luckyOnly, pals, query]);

useEffect(() => {
  if (isConfigPage) {
    console.log("[APP] configuration page");
    void installExtension();
    return;
  }

  if (twitchMode === "viewer" || twitchMode === "dashboard") {
    console.log("[APP] calling loadData");
    void loadData();
  }
}, [isConfigPage, twitchMode, installExtension, loadData]);

const expeditionRemaining =
  expedition.active
    ? Math.max(
        0,
        new Date(
          expedition.expedition.completesAt
        ).getTime() - expeditionNow
      )
    : 0;

const expeditionHours = Math.floor(
  expeditionRemaining / (60 * 60 * 1000)
);

const expeditionMinutes = Math.floor(
  (expeditionRemaining % (60 * 60 * 1000)) /
    (60 * 1000)
);

const expeditionSeconds = Math.floor(
  (expeditionRemaining % (60 * 1000)) / 1000
);

const expeditionFinished =
  expedition.active && expeditionRemaining === 0;

    if (installState === "error") {
      return (
        <main className="status-screen">
          <h1>Could not connect the bot</h1>
          <p className="error-text">{error}</p>
          <button className="primary-button" onClick={installExtension}>
            Try again
          </button>
        </main>
      );
    }

  if (isConfigPage) {
    if (installState === "installing") {
      return (
        <main className="status-screen">
          Connecting Twitch Monsters to your channel…
        </main>
      );
    }



    return (
      <main className="status-screen">
        <h1>Twitch Monsters connected</h1>
        <p>The bot has successfully joined your channel.</p>
      </main>
    );
  }

  if (state === "loading") {
    return <main className="status-screen">Loading your Pals…</main>;
  }

  if (state === "identity-required") {
    return (
      <main className="status-screen">
        <h1>Connect your Twitch identity</h1>
        <p>Share your identity so the panel can find your player account.</p>
        <button className="primary-button" onClick={requestIdentityShare}>
          Connect Twitch account
        </button>
        {error && <p className="error-text">{error}</p>}
      </main>
    );
  }

  if (state === "error" || !profile) {
    return (
      <main className="status-screen">
        <h1>Could not load your collection</h1>
        <p className="error-text">{error}</p>
        <button className="primary-button" onClick={loadData}>
          Try again
        </button>
      </main>
    );
  }

console.log("[APP] activeTab:", activeTab);

  return (
    <main className="app-shell">
      <TopNav
        activeTab={activeTab}
        onChange={setActiveTab}
        onRefresh={loadData}
      />

      <section className="content">
        {activeTab === "pals" && (
          <>
            <h1>Your Pals: {profile.totalPals}</h1>

            <div className="collection-tools">
              <input
                type="search"
                placeholder="Search your Pals"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />

              <label className="check-label">
                <input
                  type="checkbox"
                  checked={luckyOnly}
                  onChange={(event) => setLuckyOnly(event.target.checked)}
                />
                Lucky only
              </label>
            </div>

            <div className="pal-grid">
              {filteredPals.map((pal) => (
                <PalCard
                  key={pal.id}
                  pal={pal}
                  selected={selectedPal?.id === pal.id}
                  onSelect={setSelectedPal}
                />
              ))}
            </div>
          </>
        )}

{activeTab === "shop" && (
  <>
    <h1>Shop</h1>

    <div className="inventory-list">
      <article>
        <span>Pal Sphere</span>
        <strong>10 Coins</strong>
        <button
          className="primary-button"
          onClick={async () => {
            try {
              await extensionApi.buySphere("pal", 1);
              await loadData();
            } catch (shopError) {
              setError(
                shopError instanceof Error
                  ? shopError.message
                  : "Unable to buy Pal Sphere"
              );
            }
          }}
        >
          Buy
        </button>
      </article>

      <article>
        <span>Mega Sphere</span>
        <strong>20 Coins</strong>
        <button
          className="primary-button"
          onClick={async () => {
            try {
              await extensionApi.buySphere("mega", 1);
              await loadData();
            } catch (shopError) {
              setError(
                shopError instanceof Error
                  ? shopError.message
                  : "Unable to buy Mega Sphere"
              );
            }
          }}
        >
          Buy
        </button>
      </article>

      <article>
        <span>Giga Sphere</span>
        <strong>30 Coins</strong>
        <button
          className="primary-button"
          onClick={async () => {
            try {
              await extensionApi.buySphere("giga", 1);
              await loadData();
            } catch (shopError) {
              setError(
                shopError instanceof Error
                  ? shopError.message
                  : "Unable to buy Giga Sphere"
              );
            }
          }}
        >
          Buy
        </button>
      </article>

      <article>
        <span>Hyper Sphere</span>
        <strong>50 Coins</strong>
        <button
          className="primary-button"
          onClick={async () => {
            try {
              await extensionApi.buySphere("hyper", 1);
              await loadData();
            } catch (shopError) {
              setError(
                shopError instanceof Error
                  ? shopError.message
                  : "Unable to buy Hyper Sphere"
              );
            }
          }}
        >
          Buy
        </button>
      </article>
    </div>

    {error && <p className="error-text">{error}</p>}
  </>
)}

        {activeTab === "profile" && (
          <>
            <h1>{profile.username}</h1>
            <div className="summary-grid">
              <article><span>Level</span><strong>{profile.level}</strong></article>
              <article><span>Coins</span><strong>{profile.coins}</strong></article>
              <article><span>Total Pals</span><strong>{profile.totalPals}</strong></article>
              <article><span>Lucky Pals</span><strong>{profile.totalLucky}</strong></article>
            </div>
            <div className="xp-block">
              <div><span>XP</span><strong>{profile.xp} / {profile.xpNeeded}</strong></div>
              <progress value={profile.xp} max={profile.xpNeeded} />
            </div>
          </>
        )}

{activeTab === "inventory" && (
  <>
    <h1>Inventory</h1>

    <div className="inventory-list">
      <article>
        <span>Coins</span>
        <strong>{profile.coins}</strong>
      </article>

      <article>
        <span>Pal Spheres</span>
        <strong>{profile.palSpheres}</strong>
      </article>

      <article>
        <span>Mega Spheres</span>
        <strong>{profile.megaSpheres}</strong>
      </article>

      <article>
        <span>Giga Spheres</span>
        <strong>{profile.gigaSpheres}</strong>
      </article>

      <article>
        <span>Hyper Spheres</span>
        <strong>{profile.hyperSpheres}</strong>
      </article>

      <article>
        <span>💎 Paldium</span>
        <strong>{profile.paldium}</strong>
      </article>

      <article>
        <span>🪵 Wood</span>
        <strong>{profile.wood}</strong>
      </article>

      <article>
        <span>🪨 Stone</span>
        <strong>{profile.stone}</strong>
      </article>
    </div>
  </>
)}

{activeTab === "expedition" && (
  <>
    <h1>Expedition</h1>

    {!expedition.active && (
      <>
        <p>Send one of your Pals exploring for 1 hour.</p>

        <div className="inventory-list">
          <article>
            <span>Select Pal</span>

            <select
              value={expeditionPalId}
              onChange={(event) =>
                setExpeditionPalId(event.target.value)
              }
            >
              <option value="">Choose a Pal</option>

              {pals.map((pal) => (
                <option key={pal.id} value={pal.id}>
                  {pal.shiny ? "✨ " : ""}
                  {pal.species} — Lv. {pal.level}
                </option>
              ))}
            </select>
          </article>
        </div>

        <button
          className="primary-button"
          disabled={!expeditionPalId || expeditionBusy}
          onClick={() => void sendExpedition()}
        >
          {expeditionBusy
            ? "Sending..."
            : "Send on Expedition"}
        </button>

        <div className="summary-grid">
          <article>
            <span>Coins</span>
            <strong>25–100</strong>
          </article>

          <article>
            <span>Pal Spheres</span>
            <strong>0–3</strong>
          </article>

          <article>
            <span>Paldium</span>
            <strong>1–5</strong>
          </article>

          <article>
            <span>Wood</span>
            <strong>0–5</strong>
          </article>

          <article>
            <span>Stone</span>
            <strong>0–5</strong>
          </article>
        </div>
      </>
    )}



    {expedition.active && (
      <>
        <div className="summary-grid">
          <article>
            <span>Pal</span>
            <strong>
              {expedition.expedition.shiny ? "✨ " : ""}
              {expedition.expedition.species}
            </strong>
          </article>

          <article>
            <span>Status</span>
            <strong>
              {expeditionFinished
                ? "Returned"
                : "Exploring"}
            </strong>
          </article>
        </div>

        {!expeditionFinished && (
          <div className="xp-block">
            <div>
              <span>Time remaining</span>

              <strong>
                {expeditionHours}h{" "}
                {expeditionMinutes}m{" "}
                {expeditionSeconds}s
              </strong>
            </div>
          </div>
        )}

        {expeditionFinished && (
          <button
            className="primary-button"
            disabled={expeditionBusy}
            onClick={() => void claimExpedition()}
          >
            {expeditionBusy
              ? "Claiming..."
              : "Claim Rewards"}
          </button>
        )}
      </>
    )}

    {expeditionMessage && (
      <p>{expeditionMessage}</p>
    )}
  </>
)}

        {activeTab === "paldex" && paldex && (
          <>
            <h1>Paldeck</h1>
            <div className="summary-grid">
              <article><span>Discovered</span><strong>{paldex.discovered}</strong></article>
              <article><span>Total</span><strong>{paldex.totalSpecies}</strong></article>
              <article><span>Complete</span><strong>{paldex.completionPercentage}%</strong></article>
              <article><span>Lucky Species</span><strong>{paldex.luckySpecies}</strong></article>
            </div>

<div className="paldex-grid">
  {paldex.entries.map((entry) => {
    const imageUrl = getPalImage(entry.species);

    return (
      <article
        key={entry.id}
        className={
          entry.discovered
            ? "paldex-card discovered"
            : "paldex-card undiscovered"
        }
      >
        <span className="paldex-number">
          #{entry.paldeck ?? "???"}
        </span>

        <div className="paldex-art">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={entry.species}
            />
          ) : (
            <span className="paldex-missing">?</span>
          )}
        </div>

        <strong className="paldex-name">
          {entry.hasLucky && (
            <span className="lucky-star">★ </span>
          )}
          {entry.species}
        </strong>
      </article>
    );
  })}
</div>

          </>
        )}

      </section>

      <PalModal
        pal={selectedPal}
        onClose={() => setSelectedPal(null)}
      />
    </main>
  );
}