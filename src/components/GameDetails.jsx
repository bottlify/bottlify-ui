/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, Drawer, LinearProgress,
  MenuItem, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { bottleStorage, clearTranslations, storageName } from "@bottlify/core/storage";
import { FilesDialog } from "./FilesDialog.jsx";
import { bottleFiles } from "../engine/volumes.js";
import { residency } from "../engine/btl.js";
import { mayNotFit, removeFromDevice, siteSpace } from "../engine/stored.js";
import { EDITABLE_TYPES } from "../api/config.js";
import { statusOf } from "../api/libraryView.js";
import {
  DEFAULT_SHADERS, DEFAULT_WINDOWS, DRIVER_RULES_CHOICES, GRAPHICS_CHOICES, MACHINE_CHOICES,
  MEMORY_CHOICES, SHADER_CHOICES, WINDOWS_CHOICES, loadSettings, machineFor, saveSettings,
} from "../settings.js";
import {
  KINDS, LABELS, STATUSES, describeBundle, removeBundle, saveBundleArt, saveBundleSettings,
} from "../api/bundles.js";
import { exportBottle, saveLocalManifest } from "../engine/bottles.js";
import { touchLayout } from "../engine/touch.js";
import { storeOf } from "../stores/providers.js";
import { useT } from "../i18n.js";
import { useSettings } from "../useSettings.js";
import { INK } from "../theme.js";
import { StatusLine } from "./GameGrid.jsx";
import { Art, CloseButton, DialogHead, Icon, Segmented } from "./kit.jsx";
import { RateDialog } from "./Feedback.jsx";
import { Confirm } from "./StorageSettings.jsx";
import { installing } from "./Stores.jsx";

/** Every action of the sheet is this wide: the longest label of either language, with its icon. */
const ACTION_WIDTH = 148;

/**
 * A bottle the person made -- added from a file of their own -- rather than a
 * store's or the library's: its name, picture and settings are theirs.
 *
 * @param {any} bundle
 */
export const isOwn = (bundle) => Boolean(bundle?.local) && !storeOf(bundle);

/**
 * The wide picture of a game, where it has one of its own: a store's hero, a
 * bottle's wallpaper. A wallpaper that is only its cover again is none.
 *
 * @param {any} item
 */
const heroOf = (item) => (item.wallpaper && item.wallpaper !== item.coverLarge ? item.wallpaper : "");

/**
 * A picture the person chose for their game, made the size a cover is shown at
 * and kept in the bottle's own description: a game of theirs is never sent
 * anywhere, its cover with it.
 *
 * @param {File} file
 * @returns {Promise<string>}  A data URL of a 600 x 900 JPEG.
 */
async function coverData(file) {
  const picture = await createImageBitmap(file);
  const canvas = Object.assign(document.createElement("canvas"), { width: 600, height: 900 });
  const scale = Math.max(600 / picture.width, 900 / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"))
    .drawImage(picture, (600 - width) / 2, (900 - height) / 2, width, height);
  picture.close();
  return canvas.toDataURL("image/jpeg", 0.86);
}

/**
 * A game, opened from the library: a sheet from the right over the blurred
 * library, its wide art whole at the top and its cover over the art's lower
 * edge. What it is and how it runs; Play, or a store's game's Install; its
 * settings for a game of the person's own (and any in developer mode); its
 * rating and its removal at the foot.
 *
 * @param {Object} props
 * @param {any} props.item  A bottle, or a store's game not installed (`store.provider`).
 * @param {ReturnType<typeof import("./Stores.jsx").useStores>} props.stores
 * @param {import("../api/config.js").AppConfig | null} props.config
 * @param {() => void} props.onClose
 * @param {(bundle: any) => void} props.onPlay
 * @param {(saved: import("../api/bundles.js").BundleManifest) => void} props.onChanged
 * @param {() => void} props.onLibraryChanged  Something was removed: the library reads itself again.
 */
export function GameSheet({ item, stores, config, onClose, onPlay, onChanged, onLibraryChanged }) {
  const t = useT();
  const { developer, lastRun } = useSettings();
  const card = Boolean(item.store?.provider);
  const [configuring, setConfiguring] = useState(false);
  const [rating, setRating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  // How much of the bottle this browser holds, and what a start still downloads
  // beside the room left: said on Play, never in its way.
  const [held, setHeld] = useState(/** @type {{ bytes: number, here: number } | null} */ (null));
  const [tight, setTight] = useState(/** @type {{ missing: number, free: number } | null} */ (null));
  const [saves, setSaves] = useState(/** @type {number | null} */ (null));
  useEffect(() => {
    setHeld(null);
    setTight(null);
    setSaves(null);
    if (card) return undefined;
    let live = true;
    if (item.local) {
      const bytes = Number(item.bundle?.bytes) || 0;
      if (bytes > 0) setHeld({ bytes, here: bytes });
    } else {
      residency(item).then(async (here) => {
        if (!live) return;
        setHeld({ bytes: here.bytes, here: here.residentBytes });
        const space = await siteSpace().catch(() => null);
        const missing = here.bytes - here.residentBytes;
        if (live && space && mayNotFit(missing, space)) setTight({ missing, free: space.free });
      }, () => {});
    }
    bottleStorage().then((stored) => {
      const mine = stored.bottles.find((one) => one.bottle === storageName(item.id));
      if (live) setSaves(mine?.saves ?? 0);
    }, () => {});
    return () => { live = false; };
  }, [item, card]);

  const providerName = (/** @type {string} */ id) =>
    stores.stores.find((one) => one.provider.id === id)?.provider.name ?? id;
  const store = card ? item.store.provider : storeOf(item);
  const own = isOwn(item);
  const status = card ? null : statusOf(item);
  const ran = lastRun[item.id];

  const remove = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await removeFromDevice({ id: item.id, local: Boolean(item.local) });
      onLibraryChanged();
      onClose();
    } catch (e) {
      setFailure(String(/** @type {any} */ (e)?.message ?? e));
      setRemoving(false);
    } finally {
      setBusy(false);
    }
  };

  const facts = card ? [
    t(item.store.game.free ? "sheet.freeIn" : item.store.game.demo ? "sheet.demoIn" : "sheet.inStore",
      { store: providerName(store) }),
    item.store.game.bytes > 0 ? <><b>{t.bytes(item.store.game.bytes)}</b> {t("sheet.toInstall")}</> : null,
  ] : [
    <StatusLine key="status" t={t} bundle={item} dot strong />,
    store ? t("sheet.fromStore", { store: providerName(store) }) : own ? t("sheet.own") : t("sheet.catalog"),
    held && held.here > 0
      ? <><b>{t.bytes(held.here)}</b> {held.here < held.bytes ? t("sheet.ofInBrowser", { total: t.bytes(held.bytes) })
        : t("sheet.inBrowser")}</>
      : held ? t("sheet.notDownloaded") : null,
  ];

  return (
    <Drawer anchor="right" open onClose={onClose}
      slotProps={{ paper: { sx: { width: "min(760px, 100%)", bgcolor: INK.surface, borderLeft: "1px solid",
        borderColor: "divider" } } }}>
      <Box sx={{ position: "absolute", top: 16, right: 16, zIndex: 1, borderRadius: "9px",
        bgcolor: "rgba(26,27,29,0.7)" }}>
        <CloseButton onClick={onClose} label={t("button.close")} />
      </Box>
      <Art src={heroOf(item)} title={item.title} ratio="3840 / 1240" fit="contain" />
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 3, px: { xs: 2.5, sm: 4.5 }, mt: "-120px",
        position: "relative" }}>
        <Box sx={{ width: { xs: 110, sm: 150 }, flex: "none", borderRadius: "6px", overflow: "hidden",
          boxShadow: "0 12px 28px rgba(0,0,0,0.5)", outline: `1px solid ${INK.line}` }}>
          <Art src={item.coverLarge || item.coverSmall || ""} fallback={item.coverFallback}
            title={item.title} ratio="2 / 3" />
        </Box>
        <Typography component="h1" sx={{ fontSize: { xs: 22, sm: 28 }, fontWeight: 600, lineHeight: 1.15,
          letterSpacing: "-0.01em", pb: 0.5, overflowWrap: "anywhere" }}>
          {item.title}
        </Typography>
      </Box>

      <Box sx={{ px: { xs: 2.5, sm: 4.5 }, pt: 2, pb: 4.5 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "10px 24px", color: "text.secondary", mt: 2, mb: 3,
          "& b": { color: "text.primary", fontWeight: 600 } }}>
          {facts.filter(Boolean).map((fact, at) => <Box component="span" key={at}>{fact}</Box>)}
        </Box>
        {developer && !card && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5, mb: 3, overflowWrap: "anywhere" }}>
            {[item.id, item.version, ...(item.labels ?? []), item.kind].filter(Boolean).join(" · ")}
          </Typography>
        )}

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25,
          "& > .MuiButton-root": { width: ACTION_WIDTH, px: 1.5 } }}>
          {card ? <StoreActions item={item} stores={stores} /> : (<>
            <Button variant="contained" startIcon={<Icon name="play" />} onClick={() => onPlay(item)}>
              {t("button.play")}
            </Button>
            {(own || developer) && (
              <Button startIcon={<Icon name="gear" />} onClick={() => setConfiguring(true)}>
                {t("button.settings")}
              </Button>
            )}
          </>)}
        </Box>
        {tight && (
          <Typography variant="body2" sx={{ color: "warning.main", mt: 1.5 }}>
            {t("sheet.mayNotFit", { missing: t.bytes(tight.missing), free: t.bytes(tight.free) })}
          </Typography>
        )}

        {status && (<>
          <Typography component="h2" sx={{ fontSize: 19, fontWeight: 600, mt: 4.5, mb: 1.5 }}>
            {t("sheet.how")}
          </Typography>
          <Typography>{t(`sheet.how.${status}`)}</Typography>
        </>)}
        {(item.description || item.year || item.rightsHolder) && (<>
          <Typography component="h2" sx={{ fontSize: 19, fontWeight: 600, mt: 4.5, mb: 1.5 }}>
            {t("sheet.about")}
          </Typography>
          {item.description && <Typography sx={{ whiteSpace: "pre-wrap" }}>{item.description}</Typography>}
          {(item.year || item.rightsHolder) && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              © {[item.year, item.rightsHolder].filter(Boolean).join(" ")}
            </Typography>
          )}
        </>)}

        {!card && (<>
          <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 24px", mt: 3,
            mb: 0, "& dt": { color: "text.secondary" }, "& dd": { m: 0 } }}>
            {saves !== null && (<>
              <dt>{t("sheet.saves")}</dt>
              <dd>{saves > 0 ? t.bytes(saves) : t("sheet.none")}</dd>
            </>)}
            <dt>{t("sheet.lastRun")}</dt>
            <dd>{ran ? t.when(ran) : t("sheet.neverRun")}</dd>
          </Box>
          {failure && <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>{failure}</Alert>}
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1.25, mt: 4.5, pt: 3,
            borderTop: "1px solid", borderColor: "divider", "& .MuiButton-root": { width: ACTION_WIDTH, px: 1.5 } }}>
            <Button startIcon={<Icon name="star" />} onClick={() => setRating(true)}>{t("button.rate")}</Button>
            <Button color="error" startIcon={<Icon name="cross" />} onClick={() => setRemoving(true)}>
              {t("button.delete")}
            </Button>
          </Box>
        </>)}
      </Box>

      {configuring && (
        <GameSettingsDialog bundle={item} config={config} onClose={() => setConfiguring(false)}
          onSaved={onChanged} onDeleted={() => { onLibraryChanged(); onClose(); }} />
      )}
      {rating && (
        <RateDialog game={{ id: item.id, title: item.title, store }} onClose={() => setRating(false)} />
      )}
      {removing && (
        <Confirm busy={busy} onCancel={() => setRemoving(false)} onConfirm={remove} asking={{
          title: t("sheet.removeTitle", { name: item.title }),
          text: item.local ? t("sheet.removeLocal") : t("sheet.removeServer"),
          action: t("button.delete"),
        }} />
      )}
    </Drawer>
  );
}

/**
 * A store's game not installed here: Install, or the install's progress and Cancel.
 *
 * @param {{ item: any, stores: ReturnType<typeof import("./Stores.jsx").useStores> }} props
 */
function StoreActions({ item, stores }) {
  const t = useT();
  const { developer } = useSettings();
  const { provider, game } = item.store;
  const job = stores.stores.find((one) => one.provider.id === provider)?.jobs.get(game.id);
  if (installing(job)) {
    const share = job.total > 0 && job.state === "downloading" ? Math.min(100, (100 * job.done) / job.total) : null;
    return (
      <Box sx={{ width: "100%", display: "flex", alignItems: "center", gap: 2 }}>
        <Box sx={{ flex: 1, maxWidth: 360 }}>
          <LinearProgress variant={share === null ? "indeterminate" : "determinate"} value={share ?? 0}
            sx={{ height: 6, borderRadius: 3, bgcolor: INK.raised, "& .MuiLinearProgress-bar": { bgcolor: INK.text } }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap title={job.message}>
            {share === null ? t("library.installing") : t("library.installingShare", { share: Math.floor(share) })}
            {developer && job.message ? ` · ${job.message}` : ""}
          </Typography>
        </Box>
        <Button sx={{ width: ACTION_WIDTH }} onClick={() => stores.cancel(provider, game)}>{t("button.cancel")}</Button>
      </Box>
    );
  }
  return (<>
    <Button variant="contained" startIcon={<Icon name="download" />} disabled={!game.installable}
      onClick={() => stores.install(provider, game)} sx={{ width: ACTION_WIDTH }}>
      {t("button.install")}
    </Button>
    {job?.state === "failed" && (
      <Typography variant="body2" sx={{ color: "error.main", width: "100%" }}>
        {t("sheet.installFailed", { reason: job.message })}
      </Typography>
    )}
  </>);
}

/**
 * A field: its label over it, its help under it, no box around a group.
 *
 * @param {{ label: string, help?: string, children: import("react").ReactNode }} props
 */
function Field({ label, help, children }) {
  return (
    <Box sx={{ display: "grid", gap: 0.75, mb: 3, "&:last-child": { mb: 0 } }}>
      <Typography component="div" sx={{ fontWeight: 600 }}>{label}</Typography>
      {children}
      {help && <Typography variant="body2" color="text.secondary">{help}</Typography>}
    </Box>
  );
}

/**
 * A game's own settings, for a game of the person's own and, in developer
 * mode, for any: its card (name, description, cover), how it starts, the
 * Windows and memory it runs with, its graphics, its touch controls, its files.
 * Every control is an option a bottle has; what the engine has no option for
 * is not offered. The choices are kept in this browser over what the bottle
 * says; a bottle of the library's server, where this launcher may write it,
 * is described -- and in developer mode configured -- on the server for everyone.
 *
 * @param {Object} props
 * @param {import("../api/bundles.js").BundleManifest & { local?: boolean }} props.bundle
 * @param {import("../api/config.js").AppConfig | null} props.config
 * @param {() => void} props.onClose
 * @param {(saved: import("../api/bundles.js").BundleManifest) => void} props.onSaved
 * @param {() => void} props.onDeleted  Removed from the server.
 */
export function GameSettingsDialog({ bundle, config, onClose, onSaved, onDeleted }) {
  const t = useT();
  const { developer } = useSettings();
  const upload = config?.upload ?? null;
  const own = isOwn(bundle);
  // The manifest this dialog writes is the server's: one kept in this browser
  // is never there, whatever this launcher may write.
  const onServer = developer && Boolean(upload) && !bundle.local;
  const describes = own || onServer;
  const tabs = [...describes ? ["card"] : [], "launch", "system", "graphics", "controls", "files"];
  const [tab, setTab] = useState(tabs[0]);

  const stored = loadSettings();
  const mine = stored.bottleConfig[bundle.id] ?? {};
  const machine = machineFor(stored, bundle);
  const [windows, setWindows] = useState((onServer ? undefined : mine.windows) ?? bundle.windows ?? DEFAULT_WINDOWS);
  const [graphics, setGraphics] = useState((onServer ? undefined : mine.graphics) ?? bundle.graphics ?? "all");
  const [shaders, setShaders] = useState((onServer ? undefined : mine.shaders) ?? bundle.shaders ?? DEFAULT_SHADERS);
  const [multithreading, setMultithreading] = useState(
    ((onServer ? undefined : mine.multithreading) ?? bundle.multithreading) !== false);
  const [memory, setMemory] = useState(
    MEMORY_CHOICES[machine].some((one) => one.value === mine.memory) ? /** @type {number} */ (mine.memory) : 0);
  const [driverRules, setDriverRules] = useState(mine.driverRules ?? "current");
  const [build, setBuild] = useState(mine.build === "amd64" ? "amd64" : "x86");
  const [entry, setEntry] = useState(mine.entry ?? "");
  const [args, setArgs] = useState(mine.args ?? "");
  const [touch, setTouch] = useState(() => touchLayout(mine.touch));
  /** @param {Partial<ReturnType<typeof touchLayout>>} patch */
  const changeTouch = (patch) => setTouch((held) => touchLayout({ ...held, ...patch }));
  const [title, setTitle] = useState(bundle.title ?? "");
  const [description, setDescription] = useState(bundle.description ?? "");
  const [cover, setCover] = useState(/** @type {File | null} */ (null));
  const [wallpaper, setWallpaper] = useState(/** @type {File | null} */ (null));
  const [version, setVersion] = useState(bundle.version ?? "");
  const [kind, setKind] = useState(bundle.kind ?? "game");
  const [labels, setLabels] = useState(bundle.labels ?? []);
  const [status, setStatus] = useState(bundle.status ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const [browsing, setBrowsing] = useState(false);
  const [exporting, setExporting] = useState(/** @type {number | null} */ (null));
  const [deleting, setDeleting] = useState(false);

  /** What this browser keeps for the bottle, over what it says. */
  const kept = () => {
    const next = { ...mine, memory, driverRules, build, touch, entry: entry.trim(), args: args.trim(),
      ...onServer ? {} : { windows, graphics, shaders, multithreading } };
    if (onServer) for (const key of ["windows", "graphics", "shaders", "multithreading"]) delete next[key];
    if (!memory) delete next.memory;
    if (driverRules !== "legacy") delete next.driverRules;
    if (build !== "amd64") delete next.build;
    if (!next.entry) delete next.entry;
    if (!next.args) delete next.args;
    return next;
  };

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      saveSettings({ bottleConfig: { ...loadSettings().bottleConfig, [bundle.id]: kept() } });
      const described = { title: title.trim() || bundle.title, description: description.trim() };
      if (own) {
        const picture = cover ? await coverData(cover) : null;
        const manifest = await saveLocalManifest(bundle.id, {
          ...described, ...picture ? { coverLarge: picture, coverSmall: picture } : {} });
        onSaved({ ...describeBundle(bundle.id, manifest), local: true });
      } else if (onServer) {
        // The pictures first: each answers the manifest as it then is, and the
        // settings after them answer the whole of it.
        for (const [slot, file] of /** @type {const} */ ([["cover", cover], ["wallpaper", wallpaper]])) {
          if (file) await saveBundleArt(/** @type {any} */ (upload), bundle.id, slot, file);
        }
        onSaved(await saveBundleSettings(/** @type {any} */ (upload), bundle.id, {
          ...described, version: version.trim(), kind, status,
          labels: LABELS.map((one) => one.value).filter((value) => labels.includes(value)),
          windows, graphics, shaders, multithreading,
        }));
      }
      onClose();
    } catch (e) {
      setFailure(String(/** @type {any} */ (e)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const exportIt = async () => {
    setFailure(null);
    setExporting(0);
    let shown = 0;
    try {
      await exportBottle(bundle, (written, total) => {
        // A bottle of gigabytes is tens of thousands of pieces: a render for each would stall the page.
        const now = performance.now();
        if (now - shown < 250) return;
        shown = now;
        setExporting(total > 0 ? written / total : 0);
      });
    } catch (e) {
      setFailure(t("gameSettings.notExported", { reason: /** @type {any} */ (e)?.message ?? e }));
    } finally {
      setExporting(null);
    }
  };

  const removeFromServer = async () => {
    setSaving(true);
    try {
      await removeBundle(/** @type {any} */ (upload), bundle.id);
      onDeleted();
    } catch (e) {
      setFailure(String(/** @type {any} */ (e)?.message ?? e));
      setDeleting(false);
    } finally {
      setSaving(false);
    }
  };

  const select = (/** @type {{ value: string, label: string }[]} */ choices, /** @type {string} */ value,
    /** @type {(value: string) => void} */ onChange) => (
    <TextField select size="small" value={value} disabled={saving} sx={{ maxWidth: 420 }}
      onChange={(event) => onChange(event.target.value)}>
      {choices.map((one) => <MenuItem key={one.value} value={one.value}>{one.label}</MenuItem>)}
    </TextField>
  );
  const text = (/** @type {string} */ value, /** @type {(value: string) => void} */ onChange,
    /** @type {Record<string, unknown>} */ more = {}) => (
    <TextField size="small" value={value} disabled={saving} onChange={(event) => onChange(event.target.value)}
      {...more} />
  );
  const windowsChoices = WINDOWS_CHOICES.filter((one) => one.value !== "win2000" || developer || windows === "win2000")
    .map((one) => ({ value: one.value, label: one.value === "auto" ? t("gameSettings.auto")
      : one.label.replace(/^Windows /, "") }));

  return (
    <Dialog open fullWidth maxWidth="md" onClose={saving ? undefined : onClose}>
      <DialogHead title={bundle.title} subtitle={own ? t("gameSettings.own") : t("gameSettings.developer")}
        onClose={saving ? null : onClose} closeLabel={t("button.close")} />
      <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable"
        sx={{ px: 3, borderBottom: "1px solid", borderColor: "divider" }}>
        {tabs.map((one) => <Tab key={one} value={one} label={t(`gameSettings.tab.${one}`)} />)}
      </Tabs>
      <DialogContent sx={{ px: 4, py: 3, minHeight: 280 }}>
        {tab === "card" && (<>
          <Field label={t("gameSettings.name")}>{text(title, setTitle, { fullWidth: true })}</Field>
          <Field label={t("gameSettings.description")}>
            {text(description, setDescription, { fullWidth: true, multiline: true, minRows: 3,
              placeholder: t("gameSettings.descriptionHint"), inputProps: { maxLength: 2000 } })}
          </Field>
          <Field label={t("gameSettings.cover")} help={t("gameSettings.coverHelp")}>
            <PicturePick file={cover} onPick={setCover} disabled={saving}
              current={cover ? cover.name : bundle.coverLarge ? t("gameSettings.coverOwn") : t("gameSettings.coverNone")} />
          </Field>
          {onServer && (<>
            <Field label={t("gameSettings.wallpaper")}>
              <PicturePick file={wallpaper} onPick={setWallpaper} disabled={saving}
                current={wallpaper ? wallpaper.name : heroOf(bundle) ? t("gameSettings.coverOwn")
                  : t("gameSettings.coverNone")} />
            </Field>
            <Field label={t("gameSettings.status")}>
              <Segmented value={status} onChange={setStatus} disabled={saving}
                options={[{ value: "", label: t("status.unknown") },
                  ...STATUSES.map((one) => ({ value: one.value,
                    label: t(`status.${/** @type {string} */ (statusOf({ status: one.value }))}`) }))]} />
            </Field>
            <Field label={t("gameSettings.catalog")}>
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                {text(version, setVersion, { label: t("gameSettings.version"), sx: { width: 160 } })}
                {select(KINDS, kind, setKind)}
              </Box>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {LABELS.map((one) => (
                  <Button key={one.value} variant={labels.includes(one.value) ? "contained" : "outlined"}
                    disabled={saving} onClick={() => setLabels((held) => (held.includes(one.value)
                      ? held.filter((value) => value !== one.value) : [...held, one.value]))}>
                    {one.label}
                  </Button>
                ))}
              </Box>
            </Field>
            <Field label={t("gameSettings.server")} help={t("gameSettings.serverHelp")}>
              <Box><Button color="error" disabled={saving} onClick={() => setDeleting(true)}>
                {t("gameSettings.deleteFromServer")}</Button></Box>
            </Field>
          </>)}
        </>)}
        {tab === "launch" && (<>
          <Field label={t("gameSettings.program")} help={t("gameSettings.programHelp")}>
            {text(entry, setEntry, { placeholder: bundle.entry ?? "", fullWidth: true })}
          </Field>
          <Field label={t("gameSettings.args")} help={t("gameSettings.argsHelp")}>
            {text(args, setArgs, { placeholder: bundle.commandLine || t("gameSettings.argsHint"), fullWidth: true })}
          </Field>
          {machine === "amd64" && (
            <Field label={t("gameSettings.build")} help={t("gameSettings.buildHelp")}>
              <Segmented value={build} onChange={setBuild} disabled={saving}
                options={[{ value: "x86", label: t("gameSettings.build32") }, { value: "amd64", label: "64-bit" }]} />
            </Field>
          )}
        </>)}
        {tab === "system" && (<>
          <Field label="Windows" help={t("gameSettings.windowsHelp")}>
            <Segmented value={windows} onChange={setWindows} options={windowsChoices} disabled={saving} />
          </Field>
          <Field label={t("gameSettings.memory")}
            help={machine === "amd64" ? t("gameSettings.memoryHelp64") : t("gameSettings.memoryHelp32")}>
            <Segmented value={memory} onChange={setMemory} disabled={saving}
              options={[{ value: 0, label: t("gameSettings.auto") },
                ...MEMORY_CHOICES[machine].map((one) => ({ value: one.value, label: t.bytes(one.value * 1024 * 1024) }))]} />
          </Field>
          {developer && (<>
            <Field label={t("gameSettings.cores")} help={t("gameSettings.coresHelp")}>
              <Segmented value={multithreading ? "on" : "off"} disabled={saving}
                onChange={(value) => setMultithreading(value === "on")}
                options={[{ value: "on", label: t("gameSettings.coresMany") }, { value: "off", label: t("gameSettings.coresOne") }]} />
            </Field>
            <Field label="Architecture" help="The machine the bottle was installed on; it cannot be changed.">
              <Typography>{MACHINE_CHOICES.find((one) => one.value === machine)?.label}</Typography>
            </Field>
          </>)}
        </>)}
        {tab === "graphics" && (<>
          <Field label="DirectX" help={t("gameSettings.directxHelp")}>
            {select(GRAPHICS_CHOICES.map((one) => (one.value === "all"
              ? { ...one, label: t("gameSettings.auto") } : one)), graphics, setGraphics)}
          </Field>
          <Field label={t("gameSettings.card")} help={t("gameSettings.cardHelp")}>
            {select(SHADER_CHOICES.map((one) => (one.value === "host"
              ? { ...one, label: t("gameSettings.cardHost") } : one)), shaders, setShaders)}
          </Field>
          {developer && (
            <Field label="Driver rules" help="Where DirectX left a behaviour to the driver.">
              {select(DRIVER_RULES_CHOICES, driverRules, setDriverRules)}
            </Field>
          )}
        </>)}
        {tab === "controls" && (<>
          <Typography color="text.secondary" sx={{ mb: 3 }}>{t("gameSettings.touchNote")}</Typography>
          <Field label={t("gameSettings.touch")}>
            <Segmented value={touch.controls} onChange={(controls) => changeTouch({ controls })} disabled={saving}
              options={["keys", "mouse", "pad", "off"].map((value) => ({ value, label: t(`touch.${value}`) }))} />
          </Field>
          <Field label={t("gameSettings.stickKeys")}>
            <Segmented value={touch.move} onChange={(move) => changeTouch({ move })}
              disabled={saving || (touch.controls !== "keys" && touch.controls !== "mouse")}
              options={[{ value: "wasd", label: "W A S D" }, { value: "arrows", label: t("touch.arrows") }]} />
          </Field>
          <Field label={t("gameSettings.stickHand")}>
            <Segmented value={touch.hand} onChange={(hand) => changeTouch({ hand })}
              disabled={saving || touch.controls === "off"}
              options={[{ value: "right", label: t("touch.leftThumb") }, { value: "left", label: t("touch.rightThumb") }]} />
          </Field>
          <Field label={t("gameSettings.size")}>
            <Segmented value={touch.size} onChange={(size) => changeTouch({ size })}
              disabled={saving || touch.controls === "off"}
              options={[{ value: 0.8, label: t("touch.small") }, { value: 1, label: t("touch.medium") },
                { value: 1.25, label: t("touch.large") }]} />
          </Field>
        </>)}
        {tab === "files" && (<>
          <Field label={t("gameSettings.folder")} help={t("gameSettings.folderHelp")}>
            <Box><Button startIcon={<Icon name="folder" />} onClick={() => setBrowsing(true)}>
              {t("button.open")}</Button></Box>
          </Field>
          <Field label={t("gameSettings.export")} help={t("gameSettings.exportHelp")}>
            <Box>
              <Button disabled={exporting !== null} onClick={exportIt} startIcon={exporting === null
                ? <Icon name="download" />
                : <CircularProgress size={16} variant="determinate" value={Math.max(exporting * 100, 2)}
                  color="inherit" />}>
                {t("gameSettings.exportAction")}
              </Button>
            </Box>
          </Field>
          {developer && (
            <Field label="Translated code" help="The cache of the game's translated code; the next start translates again.">
              <Box><Button color="error" onClick={() => clearTranslations(bundle.id).then(
                (count) => setNote(count > 0 ? "The cache is cleared." : "There was no cache to clear."),
                (e) => setFailure(String(e?.message ?? e)))}>Clear cache</Button></Box>
            </Field>
          )}
        </>)}
        {failure && <Alert severity="error" variant="outlined" sx={{ mt: 3 }}>{failure}</Alert>}
        {note && <Alert severity="success" variant="outlined" sx={{ mt: 3 }} onClose={() => setNote(null)}>{note}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 4, borderTop: "1px solid", borderColor: "divider" }}>
        <Button onClick={onClose} disabled={saving}>{t("button.cancel")}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{t("button.save")}</Button>
      </DialogActions>
      {browsing && (
        <FilesDialog title={bundle.title} files={bottleFiles(bundle)}
          editableTypes={config?.editableTypes ?? EDITABLE_TYPES} onClose={() => setBrowsing(false)} />
      )}
      {deleting && (
        <Confirm busy={saving} onCancel={() => setDeleting(false)} onConfirm={removeFromServer} asking={{
          title: t("gameSettings.deleteFromServerTitle", { name: bundle.title }),
          text: t("gameSettings.deleteFromServerText"), action: t("button.delete") }} />
      )}
    </Dialog>
  );
}

/**
 * A picture chosen for a game: what it shows now, and the way to choose another.
 *
 * @param {{ current: string, file: File | null, onPick: (file: File) => void, disabled: boolean }} props
 */
function PicturePick({ current, onPick, disabled }) {
  const t = useT();
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, p: 2,
      borderRadius: "9px", bgcolor: INK.ground }}>
      <Typography color="text.secondary" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{current}</Typography>
      <Button component="label" disabled={disabled} sx={{ flex: "none" }}>
        {t("gameSettings.pick")}
        <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onPick(chosen);
            event.target.value = "";
          }} />
      </Button>
    </Box>
  );
}
