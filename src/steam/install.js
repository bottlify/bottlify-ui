/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * An install of a Steam app, as the page and the launcher's server both see
 * it: which depots it downloads (`describeApp`, the server's plan) and, for a
 * browser whose session the Bottlify bridge keeps, what opens them -- each
 * depot's key and a manifest request code, asked of the bridge
 * (`depotOpenings`), with which the page installs the app itself. A depot's key
 * is the same for every owner and a request code lasts minutes; the session's
 * token stays in the bridge. The server's own check of such a request
 * (`checkInstallRequest`) is for a page that hands it the keys instead.
 */

import { readDepotAccess, wantedDepot, windowsLaunch, writeDepotAccess } from "@bottlify/core/steam";

/**
 * Steam's own art for an app, on its CDN. Kept in a bottle's manifest as it
 * is; a page is given it through the launcher's server (steam-store.mjs's
 * `art`), because the CDN sends no Cross-Origin-Resource-Policy, which the
 * launcher's cross-origin isolated page needs of an image from elsewhere.
 */
export const STEAM_ART = "https://shared.steamstatic.com/store_item_assets/steam/apps";

/**
 * A Steam bottle's covers and background, as its manifest names them: Steam's
 * own addresses, which a bottle carries wherever it goes.
 *
 * @param {number} appId
 */
export const steamArt = (appId) => ({
  coverLarge: `${STEAM_ART}/${appId}/library_600x900.jpg`,
  coverSmall: `${STEAM_ART}/${appId}/library_600x900.jpg`,
  wallpaper: `${STEAM_ART}/${appId}/library_hero.jpg`,
});

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
 * What opens each depot of a plan -- the app's, then the redistributables',
 * each asked of the bridge under the app that owns it -- as the engine's
 * `installBundle` takes them.
 *
 * @param {InstallPlan} plan
 * @param {(op: string, args: Record<string, unknown>) => Promise<any>} ask  The bridge's.
 * @returns {Promise<import("@bottlify/core/steam").DepotOpening[]>}
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

/**
 * The server's check of a page's request against its own plan for the app:
 * exactly the plan's depots at the plan's manifests, each with a key and a
 * code in their shapes. What the download is handed, or a refusal that names
 * no key or code.
 *
 * @param {unknown} body  The request, from the network.
 * @param {InstallPlan} plan
 * @returns {ReturnType<typeof writeDepotAccess>}
 */
export function checkInstallRequest(body, plan) {
  const request = /** @type {any} */ (body);
  if (request?.appId !== plan.appId) throw new Error(`the request is not for app ${plan.appId}`);
  const access = readDepotAccess(request.depots);
  const wanted = new Map(plan.depots.map(({ depot, gid }) => [depot, gid]));
  for (const { depot, gid } of access) {
    if (!wanted.has(depot)) throw new Error(`depot ${depot} is not one an install of ${plan.appId} takes`);
    if (wanted.get(depot) !== String(gid)) {
      throw new Error(`depot ${depot} has changed on Steam since it was asked for; install again`);
    }
  }
  if (access.length !== wanted.size) {
    throw new Error(`an install of ${plan.appId} takes depots ${[...wanted.keys()].join(", ")}`);
  }
  return writeDepotAccess(access);
}
