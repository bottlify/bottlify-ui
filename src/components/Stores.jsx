/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { knownProviders, loadProviders, storeProvider } from "../stores/providers.js";
import { steamDemoGames } from "../stores/demos.js";
import { gamehub as greetGameHub, signedInName } from "../stores/gamehub.js";
import { useT } from "../i18n.js";
import { useSettings } from "../useSettings.js";
import { DialogHead, SectionTitle } from "./kit.jsx";

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

/** Whether an install is going on. @param {InstallJob | undefined} job */
export const installing = (job) => job?.state === "downloading" || job?.state === "packing";

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

/**
 * What a store offers before any sign-in: Steam's demos (`demos.js`), which any
 * account is granted; nothing of any other store.
 *
 * @param {StoreProvider} provider @returns {StoreGame[]}
 */
const offered = (provider) => (provider.id === "steam" ? steamDemoGames() : []);

/** @param {StoreProvider} provider @returns {StoreState} */
const fresh = (provider) => {
  const known = lastKnown(provider);
  return { provider, available: false, ...known,
    games: known.account ? known.games : offered(provider),
    jobs: new Map(), error: "", syncing: true };
};

/**
 * The stores with Steam among them however GameHub answers: its demos are in
 * the library for everyone, GameHub or not, and their Install asks for it.
 *
 * @param {StoreProvider[]} list @returns {StoreProvider[]}
 */
const withSteam = (list) => (list.some((one) => one.id === "steam") ? list
  : [...list, storeProvider({ id: "steam", name: "Steam" })]);

/**
 * Every store's account in this browser, its games and their installs, for the
 * library to show beside the bottles and Settings to sign in to: the stores
 * GameHub lists, those it listed last time shown until it answers. `gamehub`
 * is false without GameHub, null until it is known.
 *
 * @param {() => void} onInstalled  A bottle was added: the library lists it.
 * @param {() => Promise<StoreProvider[]>} [load]  The stores, asked of GameHub.
 * @param {boolean} [active]  Whether the accounts are read now: where they are of use.
 */
export function useStores(onInstalled, load = loadProviders, active = true) {
  const [providers, setProviders] = useState(() => withSteam(knownProviders()));
  const [gamehub, setGamehub] = useState(/** @type {boolean | null} */ (null));
  const [stores, setStores] = useState(() => providers.map(fresh));
  useEffect(() => {
    let gone = false;
    load().then((listed) => {
      if (gone) return;
      setGamehub(listed.length > 0);
      const now = withSteam(listed);
      setProviders(now);
      // Without GameHub nothing is read: what each store offers anyone stays, not syncing.
      setStores((all) => now.map((provider) =>
        ({ ...all.find((one) => one.provider.id === provider.id) ?? fresh(provider), provider,
          ...listed.length > 0 ? {} : { syncing: false, account: null, games: offered(provider) } })));
    }, () => {
      if (gone) return;
      setGamehub(false);
      setStores((all) => all.map((one) =>
        ({ ...one, syncing: false, account: null, games: offered(one.provider) })));
    });
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
      // A Sync logs on anew here, so a session Steam no longer takes is found and
      // forgotten by GameHub before the list is asked of it.
      const account = available ? await provider.auth.account(options).catch(() => null) : null;
      // Signed out: what the store offers anyone, whose Install asks for the sign-in.
      update(provider.id, () => ({ available, account: account?.name ?? null,
        ...account ? {} : { games: offered(provider) } }));
      if (!account) {
        keep(provider, null);
        return;
      }
      const games = await provider.getList();
      update(provider.id, () => ({ games, error: "" }));
      keep(provider, { account: account.name ?? null, games });
    } catch (e) {
      update(provider.id, () => ({ error: String(/** @type {Error} */ (e)?.message ?? e) }));
    } finally {
      update(provider.id, () => ({ syncing: false }));
    }
  }, [update]);

  // Read where the stores are of use (`active`), and again each time they are.
  useEffect(() => {
    if (gamehub && active) for (const provider of providers) read(provider);
  }, [gamehub, providers, read, active]);

  const byId = useCallback((/** @type {string} */ id) =>
    /** @type {StoreProvider} */ (providers.find((one) => one.id === id)), [providers]);

  /** Signed in: its games read. @param {string} id */
  const signedIn = useCallback((id) => read(byId(id)), [read, byId]);

  /** @param {string} id */
  const signOut = useCallback(async (id) => {
    await byId(id).auth.signOut().catch((e) => update(id, () => ({ error: String(e?.message ?? e) })));
    update(id, () => ({ account: null, games: [], jobs: new Map(), error: "" }));
    keep(byId(id), null);
    // What it offers anyone is listed again.
    await read(byId(id));
  }, [byId, update, read]);

  /** The account's games read again from the store. @param {string} id */
  const sync = useCallback((id) => read(byId(id), { fresh: true }), [byId, read]);

  /** The store whose sign-in an Install asked for, shown over the library. */
  const [signInFor, setSignInFor] = useState(/** @type {string | null} */ (null));
  /** The stores as last rendered, for an Install to read its account. */
  const current = useRef(stores);
  current.current = stores;

  /** @param {string} id @param {StoreGame} game */
  const install = useCallback(async (id, game) => {
    // A game offered to anyone signed in, Install pressed signed out: the sign-in first.
    if (!current.current.find((one) => one.provider.id === id)?.account) {
      setSignInFor(id);
      return;
    }
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

  /** The sign-in an Install asked for ended: signed in, the store is read again. */
  const signInDone = useCallback(async () => {
    const id = signInFor;
    setSignInFor(null);
    if (id) await signedIn(id);
  }, [signInFor, signedIn]);

  const closeSignIn = useCallback(() => setSignInFor(null), []);

  return { stores, gamehub, signedIn, signOut, sync, install, cancel,
    signInFor: signInFor ? stores.find((one) => one.provider.id === signInFor) ?? null : null,
    signInDone, closeSignIn };
}

/**
 * A store's sign-in: GameHub's own page for the store in a frame -- a QR code,
 * or the account name and password with the store's second step -- or a window
 * of the store's own site. The page is the extension's: what is typed there and
 * the session it ends in stay in GameHub, and this page is told the account's name.
 *
 * @param {Object} props
 * @param {StoreProvider} props.provider
 * @param {() => void} props.onSignedIn
 * @param {() => void} props.onClose
 */
export function StoreSignIn({ provider, onSignedIn, onClose }) {
  const t = useT();
  const { developer } = useSettings();
  const [page, setPage] = useState(/** @type {string | null | undefined} */ (undefined));
  /** A sign-in in a window of the store's site: going on, or what it ended in. */
  const [inWindow, setInWindow] = useState(/** @type {string | null} */ (null));
  // Read when the window's sign-in ends: one window per dialog, whatever renders between.
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;
  /** What GameHub said of itself, for a sign-in it cannot give here. */
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (page !== null) return;
    greetGameHub().then((hello) => setSaid(hello
      ? `GameHub ${hello.version} at ${hello.origin ?? "no origin"}, its stores run ${
        hello.transport === "tab" ? "in a tab" : "in a frame"}`
      : "GameHub is not on this page: the extension is off here, or not allowed on this site"));
  }, [page]);
  useEffect(() => {
    let gone = false;
    provider.auth.signInWindow().then((opened) => {
      if (gone) return;
      if (!opened) {
        provider.auth.signInPage().then((url) => !gone && setPage(url), () => !gone && setPage(null));
        return;
      }
      setInWindow("");
      opened.done.then(() => !gone && signedIn.current(),
        (e) => !gone && setInWindow(String(e?.message ?? e)));
    }, () => !gone && setPage(null));
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
      <DialogHead title={t("accounts.signInTo", { store: provider.name })} onClose={onClose}
        closeLabel={t("button.close")} />
      <DialogContent sx={{ px: 4 }}>
        {inWindow === "" && <Typography>{t("accounts.windowOpened", { store: provider.name })}</Typography>}
        {inWindow && <Alert severity="warning" variant="outlined">{inWindow}</Alert>}
        {page === undefined && inWindow === null
          && <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>}
        {page === null && <Alert severity="warning" variant="outlined">
          {t("accounts.updateGameHub")}
          {developer && said && <Typography variant="caption" component="p">{said}</Typography>}</Alert>}
        {page && <iframe src={page} title={t("accounts.signInTo", { store: provider.name })}
          style={{ display: "block", width: "100%", height: 480, border: 0, borderRadius: 9 }} />}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("accounts.kept")}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 4 }}>
        <Button onClick={onClose}>{t("button.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Install pressed on a store's game with no GameHub in this browser: the
 * store's account is GameHub's to sign in to, so the extension comes first.
 *
 * @param {Object} props
 * @param {StoreProvider} props.provider
 * @param {string | null} [props.link]  Where GameHub is got, where the site says.
 * @param {() => void} props.onAccounts  Opens Settings → Accounts.
 * @param {() => void} props.onClose
 */
export function GameHubNeeded({ provider, link = null, onAccounts, onClose }) {
  const t = useT();
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogHead title={t("accounts.needSignIn", { store: provider.name })} onClose={onClose}
        closeLabel={t("button.close")} />
      <DialogContent sx={{ px: 4 }}>
        <Typography>{t("accounts.needGameHub", { store: provider.name })}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{t("accounts.kept")}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 4 }}>
        {link && <Button href={link} target="_blank" rel="noopener">{t("accounts.getGameHub")}</Button>}
        <Button variant="contained" onClick={onAccounts}>{t("settings.accounts")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * A store in Settings → Accounts: the account signed in in this browser and
 * Sign out, or Sign in; or what it needs to be used here; and what it last
 * answered wrong, since the library shows only the games and would otherwise
 * just be missing them.
 *
 * @param {Object} props
 * @param {StoreState} props.store
 * @param {ReturnType<typeof useStores>} props.stores
 * @param {string | null} [props.link]  Where GameHub is got, where the site says.
 */
export function StoreAccount({ store, stores, link = null }) {
  const t = useT();
  const [signingIn, setSigningIn] = useState(false);
  const { provider } = store;
  const { signedIn } = stores;
  const done = useCallback(async () => {
    setSigningIn(false);
    await signedIn(provider.id);
  }, [signedIn, provider]);
  return (
    <Box component="section" sx={{ py: 2, borderBottom: "1px solid", borderColor: "divider",
      "&:last-of-type": { borderBottom: 0 } }}>
      <SectionTitle>{provider.name}</SectionTitle>
      <Typography color="text.secondary" sx={{ mb: 2, mt: 0.5 }}>
        {!store.available && !store.syncing ? t("accounts.needExtension")
          : store.account ? t("accounts.signedInAs", { name: store.account })
            : store.syncing ? t("accounts.connecting") : t("accounts.why", { store: provider.name })}
      </Typography>
      <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap" }}>
        {store.available && (store.account ? (<>
          <Button disabled={store.syncing} onClick={() => stores.sync(provider.id)}>
            {store.syncing ? t("accounts.syncing") : t("accounts.sync")}
          </Button>
          <Button onClick={() => stores.signOut(provider.id)}>{t("accounts.signOut")}</Button>
        </>) : (
          <Button variant="contained" onClick={() => setSigningIn(true)}>
            {t("accounts.signIn", { store: provider.name })}
          </Button>
        ))}
        {!store.available && !store.syncing && link && (
          <Button href={link} target="_blank" rel="noopener">{t("accounts.getGameHub")}</Button>
        )}
      </Box>
      {store.error && (
        <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
          {t("accounts.error", { store: provider.name, reason: store.error })}
        </Alert>
      )}
      {signingIn && <StoreSignIn provider={provider} onSignedIn={done} onClose={() => setSigningIn(false)} />}
    </Box>
  );
}
