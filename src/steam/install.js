/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A Steam app as this page sees it, from what Steam tells anyone of it -- its
 * product info, which the Bottlify bridge answers (`productInfo`): the game the
 * library shows (`storeGame`), and what an install of it downloads
 * (`installPlan`) and opens each depot with -- its key and a manifest request
 * code, asked of the bridge for the signed-in account (`depotOpenings`). A
 * depot's key is the same for every owner and a request code lasts minutes;
 * the session's token stays in the bridge.
 */

import { depotOwners, sharedDepots, wantedDepot, windowsLaunch } from "@bottlify/core/steam";

/** Steam's name for the language an install takes. */
export const LANGUAGE = "english";

/**
 * @typedef {import("../stores/providers.js").StoreGame & {
 *   appId: number, launch: { executable: string, arguments: string } | null }} SteamGame
 */

/**
 * @typedef {Object} InstallPlan  What an install of an app downloads: its depots
 *     at their public manifests, the gids decimal strings.
 * @property {number} appId
 * @property {string} [name]
 * @property {{ depot: number, gid: string }[]} depots
 * @property {{ depot: number, app: number, gid?: string }[]} [shared]  The
 *     redistributables' depots it names of other apps (`depotfromapp`), at their
 *     owners' public manifests: keys and codes for them are asked under the owner.
 * @property {string} [installscript]  The app's own install script, a path in it.
 * @property {{ executable: string, arguments: string } | null} [launch]
 */

/**
 * The depots an install takes -- Windows', the language's and those for every
 * language, not a DLC's (the engine's `wantedDepot`) -- their sizes added up,
 * the build, Steam's first Windows launch option and the app's install script;
 * and those of other apps it names by the same rule, the redistributables
 * (`shared`), which an install takes too.
 *
 * @param {any} info  An app's product info.
 * @param {string} language  Steam's name of it: `english`, `german`, …
 */
export function describeApp(info, language) {
  const depots = info?.depots ?? {};
  let bytes = 0;
  /** @type {{ id: number, gid: bigint }[]} */
  const chosen = [];
  /** @type {{ id: number, app: number }[]} */
  const shared = [];
  for (const [id, depot] of Object.entries(depots)) {
    const size = Number(depot?.manifests?.public?.size ?? 0);
    const gid = depot?.manifests?.public?.gid;
    const wanted = /^[0-9]+$/.test(id) && wantedDepot(depot, language);
    if (wanted && size > 0 && gid) {
      bytes += size;
      chosen.push({ id: Number(id), gid: BigInt(gid) });
    } else if (wanted && Number(depot?.depotfromapp) > 0) {
      shared.push({ id: Number(id), app: Number(depot.depotfromapp) });
    }
  }
  const launch = windowsLaunch(info);
  return {
    bytes,
    depots: chosen,
    shared,
    build: String(depots?.branches?.public?.buildid ?? ""),
    launch: launch ? { executable: String(launch.executable), arguments: String(launch.arguments ?? "") }
      : null,
    installscript: info?.extended?.installscript ? String(info.extended.installscript) : "",
  };
}

/**
 * A game as the library shows it, or null for an app that is not a game:
 * its size the depots' added up, and installable while it has a Windows
 * launch option.
 *
 * @param {number} appId
 * @param {any} info  Its product info.
 * @returns {SteamGame | null}
 */
export function storeGame(appId, info) {
  if (String(info?.common?.type ?? "").toLowerCase() !== "game") return null;
  const { bytes, launch } = describeApp(info, LANGUAGE);
  return { id: String(appId), appId, name: String(info.common.name ?? appId), bytes, exact: false,
    installable: launch !== null, launch };
}

/**
 * What an install of an app downloads, from its product info and that of the
 * apps whose depots it names (the engine's `depotOwners`, `sharedDepots`).
 *
 * @param {number} appId
 * @param {any} info
 * @param {Map<number, any>} owners  The owning apps' product info, by app id.
 * @returns {InstallPlan}
 */
export function installPlan(appId, info, owners) {
  const described = describeApp(info, LANGUAGE);
  return {
    appId,
    name: String(info?.common?.name ?? appId),
    depots: described.depots.map(({ id, gid }) => ({ depot: id, gid: String(gid) })),
    shared: sharedDepots(info, owners, LANGUAGE)
      .map(({ id, app, gid }) => ({ depot: id, app, gid: String(gid) })),
    ...described.installscript ? { installscript: described.installscript } : {},
    launch: described.launch,
  };
}

/**
 * An install's plan, asked of the bridge: the app's product info, then its
 * redistributables' owners'.
 *
 * @param {number} appId
 * @param {(op: string, args: Record<string, unknown>) => Promise<any>} ask  The bridge's.
 * @returns {Promise<InstallPlan>}
 */
export async function askPlan(appId, ask) {
  const info = (await ask("productInfo", { apps: [appId] }))?.[appId];
  if (!info) throw new Error(`Steam does not describe app ${appId}`);
  const ids = depotOwners(info);
  const owners = ids.length ? await ask("productInfo", { apps: ids }) : {};
  return installPlan(appId, info, new Map(ids.map((id) => [id, owners?.[id]])));
}

/**
 * What opens each depot of a plan -- the app's, then the redistributables',
 * each asked of the bridge under the app that owns it -- as the engine's
 * `installBundle` takes them.
 *
 * @param {InstallPlan} plan
 * @param {(op: string, args: Record<string, unknown>) => Promise<any>} ask  The bridge's.
 * @returns {Promise<import("@bottlify/core/steam/install").DepotOpening[]>}
 */
export function depotOpenings(plan, ask) {
  const wanted = [
    ...plan.depots.map(({ depot, gid }) => ({ depot, gid, app: plan.appId, shared: false })),
    ...(plan.shared ?? []).flatMap(({ depot, gid, app }) => (gid ? [{ depot, gid, app, shared: true }] : [])),
  ];
  return Promise.all(wanted.map(async ({ depot, gid, app, shared }) => ({
    depot,
    gid: BigInt(gid),
    shared,
    key: await ask("depotKey", { app, depot }),
    code: BigInt(await ask("manifestCode", { app, depot, gid })),
  })));
}
