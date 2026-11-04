/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useEffect, useState } from "react";
import { artUrl } from "../stores/gamehub.js";

/**
 * A store's picture as this page may show it (`artUrl`): empty until it is
 * known, then its address or the page's own URL for it.
 *
 * @param {string | undefined} url
 * @returns {string}
 */
export function useArt(url) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    let gone = false;
    setShown("");
    if (url) artUrl(url).then((one) => !gone && setShown(one));
    return () => {
      gone = true;
    };
  }, [url]);
  return shown;
}
