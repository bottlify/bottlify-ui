/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, Stack, Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { connectCm, encodeQr, qrToSvg, signInWithQr } from "@bottlify/core/steam";

/** Where this browser keeps the session too, as the /steam page does. */
const KEPT = "bottlify.steam.session";

/** @param {number} bytes */
const size = (bytes) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB`
  : `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`);

/**
 * The QR sign-in: a code from Steam's own authentication, approved in the
 * Steam app on the person's phone. The connection to Steam leaves this page,
 * which Steam lets in from localhost alone.
 *
 * @param {Object} props
 * @param {(session: { accountName: string, refreshToken: string }) => void} props.onSignedIn
 */
function SignIn({ onSignedIn }) {
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState("Connecting to Steam…");
  useEffect(() => {
    if (window.location.hostname !== "localhost") {
      setStatus(`Steam lets a sign-in start only from localhost: open https://localhost:${
        window.location.port}/library on the machine that runs the launcher.`);
      return undefined;
    }
    const run = { stopped: false };
    /** @type {any} */
    let connection = null;
    (async () => {
      const endpoints = await (await fetch("/steam/managers")).json();
      const connect = async () => {
        if (connection && !connection.closed) return connection;
        for (const endpoint of endpoints) {
          try {
            connection = await connectCm({ endpoint });
            return connection;
          } catch {
            // the next one
          }
        }
        throw new Error("no Steam connection manager answered");
      };
      while (!run.stopped) {
        try {
          const signedIn = await signInWithQr(connect, {
            deviceName: "Bottlify",
            onChallenge: (url) => {
              setQr(qrToSvg(encodeQr(url), 5));
              setStatus("Scan with the Steam app: Steam Guard → the QR scanner.");
            },
            onScanned: () => setStatus("Scanned. Approve the sign-in in the Steam app."),
          });
          if (!run.stopped) onSignedIn(signedIn);
          return;
        } catch (e) {
          if (!run.stopped) setStatus(`${/** @type {Error} */ (e).message} — a new code`);
        }
      }
    })().catch((e) => setStatus(String(e?.message ?? e)));
    return () => {
      run.stopped = true;
      connection?.close?.();
    };
  }, [onSignedIn]);
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
      {qr
        ? <Box sx={{ bgcolor: "#fff", p: 1, borderRadius: 1, lineHeight: 0 }}
          dangerouslySetInnerHTML={{ __html: qr }} />
        : <CircularProgress />}
      <Typography variant="body2" color="text.secondary" align="center">{status}</Typography>
    </Stack>
  );
}

/**
 * One game of the account: its cover, name and size, and what can be done
 * with it here -- installed into a bottle, followed while it downloads, or
 * played once it is.
 *
 * @param {Object} props
 * @param {import("../../steam-store.mjs").StoreGame} props.game
 * @param {import("../../steam-store.mjs").InstallJob | undefined} props.job
 * @param {() => void} props.onInstall
 * @param {(bundle: string) => void} props.onPlay
 */
function StoreCard({ game, job, onInstall, onPlay }) {
  const busy = job && (job.state === "downloading" || job.state === "packing");
  return (
    <Box sx={{ width: 150, display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box component="img" src={game.capsule} alt="" loading="lazy"
        onError={(event) => { /** @type {HTMLImageElement} */ (event.target).src = game.header; }}
        sx={{ width: 150, height: 225, objectFit: "cover", borderRadius: 1, bgcolor: "action.hover" }} />
      <Typography variant="body2" noWrap title={game.name}>{game.name}</Typography>
      <Typography variant="caption" color="text.secondary">
        {game.bytes > 0 ? size(game.bytes) : "size unknown"}
      </Typography>
      {busy ? (
        <Box>
          <LinearProgress
            variant={job.total > 0 && job.state === "downloading" ? "determinate" : "indeterminate"}
            value={job.total > 0 ? Math.min(100, (100 * job.done) / job.total) : 0} />
          <Typography variant="caption" color="text.secondary" noWrap title={job.message}>
            {job.state === "downloading" && job.total > 0
              ? `${job.done} / ${job.total} MB · ${job.message}` : job.message}
          </Typography>
        </Box>
      ) : game.bundle ? (
        <Button size="small" variant="contained" onClick={() => onPlay(/** @type {string} */ (game.bundle))}>
          Play
        </Button>
      ) : (
        <>
          <Button size="small" variant="outlined" onClick={onInstall} disabled={!game.launch}>
            {game.launch ? "Install" : "No Windows build"}
          </Button>
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

/**
 * Add from Steam: signed in once with a QR code, the account's games listed
 * with their art and size, each installed into a bottle with the account's
 * own session and played from the library, Steam running for that account.
 *
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {() => void} props.onInstalled  A bottle was added: the library lists it.
 * @param {(bundle: string) => void} props.onPlay
 */
export function SteamStore({ onClose, onInstalled, onPlay }) {
  const [phase, setPhase] = useState(/** @type {"checking" | "signin" | "library" | "error"} */ ("checking"));
  const [games, setGames] = useState(/** @type {any[]} */ ([]));
  const [jobs, setJobs] = useState(/** @type {Map<number, any>} */ (new Map()));
  const [error, setError] = useState("");
  const finished = useRef(new Set());

  const load = async () => {
    setPhase("checking");
    const answer = await fetch("/steam/library");
    if (answer.status === 404) {
      setPhase("signin");
      return;
    }
    if (!answer.ok) {
      setError(await answer.text());
      setPhase("error");
      return;
    }
    setGames(await answer.json());
    setPhase("library");
  };
  useEffect(() => {
    load().catch((e) => {
      setError(String(e?.message ?? e));
      setPhase("error");
    });
  }, []);

  // Every install's progress while the store is open; one that finishes adds
  // its bottle to the library.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const list = await fetch("/steam/install").then((r) => r.json()).catch(() => []);
      if (stopped) return;
      setJobs(new Map(list.map((/** @type {any} */ job) => [job.appId, job])));
      for (const job of list) {
        if (job.state === "done" && !finished.current.has(job.appId)) {
          finished.current.add(job.appId);
          setGames((now) => now.map((game) => (game.appId === job.appId
            ? { ...game, bundle: job.bundle } : game)));
          onInstalled();
        }
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [onInstalled]);

  /** @param {{ accountName: string, refreshToken: string }} session */
  const signedIn = async (session) => {
    try {
      localStorage.setItem(KEPT, JSON.stringify(session));
    } catch {
      // no storage here: the server's copy is the one used
    }
    await fetch("/steam/session", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(session) });
    await load();
  };
  const signOut = async () => {
    try {
      localStorage.removeItem(KEPT);
    } catch {
      // nothing kept
    }
    await fetch("/steam/session", { method: "DELETE" });
    setGames([]);
    setPhase("signin");
  };
  /** @param {number} appId */
  const install = async (appId) => {
    const answer = await fetch("/steam/install", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ appId }) });
    const job = answer.ok ? await answer.json()
      : { appId, state: "failed", done: 0, total: 0, message: await answer.text() };
    setJobs((now) => new Map(now).set(appId, job));
  };

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Add from Steam</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 320 }}>
        {phase === "checking" && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
        )}
        {phase === "signin" && <SignIn onSignedIn={signedIn} />}
        {phase === "error" && <Alert severity="error">{error}</Alert>}
        {phase === "library" && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {games.map((game) => (
              <StoreCard key={game.appId} game={game} job={jobs.get(game.appId)}
                onInstall={() => install(game.appId)} onPlay={onPlay} />
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {phase === "library" && <Button onClick={signOut} color="inherit">Sign out of Steam</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
