/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, Stack, Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeQr, qrToSvg } from "@bottlify/core/steam";
import {
  sessionHeaders, signIn, signOut as signOutHere, steamAccountName, steamGames, steamJobs,
} from "../steam/client.js";
import { steamBridge } from "../steam/bridge.js";

/** @typedef {import("../../steam-store.mjs").StoreGame} StoreGame */
/** @typedef {import("../../steam-store.mjs").InstallJob} InstallJob */

/** @param {number} bytes */
const size = (bytes) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB`
  : `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`);

/** Why a game cannot be installed while the session is the bridge's. */
const NO_INSTALL_IN_BRIDGE = "Install needs the server sign-in until streamed bottles land";

/** @param {InstallJob | undefined} job */
const busy = (job) => job?.state === "downloading" || job?.state === "packing";

/**
 * The Steam account signed in in this browser, its games and their installs,
 * for the library to show beside the bottles. Its session is this browser's
 * own (`steam/client.js`): the bridge's, or handed to the server with each
 * request. Installs are the server's, which only the second has.
 *
 * @param {() => void} onInstalled  A bottle was added: the library lists it.
 */
export function useSteam(onInstalled) {
  const [account, setAccount] = useState(/** @type {string | null} */ (null));
  const [games, setGames] = useState(/** @type {StoreGame[]} */ ([]));
  const [jobs, setJobs] = useState(/** @type {Map<number, InstallJob>} */ (new Map()));
  const [error, setError] = useState("");
  const [bridged, setBridged] = useState(false);
  const finished = useRef(new Set());

  const load = useCallback(async () => {
    setBridged(Boolean(await steamBridge()));
    const name = await steamAccountName();
    setAccount(name);
    if (!name) return;
    try {
      setGames(await steamGames());
    } catch (e) {
      setError(String(/** @type {Error} */ (e).message));
      return;
    }
    setError("");
    const list = await steamJobs();
    setJobs(new Map(list.map((job) => [job.appId, job])));
  }, []);
  useEffect(() => {
    load().catch((e) => setError(String(e?.message ?? e)));
  }, [load]);

  // The server measures sizes in the background, with a session it has: read
  // again while some are still the depots added up.
  const measuring = !bridged && games.some((game) => !game.bundle && !game.exact && game.bytes > 0);
  useEffect(() => {
    if (!measuring) return undefined;
    const timer = setInterval(() => load().catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, [measuring, load]);

  // Progress while an install runs; one that finishes adds its bottle to the library.
  const installing = [...jobs.values()].some(busy);
  useEffect(() => {
    if (!installing) return undefined;
    let stopped = false;
    const timer = setInterval(async () => {
      const list = await steamJobs();
      if (stopped) return;
      setJobs(new Map(list.map((/** @type {InstallJob} */ job) => [job.appId, job])));
      for (const job of list) {
        if (job.state === "done" && !finished.current.has(job.appId)) {
          finished.current.add(job.appId);
          setGames((now) => now.map((game) => (game.appId === job.appId
            ? { ...game, bundle: job.bundle ?? null } : game)));
          onInstalled();
        }
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [installing, onInstalled]);

  // Kept the same from render to render: the sign-in restarts when its callback changes.
  const signedIn = useCallback(async () => {
    await load();
  }, [load]);
  const signOut = useCallback(async () => {
    await signOutHere().catch((e) => setError(String(e?.message ?? e)));
    setAccount(null);
    setGames([]);
    setJobs(new Map());
    setError("");
  }, []);
  /** @param {number} appId */
  const install = useCallback(async (appId) => {
    const answer = await fetch("/steam/install", { method: "POST",
      headers: { ...await sessionHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ appId }) });
    /** @type {InstallJob} */
    const job = answer.ok ? await answer.json()
      : { appId, state: "failed", done: 0, total: 0, message: await answer.text() };
    setJobs((now) => new Map(now).set(appId, job));
  }, []);

  return { account, games, jobs, error, signedIn, signOut, install,
    installUnavailable: bridged ? NO_INSTALL_IN_BRIDGE : "" };
}

/**
 * The QR sign-in: a code from Steam's own authentication, approved in the
 * Steam app on the person's phone. The bridge talks to Steam for this page,
 * or else the launcher's server does and hands the session to it alone, so it
 * works on whatever address the launcher was opened by.
 *
 * @param {Object} props
 * @param {(account: { accountName: string }) => void} props.onSignedIn
 * @param {() => void} props.onClose
 */
export function SteamSignIn({ onSignedIn, onClose }) {
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState("Connecting to Steam…");
  useEffect(() => {
    const stop = new AbortController();
    (async () => {
      while (!stop.signal.aborted) {
        try {
          const account = await signIn({
            signal: stop.signal,
            onChallenge: (url) => {
              setQr(qrToSvg(encodeQr(url), 5));
              setStatus("Scan with the Steam app: Steam Guard → the QR scanner.");
            },
            onScanned: () => setStatus("Scanned. Approve the sign-in in the Steam app."),
          });
          onSignedIn(account);
          return;
        } catch (e) {
          if (stop.signal.aborted) return;
          setQr("");
          setStatus(`${/** @type {Error} */ (e).message} — a new code…`);
          // A moment before the next code, so a server that cannot reach
          // Steam is not asked again in a tight loop.
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    })();
    return () => stop.abort();
  }, [onSignedIn]);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sign in to Steam</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
          {qr
            ? <Box sx={{ bgcolor: "#fff", p: 1, borderRadius: 1, lineHeight: 0 }}
              dangerouslySetInnerHTML={{ __html: qr }} />
            : <CircularProgress />}
          <Typography variant="body2" color="text.secondary" align="center">{status}</Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            The session is kept in this browser only; your games then show in the library.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The foot of a Steam game's card in the library while it is not installed:
 * its size, and Install, or its download's progress.
 *
 * @param {Object} props
 * @param {StoreGame} props.game
 * @param {InstallJob | undefined} props.job
 * @param {() => void} props.onInstall
 * @param {string} [props.unavailable]  Why it cannot be installed here, if it cannot.
 */
export function SteamInstall({ game, job, onInstall, unavailable }) {
  return (
    <Box sx={{ pt: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {/* "~" while it is the depots added up, before its files are measured. */}
        {game.bytes > 0 ? `${game.exact ? "" : "~"}${size(game.bytes)}` : "size unknown"}
      </Typography>
      {job && busy(job) ? (
        <Box>
          <LinearProgress
            variant={job.total > 0 && job.state === "downloading" ? "determinate" : "indeterminate"}
            value={job.total > 0 ? Math.min(100, (100 * job.done) / job.total) : 0} />
          <Typography variant="caption" color="text.secondary" noWrap title={job.message}
            sx={{ display: "block" }}>
            {job.state === "downloading" && job.total > 0
              ? `${job.done} / ${job.total} MB · ${job.message}` : job.message}
          </Typography>
        </Box>
      ) : (
        <>
          <Button size="small" variant="outlined" onClick={onInstall}
            disabled={!game.launch || Boolean(unavailable)} title={unavailable || undefined}>
            {!game.launch ? "No Windows build" : unavailable ? "Install unavailable" : "Install"}
          </Button>
          {unavailable && game.launch && (
            <Typography variant="caption" color="text.secondary">{unavailable}</Typography>
          )}
          {job?.state === "failed" && (
            <Typography variant="caption" color="error" title={job.message} noWrap>
              {job.message}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
