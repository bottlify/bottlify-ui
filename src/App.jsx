/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Alert, Box, CircularProgress, Snackbar, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { getAvailableBundles, getUnlistedBundle } from "./api/bundles.js";
import { opensAsPage } from "./engine/bookmark.js";
import { residency } from "./engine/btl.js";
import { webgpuStatus } from "./engine/webgpu.js";
import { getConfig } from "./api/config.js";
import { gameIdOf, storeOf } from "./stores/providers.js";
import { useT } from "./i18n.js";
import { AddGame } from "./components/AddGame.jsx";
import { AppHeader } from "./components/AppHeader.jsx";
import { DownloadDialog } from "./components/DownloadDialog.jsx";
import { Footer } from "./components/Footer.jsx";
import { GameHubNeeded, StoreSignIn, useStores } from "./components/Stores.jsx";
import { Landing } from "./components/Landing.jsx";
import { License } from "./components/License.jsx";
import { GameSheet } from "./components/GameDetails.jsx";
import { GameGrid } from "./components/GameGrid.jsx";
import { PlayScreen } from "./components/PlayScreen.jsx";
import { SettingsDrawer } from "./components/SettingsDrawer.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";

/**
 * The launcher: the front page, the library, a game's sheet over the library,
 * and a run, which is a page of its own.
 */
export default function App() {
  const t = useT();
  const [bundles, setBundles] = useState(/** @type {any[]} */ ([]));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  // A bottle, or a store's game not installed, opened from the library.
  const [selected, setSelected] = useState(/** @type {any} */ (null));
  // Whether a game can start here at all: asked before the library fills.
  const [gpu, setGpu] = useState(/** @type {{ ok: boolean, reason?: string } | null} */ (null));
  useEffect(() => {
    webgpuStatus().then(setGpu);
  }, []);
  const [config, setConfig] = useState(/** @type {import("./api/config.js").AppConfig | null} */ (null));
  const [query, setQuery] = useState("");
  // The settings panel's section while it is open.
  const [settingsTab, setSettingsTab] = useState(/** @type {string | null} */ (null));
  const [engineOpen, setEngineOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(/** @type {string | null} */ (null));
  // A few pages only, so the path is routing enough: no dependency, and the back
  // button and a copied address keep working. Links stay plain anchors; one
  // listener turns a same-origin click into a history entry instead of a load.
  // A run is a page of its own, /play/<bottle id>: the address says a game is
  // running, and nothing starts one but going there.
  const [path, setPath] = useState(() => window.location.pathname);
  /** @param {string} to */
  const navigate = (to) => {
    window.history.pushState(null, "", to);
    setPath(window.location.pathname);
  };

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    const onClick = (/** @type {MouseEvent} */ event) => {
      const anchor = /** @type {HTMLAnchorElement | null} */ (/** @type {Element} */ (event.target).closest?.("a[href]"));
      // `rel="external"`: a page the server hands out beside the app (the docs),
      // which the app has no route for.
      if (!anchor || anchor.target || anchor.origin !== window.location.origin
        || anchor.relList.contains("external")) return;
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      window.history.pushState(null, "", anchor.href);
      onPop();
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // Raised by every bottle added or removed, so the library lists it at once.
  const [libraryRevision, setLibraryRevision] = useState(0);
  const libraryChanged = useCallback(() => setLibraryRevision((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    getAvailableBundles()
      .then((list) => {
        if (cancelled) return;
        setBundles(list);
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryRevision]);

  useEffect(() => {
    getConfig().then(setConfig);
  }, []);

  const playMatch = /^\/play\/([^/]+)\/?$/.exec(path);
  const playId = playMatch ? decodeURIComponent(playMatch[1]) : null;
  const playing = playId !== null;
  // A bottle the library does not list is still played by its address: the
  // server keeps some out of the list and hands their links out instead.
  const [unlisted, setUnlisted] = useState(/** @type {{ id: string, bundle: any } | null} */ (null));
  useEffect(() => {
    if (playId === null) return undefined;
    let cancelled = false;
    getUnlistedBundle(playId).then((bundle) => {
      if (!cancelled) setUnlisted({ id: playId, bundle });
    });
    return () => {
      cancelled = true;
    };
  }, [playId]);
  const playBundle = playId === null ? null : bundles.find((one) => one.id === playId)
    ?? (unlisted?.id === playId ? unlisted.bundle : null);
  // The game stores' accounts signed in in this browser: their games are in the
  // library, which alone syncs them. A bottle being played asks its store only
  // what its run needs, as its machine starts (session.js, runData); in Safari a
  // sync under it opened the store's window for nothing.
  const stores = useStores(libraryChanged, undefined, !playing);
  /** @param {any} bundle @param {boolean} [preload] */
  const play = (bundle, preload = false) => {
    const to = `/play/${encodeURIComponent(bundle.id)}${preload ? "?preload=1" : ""}`;
    if (opensAsPage(bundle)) window.location.assign(to);
    else navigate(to);
  };
  /** A bottle not here whole, and how much of it is: Download or Play anyway. */
  const [asking, setAsking] = useState(/** @type {any} */ (null));
  /** @param {any} bundle */
  const handlePlay = async (bundle) => {
    // Where a download is offered, a bottle kept in this browser is here whole
    // already; one from the server is asked about unless every block of it is
    // here. Not knowing -- no origin storage, an index that would not come --
    // is no reason to keep the person from playing.
    if (config?.preloadBottles && !bundle.local) {
      const held = await residency(bundle).catch(() => null);
      if (held && held.residentBytes < held.bytes) {
        setAsking({ bundle, held });
        return;
      }
    }
    play(bundle);
  };
  const handleClosePlay = () => {
    if (playBundle && opensAsPage(playBundle)) {
      window.location.assign("/library");
      return;
    }
    navigate("/library");
    setSelected(null);
  };

  const inLibrary = path.startsWith("/library");
  const inLicense = path.startsWith("/license");
  // A store's game opened before its install: once installed, the sheet is its bottle's.
  const opened = selected?.store?.provider
    ? bundles.find((one) => storeOf(one) === selected.store.provider
      && gameIdOf(one) === selected.store.game.id) ?? selected
    : selected && (bundles.find((one) => one.id === selected.id) ?? null);
  /** @param {import("./api/bundles.js").BundleManifest} saved */
  const changed = (saved) => setBundles((list) => list.map((one) => (one.id === saved.id ? saved : one)));
  const openSettings = (/** @type {string} */ tab) => setSettingsTab(tab);
  const gamehubLink = typeof (/** @type {any} */ (config))?.gamehubUrl === "string"
    ? /** @type {any} */ (config).gamehubUrl : null;

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {!playing && (<>
        <AppHeader
          query={inLibrary ? query : null}
          onQuery={setQuery}
          settingsOpen={settingsTab !== null}
          onSettings={() => setSettingsTab((open) => (open === null ? "general" : null))}
        >
          {settingsTab !== null && (
            <SettingsPanel tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)}
              stores={stores} library={bundles} onLibraryChanged={libraryChanged} gamehubLink={gamehubLink}
              onEngine={() => {
                setSettingsTab(null);
                setEngineOpen(true);
              }} />
          )}
        </AppHeader>

        {inLicense ? (
          <License takedownEmail={config?.takedownEmail} />
        ) : !inLibrary ? (
          <Landing />
        ) : gpu === null ? (
          <Box sx={{ p: 4, display: "flex", justifyContent: "center", flex: 1 }}>
            <CircularProgress />
          </Box>
        ) : !gpu.ok ? (
          <Alert severity="error" variant="outlined" sx={{ m: 4 }}>
            {t("app.noWebgpu")}
          </Alert>
        ) : error ? (
          <Typography color="error" sx={{ p: 4 }}>{t("app.libraryFailed", { reason: error })}</Typography>
        ) : !loaded ? (
          <Box sx={{ p: 4, display: "flex", justifyContent: "center", flex: 1 }}>
            <CircularProgress />
          </Box>
        ) : (
          <GameGrid bundles={bundles} stores={stores} query={query}
            blurred={opened !== null || adding || asking !== null}
            onOpen={setSelected} onAdd={() => setAdding(true)} />
        )}

        {opened && (
          <GameSheet item={opened} stores={stores} config={config} onClose={() => setSelected(null)}
            onPlay={handlePlay} onChanged={changed} onLibraryChanged={libraryChanged} />
        )}

        {asking && (
          <DownloadDialog
            bundle={asking.bundle}
            held={asking.held}
            onClose={() => setAsking(null)}
            onPlay={() => {
              setAsking(null);
              play(asking.bundle);
            }}
            onDownload={() => {
              setAsking(null);
              play(asking.bundle, true);
            }}
          />
        )}

        {adding && (
          <AddGame onClose={() => setAdding(false)} onAdded={(title) => {
            setAdding(false);
            setNotice(t("add.added", { name: title }));
            libraryChanged();
          }} />
        )}

        {/* Developer mode: the engine's own settings and journal. With no run
          the journal says so rather than showing an empty one; a running game
          has the panel beside its picture instead. */}
        <SettingsDrawer open={engineOpen} onClose={() => setEngineOpen(false)} />

        {/* Install pressed on a store's game signed out: its sign-in, then the
          library's cards are read again; or, without GameHub, the extension first. */}
        {stores.signInFor && (stores.signInFor.available
          ? <StoreSignIn provider={stores.signInFor.provider} onSignedIn={stores.signInDone}
            onClose={stores.closeSignIn} />
          : <GameHubNeeded provider={stores.signInFor.provider} link={gamehubLink}
            onAccounts={() => {
              stores.closeSignIn();
              setSelected(null);
              openSettings("accounts");
            }}
            onClose={stores.closeSignIn} />)}

        <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          message={notice} slotProps={{ content: { sx: { bgcolor: "text.primary", color: "background.default",
            fontWeight: 600, fontSize: 15 } } }} />

        <Footer />
      </>)}

      {playBundle && <PlayScreen key={playBundle.id} bundle={playBundle} onClose={handleClosePlay} />}
      {playing && !playBundle && (
        <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
          {unlisted?.id === playId && (error || loaded) ? (
            <Typography color="error">
              {t("app.notFound")} <a href="/library">{t("app.backToLibrary")}</a>
            </Typography>
          ) : <CircularProgress />}
        </Box>
      )}
    </Box>
  );
}
