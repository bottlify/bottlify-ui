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
import { NEEDS_GAMEHUB, knownProviders, loadProviders } from "../stores/providers.js";
import { signedInName } from "../stores/gamehub.js";

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

/**
 * The account and games a store last answered, kept in this browser so a
 * reload shows them at once while they are read again; a convenience, so any
 * failure to read or write it is no failure.
 *
 * @param {StoreProvider} provider
 * @returns {{ account: string | null, games: StoreGame[] }}
 */
const lastKnown = (provider) => {
  try {
    const kept = JSON.parse(localStorage.getItem(`bottlify.store.${provider.id}`) ?? "null");
    if (kept && Array.isArray(kept.games)) return { account: kept.account ?? null, games: kept.games };
  } catch {
    // Not kept, or not readable here.
  }
  return { account: null, games: [] };
};

/** @param {StoreProvider} provider @param {{ account: string | null, games: StoreGame[] } | null} what */
const keep = (provider, what) => {
  try {
    if (what) localStorage.setItem(`bottlify.store.${provider.id}`, JSON.stringify(what));
    else localStorage.removeItem(`bottlify.store.${provider.id}`);
  } catch {
    // Storage full or blocked: the next visit reads the store again, as it does anyway.
  }
};

/** @param {StoreProvider} provider @returns {StoreState} */
const fresh = (provider) => ({ provider, available: false, ...lastKnown(provider),
  jobs: new Map(), error: "", syncing: true });

/**
 * Every store's account in this browser, its games and their installs, for the
 * library to show beside the bottles and Settings to sign in to: the stores
 * GameHub lists, those it listed last time shown until it answers. `gamehub`
 * is false without GameHub, null until it is known.
 *
 * @param {() => void} onInstalled  A bottle was added: the library lists it.
 * @param {() => Promise<StoreProvider[]>} [load]  The stores, asked of GameHub.
 */
export function useStores(onInstalled, load = loadProviders) {
  const [providers, setProviders] = useState(knownProviders);
  const [gamehub, setGamehub] = useState(/** @type {boolean | null} */ (null));
  const [stores, setStores] = useState(() => providers.map(fresh));
  useEffect(() => {
    let gone = false;
    load().then((now) => {
      if (gone) return;
      setGamehub(now.length > 0);
      setProviders(now);
      setStores((all) => now.map((provider) =>
        ({ ...all.find((one) => one.provider.id === provider.id) ?? fresh(provider), provider })));
    }, () => !gone && setGamehub(false));
    return () => {
      gone = true;
    };
  }, [load]);
  /** Installs going on, by `<store>:<game>`. @type {import("react").MutableRefObject<Map<string, AbortController>>} */
  const going = useRef(new Map());

  /** @param {string} id @param {(now: StoreState) => Partial<StoreState>} change */
  const update = useCallback((id, change) => setStores((all) => all.map((one) =>
    (one.provider.id === id ? { ...one, ...change(one) } : one))), []);

  /** @param {StoreProvider} provider @param {{ fresh?: boolean }} [options] */
  // Read on every visit and on Sync; what was known before stays shown, marked
  // as being synced, until the store answers.
  const read = useCallback(async (provider, options = {}) => {
    update(provider.id, () => ({ syncing: true }));
    try {
      const available = await provider.available().catch(() => false);
      const account = available ? await provider.auth.account().catch(() => null) : null;
      update(provider.id, () => ({ available, account: account?.name ?? null,
        ...account ? {} : { games: [] } }));
      if (!account) {
        keep(provider, null);
        return;
      }
      const games = await provider.getList(options);
      update(provider.id, () => ({ games, error: "" }));
      keep(provider, { account: account.name ?? null, games });
    } catch (e) {
      update(provider.id, () => ({ error: String(/** @type {Error} */ (e)?.message ?? e) }));
    } finally {
      update(provider.id, () => ({ syncing: false }));
    }
  }, [update]);

  useEffect(() => {
    if (gamehub) for (const provider of providers) read(provider);
  }, [gamehub, providers, read]);

  const byId = useCallback((/** @type {string} */ id) =>
    /** @type {StoreProvider} */ (providers.find((one) => one.id === id)), [providers]);

  /** Signed in: its games read. @param {string} id */
  const signedIn = useCallback((id) => read(byId(id)), [read, byId]);

  /** @param {string} id */
  const signOut = useCallback(async (id) => {
    await byId(id).auth.signOut().catch((e) => update(id, () => ({ error: String(e?.message ?? e) })));
    update(id, () => ({ account: null, games: [], jobs: new Map(), error: "" }));
    keep(byId(id), null);
  }, [byId, update]);

  /** The account's games read again from the store. @param {string} id */
  const sync = useCallback((id) => read(byId(id), { fresh: true }), [byId, read]);

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

  return { stores, gamehub, signedIn, signOut, sync, install, cancel };
}

/**
 * A store's sign-in: GameHub's own page for the store in a frame -- a QR code,
 * or the account name and password with the store's second step. The page
 * is the extension's: what is typed there and the session it ends in stay in
 * GameHub, and this page is told the account's name.
 *
 * @param {Object} props
 * @param {StoreProvider} props.provider
 * @param {() => void} props.onSignedIn
 * @param {() => void} props.onClose
 */
export function StoreSignIn({ provider, onSignedIn, onClose }) {
  const [page, setPage] = useState(/** @type {string | null | undefined} */ (undefined));
  useEffect(() => {
    let gone = false;
    provider.auth.signInPage().then((url) => !gone && setPage(url), () => !gone && setPage(null));
    return () => {
      gone = true;
    };
  }, [provider]);
  useEffect(() => {
    if (!page) return undefined;
    const heard = (/** @type {MessageEvent} */ event) => {
      if (signedInName(event, page, provider.id) !== null) onSignedIn();
    };
    addEventListener("message", heard);
    return () => removeEventListener("message", heard);
  }, [page, provider, onSignedIn]);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sign in to {provider.name}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {page === undefined && <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress /></Box>}
        {page === null && <Alert severity="warning" sx={{ m: 2 }}>
          This version of the Bottlify GameHub extension cannot sign in here; update it.</Alert>}
        {page && <iframe src={page} title={`Sign in to ${provider.name}`}
          style={{ display: "block", width: "100%", height: 480, border: 0 }} />}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2, py: 1 }}>
          This sign-in is the Bottlify GameHub extension's: your password and the session stay in
          it, out of this page's reach; your games then show in the library.
        </Typography>
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
            {store.account
              ? `Signed in as ${store.account} · ${store.games.length} games`
                + (store.syncing ? " · syncing…" : "")
              : store.syncing ? "Connecting…"
                : !store.available ? provider.unavailable : "Not signed in"}
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
          ? "Add the Bottlify GameHub extension to this browser, then reload: sign-in, your games and "
            + "their installs all go through it."
          : store.account
            ? "Your games are in the library, each with Install. The session is kept by the "
              + "Bottlify GameHub extension in this browser."
            : `Sign in with the ${provider.name} app on your phone or with your password: the games `
              + "you own show in the library, each with Install. The session is kept by the Bottlify "
              + "GameHub extension in this browser."}
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
 * Settings → Game Accounts without GameHub: no store can be signed in to here.
 */
export function NoGameHub() {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5 }}>
      <Typography variant="subtitle2">Game stores</Typography>
      <Typography variant="body2" color="text.secondary">{NEEDS_GAMEHUB}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Add the Bottlify GameHub extension to this browser, then reload: sign-in, your games and
        their installs all go through it.
      </Typography>
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
