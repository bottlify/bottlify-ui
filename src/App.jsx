/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAvailableBundles, getUnlistedBundle } from "./api/bundles.js";
import { importBottle } from "./engine/bottles.js";
import { opensAsPage } from "./engine/bookmark.js";
import { formatOf, unsupportedNotice } from "./engine/formats.js";
import { residency } from "./engine/btl.js";
import { DownloadDialog } from "./components/DownloadDialog.jsx";
import { getConfig } from "./api/config.js";
import { readFile } from "./api/readFile.js";
import {
  archiveDisc, isDiscImage, isZipArchive, readZip, storageHeadroom,
} from "@bottlify/installer";
import { ArchiveDialog } from "./components/ArchiveDialog.jsx";
import { AppHeader } from "./components/AppHeader.jsx";
import { Footer } from "./components/Footer.jsx";
import { InstallScreen } from "./components/InstallScreen.jsx";
import { AddDialog } from "./components/AddDialog.jsx";
import { SteamSignIn, useSteam } from "./components/SteamStore.jsx";
import { Landing } from "./components/Landing.jsx";
import { License } from "./components/License.jsx";
import { BottleSettingsDialog, GameDetails } from "./components/GameDetails.jsx";
import { GameGrid } from "./components/GameGrid.jsx";
import { PlayScreen } from "./components/PlayScreen.jsx";
import { ReadingDialog } from "./components/ReadingDialog.jsx";
import { SettingsDrawer } from "./components/SettingsDrawer.jsx";

/**
 * The mini library:
 *  - home grid of games from the local bundles;
 *  - click → details panel slides in over the blurred grid;
 *  - Play → fullscreen stage with a top header (settings / pause / close).
 *
 * Adding a title by running its installer is a developer feature and appears
 * only where the configuration turns it on. Absent, nothing about it is here.
 */
export default function App() {
  const [bundles, setBundles] = useState([]);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [config, setConfig] = useState(null);
  const [media, setMedia] = useState(null);
  // An unpacked archive waiting for the person to pick the program it starts.
  const [archive, setArchive] = useState(null);
  const [notice, setNotice] = useState(null);
  const [settings, setSettings] = useState(false);
  // The bottle a card's gear opened the settings of, or its pencil the
  // name and pictures of.
  const [editingBundle, setEditingBundle] = useState(
    /** @type {{ bundle: any, mode: "machine" | "describe" } | null} */ (null));
  const chooser = useRef(null);
  // Add's choice -- a file or Steam -- and Steam's sign-in once chosen.
  const [adding, setAdding] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  // The file being looked at and read, and the way to stop that.
  const [reading, setReading] = useState(null);
  const readingAbort = useRef(null);
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
    const onClick = (event) => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return;
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

  // Raised by every bottle saved, so the library lists it at once -- the
  // server's and this browser's alike -- without a reload.
  const [libraryRevision, setLibraryRevision] = useState(0);
  const libraryChanged = useCallback(() => setLibraryRevision((n) => n + 1), []);
  // The Steam account signed in in this browser: its games are in the library.
  const steam = useSteam(libraryChanged);
  const steamSignedIn = steam.signedIn;
  const signedIn = useCallback(async (session) => {
    setSigningIn(false);
    await steamSignedIn(session);
  }, [steamSignedIn]);
  useEffect(() => {
    let cancelled = false;
    getAvailableBundles()
      .then((list) => {
        if (!cancelled) setBundles(list);
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
  /** @param {any} bundle @param {boolean} [preload] */
  const play = (bundle, preload = false) => {
    const to = `/play/${encodeURIComponent(bundle.id)}${preload ? "?preload=1" : ""}`;
    if (opensAsPage(bundle)) window.location.assign(to);
    else navigate(to);
  };
  /** A bottle not here whole, and how much of it is: Download or Play anyway. */
  const [asking, setAsking] = useState(null);
  const handlePlay = async () => {
    if (!selected) return;
    // Where a download is offered, a bottle kept in this browser is here whole
    // already; one from the server is asked about unless every block of it is
    // here. Not knowing -- no origin storage, an index that would not come --
    // is no reason to keep the person from playing.
    if (config?.preloadBottles && !selected.local) {
      const held = await residency(selected).catch(() => null);
      if (held && held.residentBytes < held.bytes) {
        setAsking({ bundle: selected, held });
        return;
      }
    }
    play(selected);
  };
  const handleClosePlay = () => {
    if (playBundle && opensAsPage(playBundle)) {
      window.location.assign("/library");
      return;
    }
    navigate("/library");
    setSelected(null);
  };

  /**
   * The chosen file. An installer is read whole: the guest opens it, so it has
   * to be bytes. A disc image -- told apart by its contents, the volume
   * descriptor every ISO 9660 image has -- is not read at all here: the engine
   * mounts the file itself as a drive and reads it a range at a time.
   */
  const handleChosen = async (event) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;
    // Up before anything is awaited: the checks and the read below take
    // seconds for a large file, and nothing on the page may stay unchanged
    // through them.
    const attempt = new AbortController();
    readingAbort.current = attempt;
    setNotice(null);
    setReading({ name: file.name, size: file.size, read: null });
    try {
      const disc = await isDiscImage(file).catch(() => false);
      // Four kinds are taken, each told by its own bytes rather than its name:
      // a disc image, a zip, a program, a bottle. Anything else -- another
      // archive format among them -- is said to be unsupported up front, not
      // started as a program and failed.
      const kind = disc ? "iso" : await formatOf(file);
      if (kind === null) {
        setNotice(unsupportedNotice(file.name));
        return;
      }
      // A bottle made elsewhere: kept in this browser as it is.
      if (kind === "btl") {
        const { manifest } = await importBottle(file, (read, size) =>
          setReading({ name: file.name, size, read }));
        setNotice(`${manifest.title} is in the library, kept in this browser.`);
        setLibraryRevision((n) => n + 1);
        return;
      }

      // What an install will need is unknowable; that it needs at least the size
      // of its own distribution is not, so that much is checked while it is still
      // a question rather than at ninety per cent of the way through.
      const room = await storageHeadroom();
      if (room && room.available < file.size) {
        setNotice(`${file.name} is ${(file.size / (1 << 20)).toFixed(0)} MB and this origin has `
          + `${(room.available / (1 << 20)).toFixed(0)} MB left, which is not enough to hold `
          + (disc ? "what an install from it writes." : "the distribution, let alone what it installs."));
        return;
      }
      if (disc) {
        setMedia({ name: file.name, disc: file });
        return;
      }
      // An archive is the disc it stands in for, once unpacked; which of its
      // programs to start is asked, since it has no autorun.inf to say.
      if (await isZipArchive(file).catch(() => false)) {
        const entries = await readZip(file, (done, total) =>
          setReading({ name: file.name, size: total, read: done, files: true }));
        // Unpacking cannot be stopped part way; a cancel drops what it made.
        if (!attempt.signal.aborted) setArchive({ name: file.name, entries });
        return;
      }
      setReading({ name: file.name, size: file.size, read: 0 });
      const bytes = await readFile(
        file,
        (read) => setReading({ name: file.name, size: file.size, read }),
        { signal: attempt.signal },
      );
      setMedia({ name: file.name, bytes });
    } catch (e) {
      // Cancelled by the person: nothing to say. Anything else is said.
      if (e?.name !== "AbortError") setNotice(`${file.name} could not be read: ${e?.message ?? e}`);
    } finally {
      setReading(null);
    }
  };

  const blurred = selected !== null || playing || media !== null;
  const inLibrary = path.startsWith("/library");
  const inLicense = path.startsWith("/license");
  // A run covers the whole window; the library under it is not drawn at all,
  // or it is still there to scroll beneath the stage.
  const covered = playing || media !== null;
  const editable = Boolean(config?.allowInstall && config?.upload);
  /** @param {import("./api/bundles.js").BundleManifest} saved */
  const changed = (saved) => {
    setBundles((list) => list.map((one) => (one.id === saved.id ? saved : one)));
    setSelected((now) => (now?.id === saved.id ? saved : now));
  };
  /** @param {string} id */
  const deleted = (id) => {
    setBundles((list) => list.filter((one) => one.id !== id));
    setSelected((now) => (now?.id === id ? null : now));
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {!covered && (<>
        {/* Adding and settings are about runs, so they exist only where a run
          can be started; on the front page they would be controls over
          nothing. */}
        <AppHeader
          onAdd={inLibrary && config?.allowInstall ? () => setAdding(true) : null}
          onSettings={inLibrary ? () => setSettings(true) : null}
        />
        {config?.allowInstall && (
          <Box
            component="input"
            type="file"
            // What can be installed or opened: a setup, a disc image, an
            // archive, a bottle. The rest is not offered in the picker at all.
            accept=".exe,.iso,.zip,.btl"
            ref={chooser}
            onChange={handleChosen}
            sx={{ display: "none" }}
          />
        )}

        {notice && (
          <Alert severity="warning" variant="outlined" sx={{ mx: 4, mt: 2 }}
            onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        {adding && (
          <AddDialog
            steamAccount={steam.account}
            onFile={() => {
              setAdding(false);
              chooser.current?.click();
            }}
            onSteam={() => {
              setAdding(false);
              setSigningIn(true);
            }}
            onClose={() => setAdding(false)}
          />
        )}

        {signingIn && <SteamSignIn onSignedIn={signedIn} onClose={() => setSigningIn(false)} />}

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

        {inLicense ? (
          <License takedownEmail={config?.takedownEmail} />
        ) : !inLibrary ? (
          <Landing />
        ) : error ? (
          <Typography color="error" sx={{ p: 4 }}>
          Could not load the library: {error}
          </Typography>
        ) : bundles.length === 0 ? (
          <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : (
          <GameGrid
            bundles={bundles}
            blurred={blurred}
            onSelect={setSelected}
            onSettings={(bundle) => setEditingBundle({ bundle, mode: "machine" })}
            onEdit={(bundle) => setEditingBundle({ bundle, mode: "describe" })}
            editable={editable}
            tagged={config?.libraryTags === true}
            steam={steam}
          />
        )}

        {selected && !playing && (
          <GameDetails
            bundle={selected}
            onClose={() => setSelected(null)}
            onPlay={handlePlay}
            editable={editable}
            upload={config?.upload ?? null}
            onChanged={changed}
            onDeleted={deleted}
            editableTypes={config?.editableTypes}
          />
        )}

        {editingBundle && (
          <BottleSettingsDialog
            bundle={editingBundle.bundle}
            mode={editingBundle.mode}
            editable={editable && Boolean(config?.upload)}
            upload={config?.upload ?? null}
            onSaved={changed}
            onDeleted={deleted}
            onClose={() => setEditingBundle(null)}
          />
        )}

        {/* Opened from the library, where no engine exists yet: the Logs section
          says so rather than showing an empty journal. The running one has a
          gear of its own, because the stage covers this header. */}
        <SettingsDrawer
          open={settings}
          onClose={() => setSettings(false)}
          facts={[{ label: "Library", value: `${bundles.length} title${bundles.length === 1 ? "" : "s"}` }]}
        />

        <Footer />
      </>)}

      {playBundle && <PlayScreen key={playBundle.id} bundle={playBundle} onClose={handleClosePlay} />}
      {playing && !playBundle && (
        <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
          {unlisted?.id === playId && (error || bundles.length > 0) ? (
            <Typography color="error">
              No bottle {playId} in the library. <a href="/library">Back to the library</a>
            </Typography>
          ) : <CircularProgress />}
        </Box>
      )}

      {reading && (
        <ReadingDialog reading={reading} onCancel={() => readingAbort.current?.abort()} />
      )}

      {archive && (
        <ArchiveDialog
          name={archive.name}
          entries={archive.entries}
          onInstall={(entry) => {
            // The program by its path on the disc the archive becomes.
            setMedia({ ...archiveDisc(archive.name, archive.entries, entry),
              unpacked: archive.entries });
            setArchive(null);
          }}
          onSave={(entry) => {
            setMedia({ name: archive.name, prefix: archivePrefix(archive.entries, entry) });
            setArchive(null);
          }}
          onClose={() => setArchive(null)}
        />
      )}

      {media && (
        <InstallScreen
          media={media}
          upload={config?.upload ?? null}
          onSaved={() => setLibraryRevision((n) => n + 1)}
          onClose={() => setMedia(null)}
        />
      )}
    </Box>
  );
}

/**
 * An archive kept as it stands, for a game shipped unpacked: its tree is the
 * bottle, under the directory a bottle's files live in, and the program picked
 * out of it is the entry point.
 *
 * @param {import("@bottlify/installer").ArchiveEntry[]} entries
 * @param {string} entry
 */
function archivePrefix(entries, entry) {
  return {
    root: "C:\\App",
    files: entries.filter((one) => one.bytes !== null).map(({ path, bytes }) => ({ path, bytes })),
    outside: [],
    entry,
  };
}

