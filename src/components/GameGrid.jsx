/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { searchLibrary, statusOf, withStoreGames } from "../api/libraryView.js";
import { useT } from "../i18n.js";
import { AddTile, GameCard } from "./GameCard.jsx";
import { StatusText } from "./kit.jsx";
import { installing } from "./Stores.jsx";

/**
 * Covers in columns as many as fit, none narrower than this. Each card keeps
 * its own height: a button stretched to its row's would centre what it holds.
 */
const GRID = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", columnGap: 2, rowGap: 3,
  alignItems: "start",
};

/**
 * How a bottle runs here, in words and its colour.
 *
 * @param {(key: string) => string} t
 * @param {{ status?: string | null }} bundle
 */
export function StatusLine({ t, bundle, dot = false, strong = false }) {
  const status = statusOf(bundle);
  return <StatusText status={status} dot={dot} strong={strong}>{t(`status.${status ?? "unknown"}`)}</StatusText>;
}

/**
 * The library: the person's games -- every bottle this browser can start --
 * with the tile that adds one of their own last; then each store's games not
 * installed here, which open onto their Install. Blurred as one while a game
 * or a dialog is over it.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest[]} props.bundles
 * @param {ReturnType<typeof import("./Stores.jsx").useStores>} props.stores
 * @param {string} props.query
 * @param {boolean} props.blurred
 * @param {(item: any) => void} props.onOpen  A bottle, or a store's game not installed.
 * @param {() => void} props.onAdd
 */
export function GameGrid({ bundles, stores, query, blurred, onOpen, onAdd }) {
  const t = useT();
  const known = stores.stores;
  const everything = useMemo(() => withStoreGames(bundles, known), [bundles, known]);
  const mine = searchLibrary(everything.filter((one) => !one.store?.provider), query);
  const searching = query.trim() !== "";

  /** @param {any} card */
  const storeNote = (card) => {
    const job = known.find((one) => one.provider.id === card.store.provider)?.jobs.get(card.store.game.id);
    if (installing(job)) {
      return job.total > 0 ? t("library.installingShare", { share: Math.floor((100 * job.done) / job.total) })
        : t("library.installing");
    }
    const { game } = card.store;
    if (game.demo) return game.free ? t("library.free") : t("library.demo");
    return game.bytes > 0 ? t.bytes(game.bytes) : "";
  };

  return (
    <Box component="main" sx={{
      px: { xs: 2, md: 4.5 }, py: 4, maxWidth: 1320, width: "100%", mx: "auto",
      filter: blurred ? "blur(6px) brightness(0.5)" : "none",
      transition: "filter .3s ease",
      pointerEvents: blurred ? "none" : "auto",
    }}>
      <Box component="section">
        <Typography component="h2" sx={{ fontSize: 19, fontWeight: 600, mb: 2 }}>{t("library.mine")}</Typography>
        <Box sx={GRID}>
          {mine.map((bundle) => (
            <GameCard key={bundle.id} item={bundle} onOpen={() => onOpen(bundle)}
              note={<StatusLine t={t} bundle={bundle} />} />
          ))}
          {!searching && <AddTile title={t("library.own")} text={t("library.ownText")} onAdd={onAdd} />}
        </Box>
        {searching && mine.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 3 }}>{t("library.noMatch")}</Typography>
        )}
      </Box>
      {known.map(({ provider, account, syncing }) => {
        const cards = searchLibrary(everything.filter((one) => one.store?.provider === provider.id), query);
        if (cards.length === 0) return null;
        return (
          <Box component="section" key={provider.id} sx={{ mt: 4.5 }}>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, flexWrap: "wrap", mb: 2 }}>
              <Typography component="h2" sx={{ fontSize: 19, fontWeight: 600 }}>
                {account ? t("library.inStore", { store: provider.name })
                  : t("library.freeIn", { store: provider.name })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {syncing ? t("library.syncing") : account ? "" : t("library.freeNote", { store: provider.name })}
              </Typography>
            </Box>
            <Box sx={GRID}>
              {cards.map((card) => (
                <GameCard key={card.id} item={card} onOpen={() => onOpen(card)} note={storeNote(card)} />
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
