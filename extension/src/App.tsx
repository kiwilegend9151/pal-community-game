import { useCallback, useEffect, useMemo, useState } from "react";
import { TopNav } from "./components/TopNav";
import { PalCard } from "./components/PalCard";
import { PalModal } from "./components/PalModal";
import { extensionApi } from "./lib/api";
import { initialiseTwitch, requestIdentityShare } from "./lib/twitch";
import type { Pal, PaldeckSummary, PlayerSummary, TabId } from "./types";
import "./styles.css";

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

  const isConfigPage =
    new URLSearchParams(window.location.search).get("anchor") === "config";

  const loadData = useCallback(async () => {
    setState("loading");
    setError("");

    try {
      const [profileData, palsData, paldexData] = await Promise.all([
        extensionApi.getProfile(),
        extensionApi.getPals(),
        extensionApi.getPaldex()
      ]);

      setProfile(profileData);
      setPals(palsData.pals);
      setPaldex(paldexData);
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

  useEffect(() => {
    initialiseTwitch(() => {
      if (isConfigPage) {
        void installExtension();
        return;
      }

      void loadData();
    });
  }, [installExtension, isConfigPage, loadData]);

  const filteredPals = useMemo(() => {
    const value = query.trim().toLowerCase();

    return pals.filter((pal) => {
      const matchesSearch = !value || pal.species.toLowerCase().includes(value);
      return matchesSearch && (!luckyOnly || pal.shiny);
    });
  }, [luckyOnly, pals, query]);

  if (isConfigPage) {
    if (installState === "installing") {
      return (
        <main className="status-screen">
          Connecting Twitch Monsters to your channel…
        </main>
      );
    }

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
              <article><span>Coins</span><strong>{profile.coins}</strong></article>
              <article><span>Pal Spheres</span><strong>{profile.palSpheres}</strong></article>
              <article><span>Mega Spheres</span><strong>{profile.megaSpheres}</strong></article>
              <article><span>Giga Spheres</span><strong>{profile.gigaSpheres}</strong></article>
              <article><span>Hyper Spheres</span><strong>{profile.hyperSpheres}</strong></article>
            </div>
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

            <div className="paldex-list">
              {paldex.entries.map((entry) => (
                <article key={entry.id}>
                  <span>{entry.hasLucky ? "★" : "✓"}</span>
                  <strong>{entry.species}</strong>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <PalModal pal={selectedPal} onClose={() => setSelectedPal(null)} />
    </main>
  );
}