/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Stack, Tooltip, Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { getAvailableBundles, getUnlistedBundle } from "../api/bundles.js";
import {
  STORAGE_CHANGED, clearAllCaches, clearCache, deleteSaves, removeFromDevice, siteSpace, sizeText,
  storedBottles,
} from "../engine/stored.js";

/** How often the bar reads the room again while it is on screen. */
const SPACE_POLL_MS = 60_000;

/** The colour each level of room is shown in. */
const SPACE_COLOR = { ok: "text.secondary", low: "warning.main", short: "error.main" };

/** Tells what shows the room that this page removed something. */
const changed = () => window.dispatchEvent(new Event(STORAGE_CHANGED));

/**
 * The room this site has left, always in the library's bar: read when it
 * appears -- which is also when a run ends, the bar coming back with the
 * library -- every minute while it shows, and whenever something was cleared.
 *
 * @param {Object} props
 * @param {() => void} props.onOpen  Opens the storage section.
 */
export function SpaceIndicator({ onOpen }) {
  const [space, setSpace] = useState(/** @type {Awaited<ReturnType<typeof siteSpace>>} */ (null));
  useEffect(() => {
    let live = true;
    const read = () => siteSpace().then((now) => live && setSpace(now), () => {});
    read();
    const timer = setInterval(read, SPACE_POLL_MS);
    window.addEventListener(STORAGE_CHANGED, read);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(STORAGE_CHANGED, read);
    };
  }, []);
  if (!space) return null;
  return (
    <Tooltip title={"Space this browser gives this site, by its own estimate -- not the disk's free "
      + "space. Click to see what each bottle keeps here."}>
      <Button size="small" color="inherit" onClick={onOpen}
        sx={{ color: SPACE_COLOR[space.level], textTransform: "none", whiteSpace: "nowrap" }}>
        {sizeText(space.free)} free of {sizeText(space.quota)}
      </Button>
    </Tooltip>
  );
}

/** The kinds a row names, in the order it names them. */
const KINDS = [
  ["blocks", "Downloaded"], ["translations", "Translated code"], ["saves", "Saves"],
  ["local", "Bottle"], ["edits", "Your edited files"],
];

/**
 * Everything this browser keeps of each bottle, and the means to let it go:
 * a cache to clear, saves to delete, a bottle to remove from this device.
 * A bottle a run holds -- here or in another tab -- is left alone.
 */
export function StorageSettings() {
  const [state, setState] = useState(/** @type {any} */ (null));
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  const [notice, setNotice] = useState(/** @type {string | null} */ (null));
  const [working, setWorking] = useState(false);
  /** The action waiting on its confirmation. */
  const [asking, setAsking] = useState(/** @type {any} */ (null));

  const read = useCallback(async () => {
    try {
      const library = await getAvailableBundles().catch(() => []);
      setState(await storedBottles({ library, lookup: getUnlistedBundle }));
    } catch (error) {
      setFailure(`What this browser keeps could not be read: ${/** @type {any} */ (error)?.message ?? error}`);
    }
  }, []);
  useEffect(() => {
    read();
  }, [read]);

  /** @param {() => Promise<string | null>} work */
  const run = async (work) => {
    setAsking(null);
    setWorking(true);
    setFailure(null);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (error) {
      setFailure(String(/** @type {any} */ (error)?.message ?? error));
    } finally {
      setWorking(false);
      changed();
      await read();
    }
  };

  /** @param {any} bottle */
  const ask = {
    cache: (bottle) => setAsking({
      title: `Clear the cache of ${bottle.title}?`,
      text: "Its downloaded game data and translated code are erased. The next start downloads "
        + "and translates again, and is slower for it. Saved games are not touched.",
      action: "Clear cache",
      work: async () => {
        await clearCache(bottle);
        return `The cache of ${bottle.title} is cleared.`;
      },
    }),
    saves: (bottle) => setAsking({
      title: `Delete the saves of ${bottle.title}?`,
      text: "Everything the program wrote in this browser -- saved games, its settings -- is "
        + "deleted and cannot be brought back.",
      action: "Delete saves",
      strong: true,
      work: async () => {
        await deleteSaves(bottle);
        return `The saves of ${bottle.title} are deleted.`;
      },
    }),
    remove: (bottle) => setAsking({
      title: `Remove ${bottle.title} from this device?`,
      text: `Everything this browser keeps of it is deleted: ${bottle.local ? "the bottle, " : ""}`
        + "your saved games, the files you edited in it and its cache. None of it can be brought "
        + "back.",
      action: "Remove",
      strong: true,
      work: async () => {
        await removeFromDevice(bottle);
        return `${bottle.title} is removed from this device.`;
      },
    }),
    all: () => setAsking({
      title: "Clear every cache?",
      text: "Every bottle's downloaded game data and translated code are erased; each downloads "
        + "and translates again at its next start. Saved games are not touched.",
      action: "Clear all caches",
      work: async () => {
        const { skipped, failed } = await clearAllCaches(state?.bottles ?? []);
        return [
          "The caches are cleared.",
          skipped.length ? `Running, so left as they are: ${skipped.join(", ")}.` : "",
          failed.length ? `Could not be cleared: ${failed.join(", ")}.` : "",
        ].filter(Boolean).join(" ");
      },
    }),
  };

  if (!state && !failure) {
    return <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}><CircularProgress size={24} /></Box>;
  }
  const bottles = state?.bottles ?? [];
  const cached = bottles.some((one) => one.bytes.blocks + one.bytes.translations > 0);
  return (
    <Box sx={{ p: 2, overflowY: "auto" }}>
      {state && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2">
            {state.usage === null || state.quota === null
              ? "This browser does not say how much space this site uses."
              : `This site uses ${sizeText(state.usage)} of the ${sizeText(state.quota)} this `
                + "browser gives it (the browser's estimate, not the disk's free space)."}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {state.persisted === true
              ? "Kept: the browser does not clear it when the disk runs low."
              : state.persisted === false
                ? "Not kept for sure: the browser may clear all of it, saves too, when the disk runs low."
                : "Whether the browser keeps it when the disk runs low is not known."}
          </Typography>
          <Button size="small" color="error" variant="outlined" sx={{ mt: 1.5 }}
            disabled={working || !cached} onClick={ask.all}>
            Clear all caches…
          </Button>
        </Box>
      )}
      {failure && <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
        onClose={() => setFailure(null)}>{failure}</Alert>}
      {notice && <Alert severity="success" variant="outlined" sx={{ mb: 2 }}
        onClose={() => setNotice(null)}>{notice}</Alert>}
      {state && bottles.length === 0 && (
        <Typography variant="body2" color="text.secondary">Nothing is kept in this browser.</Typography>
      )}
      <Stack gap={1.5}>
        {bottles.map((bottle) => (
          <Box key={bottle.key} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ flexWrap: "wrap" }}>
              <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                {bottle.title}
              </Typography>
              <Typography variant="subtitle2">{sizeText(bottle.total)}</Typography>
            </Stack>
            <Stack direction="row" gap={0.75} sx={{ flexWrap: "wrap", my: 0.75 }}>
              {!bottle.named && <Chip size="small" label="No name found: shown by its id" />}
              {!bottle.listed && <Chip size="small" label="Not in the library" />}
              {bottle.local && <Chip size="small" label="Kept in this browser" />}
              {bottle.busy && <Chip size="small" color="warning" label="Running" />}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {KINDS.filter(([kind]) => bottle.bytes[kind] > 0)
                .map(([kind, label]) => `${label} ${sizeText(bottle.bytes[kind])}`).join(" · ")}
            </Typography>
            <Tooltip title={bottle.busy ? "It is running: stop it first." : ""}>
              <Stack direction="row" gap={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                <Button size="small" color="inherit" variant="outlined"
                  disabled={working || bottle.busy || bottle.bytes.blocks + bottle.bytes.translations === 0}
                  onClick={() => ask.cache(bottle)}>
                  Clear cache…
                </Button>
                <Button size="small" color="error" variant="outlined"
                  disabled={working || bottle.busy || bottle.bytes.saves === 0}
                  onClick={() => ask.saves(bottle)}>
                  Delete saves…
                </Button>
                {(bottle.local || !bottle.listed) && (
                  <Button size="small" color="error" variant="outlined" disabled={working || bottle.busy}
                    onClick={() => ask.remove(bottle)}>
                    Remove from this device…
                  </Button>
                )}
              </Stack>
            </Tooltip>
          </Box>
        ))}
      </Stack>
      {asking && <Confirm asking={asking} onCancel={() => setAsking(null)} onConfirm={() => run(asking.work)} />}
    </Box>
  );
}

/**
 * Asks once for a cache, and for what cannot be brought back asks the person
 * to say so in a box before the button does anything.
 *
 * @param {Object} props
 * @param {{ title: string, text: string, action: string, strong?: boolean }} props.asking
 * @param {() => void} props.onCancel
 * @param {() => void} props.onConfirm
 */
function Confirm({ asking, onCancel, onConfirm }) {
  const [sure, setSure] = useState(false);
  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>{asking.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">{asking.text}</Typography>
        {asking.strong && (
          <FormControlLabel sx={{ mt: 1 }}
            control={<Checkbox checked={sure} onChange={(event) => setSure(event.target.checked)} />}
            label={<Typography variant="body2">I understand this cannot be undone</Typography>} />
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onCancel}>Cancel</Button>
        <Button variant="outlined" color="error" disabled={asking.strong && !sure} onClick={onConfirm}>
          {asking.action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
