/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { useEffect, useState } from "react";
import { CHANGED, loadSettings } from "./settings.js";

/**
 * The settings as they stand, read again whenever one is saved anywhere on the
 * page: the header's language switch and developer mode change what every
 * screen shows at once, without a reload.
 *
 * @returns {import("./settings.js").RunSettings}
 */
export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  return settings;
}
