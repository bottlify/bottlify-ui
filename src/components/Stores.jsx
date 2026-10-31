/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, Stack, Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeQr, qrToSvg } from "@bottlify/core/steam";
import { PROVIDERS } from "../stores/providers.js";

/** @typedef {import("../stores/providers.js").StoreProvider} StoreProvider */
/** @typedef {import("../stores/providers.js").StoreGame} StoreGame */

/**
 * @typedef {Object} InstallJob  An install of a store's game in this browser, as a card shows it.
 * @property {"downloading" | "packing" | "done" | "failed"} state
 * @property {number} done  MiB.
 * @property {number} total  MiB, once known.
 * @property {string} message
 * @property {string} [bundle]  The bottle, once installed.
 */

/**
 * @typedef {Object} StoreState  A store as the library and Settings show it.
 * @property {StoreProvider} provider
 * @property {boolean} available
 * @property {string | null} account  The signed-in account's name.
 * @property {StoreGame[]} games
 * @property {Map<string, InstallJob>} jobs  By the store's game id.
 * @property {string} error  What the store last answered wrong.
 * @property {boolean} syncing
 */

/** @param {number} bytes */
const size = (bytes) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB`
  : `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`);

/** @param {InstallJob | undefined} job */
const busy = (job) => job?.state === "downloading" || job?.state === "packing";

/** @param {StoreProvider} provider @returns {StoreState} */
const fresh = (provider) => ({ provider, available: false, account: null, games: [],
  jobs: new Map(), error: "", syncing: false });

/**
 * Every store's account in this browser, its games and their installs, for the
 * library to show beside the bottles and Settings to sign in to.
 *
 * @param {() => void} onInstalled  A bottle was added: the library lists it.
 * @param {StoreProvider[]} [providers]
 */
export function useStores(onInstalled, providers = PROVIDERS) {
  const [stores, setStores] = useState(() => providers.map(fresh));
  /** Installs going on, by `<store>:<game>`. @type {import("react").MutableRefObject<Map<string, AbortController>>} */
  const going = useRef(new Map());

  /** @param {string} id @param {(now: StoreState) => Partial<StoreState>} change */
  const update = useCallback((id, change) => setStores((all) => all.map((one) =>
    (one.provider.id === id ? { ...one, ...change(one) } : one))), []);

  /** @param {StoreProvider} provider @param {{ fresh?: boolean }} [options] */
  const load = useCallback(async (provider, options = {}) => {
    const available = await provider.available().catch(() => false);
    const account = available ? await provider.auth.account().catch(() => null) : null;
    update(provider.id, () => ({ available, account: account?.name ?? null,
      ...account ? {} : { games: [] } }));
    if (!account) return;
    try {
      const games = await provider.getList(options);
      update(provider.id, () => ({ games, error: "" }));
    } catch (e) {
      update(provider.id, () => ({ error: String(/** @type {Error} */ (e)?.message ?? e) }));
    }
  }, [update]);

  useEffect(() => {
    for (const provider of providers) load(provider);
  }, [providers, load]);

  const byId = useCallback((/** @type {string} */ id) =>
    /** @type {StoreProvider} */ (providers.find((one) => one.id === id)), [providers]);

  /** Signed in: its games read. @param {string} id */
  const signedIn = useCallback((id) => load(byId(id)), [load, byId]);

  /** @param {string} id */
  const signOut = useCallback(async (id) => {
    await byId(id).auth.signOut().catch((e) => update(id, () => ({ error: String(e?.message ?? e) })));
    update(id, () => ({ account: null, games: [], jobs: new Map(), error: "" }));
  }, [byId, update]);

  /** The account's games read again from the store. @param {string} id */
  const sync = useCallback(async (id) => {
    update(id, () => ({ syncing: true }));
    await load(byId(id), { fresh: true });
    update(id, () => ({ syncing: false }));
  }, [byId, load, update]);

  /** @param {string} id @param {StoreGame} game */
  const install = useCallback(async (id, game) => {
    const key = `${id}:${game.id}`;
    if (going.current.has(key)) return;
    const stop = new AbortController();
    going.current.set(key, stop);
    /** @param {Partial<InstallJob>} job */
    const show = (job) => update(id, (now) => ({ jobs: new Map(now.jobs).set(game.id,
      { state: "downloading", done: 0, total: 0, message: "", ...job }) }));
    try {
      const bundle = await byId(id).install(game, show, stop.signal);
      show({ state: "done", bundle, message: "Installed" });
      onInstalled();
    } catch (e) {
      show({ state: "failed", message: String(/** @type {Error} */ (e)?.message ?? e) });
    } finally {
      going.current.delete(key);
    }
  }, [byId, update, onInstalled]);

  /** Stops an install; Install goes on from where it stopped. @param {string} id @param {StoreGame} game */
  const cancel = useCallback((id, game) => going.current.get(`${id}:${game.id}`)?.abort(), []);

  return { stores, signedIn, signOut, sync, install, cancel };
}

/**
 * A store's QR sign-in: a code from the store's own authentication, approved
 * in its app on the person's phone.
 *
 * @param {Object} props
 * @param {StoreProvider} props.provider
 * @param {() => void} props.onSignedIn
 * @param {() => void} props.onClose
 */
export function StoreSignIn({ provider, onSignedIn, onClose }) {
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState(`Connecting to ${provider.name}…`);
  useEffect(() => {
    const stop = new AbortController();
    (async () => {
      while (!stop.signal.aborted) {
        try {
          await provider.auth.signIn({
            signal: stop.signal,
            onChallenge: (url) => {
              setQr(qrToSvg(encodeQr(url), 5));
              setStatus(`Scan with the ${provider.name} app on your phone.`);
            },
            onScanned: () => setStatus(`Scanned. Approve the sign-in in the ${provider.name} app.`),
          });
          onSignedIn();
          return;
        } catch (e) {
          if (stop.signal.aborted) return;
          setQr("");
          setStatus(`${/** @type {Error} */ (e).message} — a new code…`);
          // A moment before the next code, so a store that cannot be reached
          // is not asked again in a tight loop.
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    })();
    return () => stop.abort();
  }, [provider, onSignedIn]);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sign in to {provider.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
          {qr
            ? <Box sx={{ bgcolor: "#fff", p: 1, borderRadius: 1, lineHeight: 0 }}
              dangerouslySetInnerHTML={{ __html: qr }} />
            : <CircularProgress />}
          <Typography variant="body2" color="text.secondary" align="center">{status}</Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            The session is kept by the Bottlify extension; your games then show in the library.
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
 * A store in Settings → Game Accounts: the account signed in in this browser,
 * Sync and Sign out, or Sign in; or what it needs to be used here; and what it
 * last answered wrong, since the library shows only the games and would
 * otherwise just be missing them.
 *
 * @param {Object} props
 * @param {StoreState} props.store
 * @param {ReturnType<typeof useStores>} props.stores
 */
export function StoreAccount({ store, stores }) {
  const [signingIn, setSigningIn] = useState(false);
  const { provider } = store;
  const { signedIn } = stores;
  const done = useCallback(async () => {
    setSigningIn(false);
    await signedIn(provider.id);
  }, [signedIn, provider]);
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">{provider.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
            {!store.available ? provider.unavailable : store.account
              ? `Signed in as ${store.account} · ${store.games.length} games`
              : "Not signed in"}
          </Typography>
        </Box>
        {store.account && (
          <Button size="small" variant="outlined" color="inherit" disabled={store.syncing}
            onClick={() => stores.sync(provider.id)}>
            {store.syncing ? "Syncing…" : "Sync"}
          </Button>
        )}
        {store.available && (store.account
          ? <Button size="small" variant="outlined" color="inherit"
            onClick={() => stores.signOut(provider.id)}>Sign out</Button>
          : <Button size="small" variant="contained" onClick={() => setSigningIn(true)}>Sign in</Button>)}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {!store.available
          ? "Add the Bottlify extension to this browser, then reload: sign-in, your games and "
            + "their installs all go through it."
          : store.account
            ? "Your games are in the library, each with Install. The session is kept by the "
              + "Bottlify extension in this browser."
            : `Sign in with the ${provider.name} app on your phone: the games you own show in the `
              + "library, each with Install. The session is kept by the Bottlify extension in this browser."}
      </Typography>
      {store.error && (
        <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
          {provider.name} answered with an error: {store.error}
        </Alert>
      )}
      {signingIn && <StoreSignIn provider={provider} onSignedIn={done} onClose={() => setSigningIn(false)} />}
    </Box>
  );
}

/**
 * The foot of a store game's card in the library while it is not installed:
 * its size, and Install, or its download's progress with Cancel.
 *
 * @param {Object} props
 * @param {StoreGame} props.game
 * @param {InstallJob | undefined} props.job
 * @param {() => void} props.onInstall
 * @param {() => void} props.onCancel
 */
export function StoreInstall({ game, job, onInstall, onCancel }) {
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" noWrap title={job.message}
              sx={{ flex: 1, minWidth: 0 }}>
              {job.state === "downloading" && job.total > 0
                ? `${job.done} / ${job.total} MB · ${job.message}` : job.message}
            </Typography>
            <Button size="small" color="inherit" onClick={onCancel} sx={{ minWidth: 0, px: 1 }}>
              Cancel
            </Button>
          </Box>
        </Box>
      ) : (
        <>
          <Button size="small" variant="outlined" onClick={onInstall} disabled={!game.installable}>
            {!game.installable ? "No Windows build" : "Install"}
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
