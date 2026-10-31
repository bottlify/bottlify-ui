/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * An install of a Steam app, as the page and the launcher's server both see
 * it: which depots it downloads (`describeApp`, the server's plan), and, for a
 * browser whose session the Bottlify bridge keeps, the request that hands the
 * server what opens them -- each depot's key and a manifest request code, asked
 * of the bridge (`installRequest`) and checked by the server against its own
 * plan (`checkInstallRequest`). A depot's key is the same for every owner and a
 * request code lasts minutes; the session's token stays in the bridge.
 */

import { readDepotAccess, writeDepotAccess } from "@bottlify/core/steam";

/**
 * @typedef {Object} InstallPlan  What an install of an app downloads: its depots
 *     at their public manifests, the gids decimal strings.
 * @property {number} appId
 * @property {{ depot: number, gid: string }[]} depots
 * @property {{ depot: number, app: number }[]} [shared]  The redistributables'
 *     depots it names of other apps (`depotfromapp`): the download takes them
 *     itself, with an anonymous logon, and the bridge is asked nothing for them.
 */

/**
 * The depots an install takes -- Windows', the language's and those for every
 * language, not a DLC's -- their sizes added up, the build, and Steam's first
 * Windows launch option; and those of other apps it names by the same rule,
 * the redistributables (`shared`), which the engine's steam-install.mjs
 * downloads and installs into the bottle.
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
    const os = String(depot?.config?.oslist ?? "");
    const lang = String(depot?.config?.language ?? "");
    const wanted = /^[0-9]+$/.test(id) && (!os || os.split(",").includes("windows"))
      && (!lang || lang === language) && !depot?.dlcappid;
    if (wanted && size > 0 && gid) {
      bytes += size;
      chosen.push({ id: Number(id), gid: BigInt(gid) });
    } else if (wanted && Number(depot?.depotfromapp) > 0) {
      shared.push({ id: Number(id), app: Number(depot.depotfromapp) });
    }
  }
  const launch = Object.values(info?.config?.launch ?? {}).find((option) => {
    const os = String(/** @type {any} */ (option)?.config?.oslist ?? "");
    return /** @type {any} */ (option)?.executable && (!os || os.split(",").includes("windows"));
  });
  return {
    bytes,
    depots: chosen,
    shared,
    build: String(depots?.branches?.public?.buildid ?? ""),
    launch: launch ? {
      executable: String(/** @type {any} */ (launch).executable),
      arguments: String(/** @type {any} */ (launch).arguments ?? ""),
    } : null,
  };
}

/**
 * The page's request for an install with the bridge: the plan's every depot
 * with its key and its manifest's request code, asked of the bridge.
 *
 * @param {InstallPlan} plan
 * @param {(op: string, args: Record<string, unknown>) => Promise<any>} ask  The bridge's.
 * @returns {Promise<{ appId: number, depots: ReturnType<typeof writeDepotAccess> }>}
 */
export async function installRequest(plan, ask) {
  const app = plan.appId;
  const access = await Promise.all(plan.depots.map(async ({ depot, gid }) => ({
    depot,
    gid: BigInt(gid),
    key: await ask("depotKey", { app, depot }),
    code: BigInt(await ask("manifestCode", { app, depot, gid })),
  })));
  return { appId: app, depots: writeDepotAccess(access) };
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
