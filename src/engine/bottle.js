/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { placementOf } from "@bottlify/installer/prefix";
import { bundleUrl } from "./btl.js";

/**
 * How a bundle from the library is started: the path its program is told it
 * was loaded from, and the engine's bundle options. A bottle an installation
 * made is mounted where that installation put it -- the registry it carries
 * names that directory, and a launcher changes into it before it starts the
 * game -- and any other bundle in a directory of its own.
 *
 * A bottle kept in this browser is read from its file there, a range at a
 * time, and kept nowhere else: it is on this machine already. Any other is
 * read where its manifest says (`bundleUrl`), by the engine itself.
 *
 * @param {{ id: string, entry: string, root?: string, revision?: number,
 *     bundle?: { file?: string } }} bundle
 * @param {{ cacheBundle: boolean }} settings
 * @param {Blob | null} [file]  The bottle's bundle.btl, for one kept in this browser.
 */
export function bundleStart(bundle, settings, file = null) {
  const { prefix, imagePath } = placementOf(bundle);
  if (file) {
    return {
      imagePath,
      bundle: {
        file,
        prefix,
        store: null,
        id: bundle.id,
        ...(Number.isInteger(bundle.revision) ? { revision: bundle.revision } : {}),
      },
    };
  }
  return {
    imagePath,
    bundle: {
      url: bundleUrl(bundle),
      prefix,
      // A block fetched once is kept, so that no start and no read pays the
      // network for it twice; what is the person's decision is whether the
      // rest of the game is copied here too, in the background. Named by the
      // bundle: two of them sharing a cache would read each other's blocks.
      store: "local",
      id: bundle.id,
      prefetch: settings.cacheBundle,
      // Packed again since a session was saved, its registry is laid over the saved one.
      ...(Number.isInteger(bundle.revision) ? { revision: bundle.revision } : {}),
    },
  };
}
