/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Turns two `app.diagnostics()` snapshots into the performance overlay's rows.
 *
 * Every diagnostics counter this reads (`cpu.instructions`, a phase's `selfMs`,
 * `graphics.presenter.shown`, `graphics.seam.device.draws`, a hook's `ms`) is
 * cumulative since the engine started, never per frame -- so one snapshot says
 * nothing about the second that just passed, and every figure here is a delta
 * between two readings taken `elapsedMs` apart. Framework-free and side-effect
 * -free on purpose: this is the one part of the overlay worth testing without a
 * browser.
 */

/**
 * `log`'s `topPhases` metric is a formatted line -- `"name kind xN self=1.234
 * worst=0.567"` -- rather than a structured row (`docs/core/log.md` §2's
 * `diagnostics()` table), because the layer that owns it publishes a string
 * for a one-off look, not a table. Parsed back into a name and its cumulative
 * self time in ms.
 */
const TOP_PHASE_LINE = /^(\S+) \S+ x\d+ self=([\d.]+) worst=([\d.]+)$/;

/** @param {string[] | undefined} lines @returns {Map<string, number>} */
function phaseSelfMs(lines) {
  const map = new Map();
  for (const line of lines ?? []) {
    const match = TOP_PHASE_LINE.exec(line);
    if (match) map.set(match[1], Number(match[2]));
  }
  return map;
}

/**
 * Interfaces a COM call's phase is named by: the engine registers a method as
 * `{IID}::Method`, and a GUID says nothing at a glance. The common Direct3D 8
 * and 9, DirectSound and DirectInput ones by name; any other is cut to its
 * first eight hex digits, which is still enough to look it up.
 */
const INTERFACES = new Map(Object.entries({
  "1DD9E8DA-1C77-4D40-B0CF-98FEFDFF9512": "IDirect3D8",
  "7385E5DF-8FE8-41D5-86B6-D7B48547B6CF": "IDirect3DDevice8",
  "1B36BB7B-09B7-410A-B445-7D1430D7B33F": "IDirect3DResource8",
  "B4211CFA-51B9-4A9F-AB78-DB99B2BB678E": "IDirect3DBaseTexture8",
  "E4CDD575-2866-4F01-B12E-7EECE1EC9358": "IDirect3DTexture8",
  "3EE5B968-2ACA-4C34-8BB5-7E0C3D19B750": "IDirect3DCubeTexture8",
  "4B8AAAFA-140F-42BA-9131-597EAFAA2EAD": "IDirect3DVolumeTexture8",
  "BD7349F5-14F1-42E4-9C79-972380DB40C0": "IDirect3DVolume8",
  "B96EEBCA-B326-4EA5-882F-2FF5BAE021DD": "IDirect3DSurface8",
  "8AEEEAC7-05F9-44D4-B591-000B0DF1CB95": "IDirect3DVertexBuffer8",
  "0E689C9A-053D-44A0-9D92-DB0E3D750F86": "IDirect3DIndexBuffer8",
  "928C088B-76B9-4C6B-A536-A590853876CD": "IDirect3DSwapChain8",
  "81BDCBCA-64D4-426D-AE8D-AD0147F4275C": "IDirect3D9",
  "D0223B96-BF7A-43FD-92BD-A43B0D82B9EB": "IDirect3DDevice9",
  "05EEC05D-8F7D-4362-B999-D1BAF357C704": "IDirect3DResource9",
  "580CA87E-1D3C-4D54-991D-B7D3E3C298CE": "IDirect3DBaseTexture9",
  "85C31227-3DE5-4F00-9B3A-F11AC38C18B5": "IDirect3DTexture9",
  "FFF32F81-D953-473A-9223-93D652ABA93F": "IDirect3DCubeTexture9",
  "2518526C-E789-4111-A7B9-47EF328D13E6": "IDirect3DVolumeTexture9",
  "24F416E6-1F67-4AA7-B88E-D33F6F3128A1": "IDirect3DVolume9",
  "0CFBAF3A-9FF6-429A-99B3-A2796AF8B89B": "IDirect3DSurface9",
  "B64BB1B5-FD70-4DF6-BF91-19D0A12455E3": "IDirect3DVertexBuffer9",
  "7C9DD65E-D3F7-4529-ACEE-785830ACDE35": "IDirect3DIndexBuffer9",
  "794950F2-ADFC-458A-905E-10A10B0B503B": "IDirect3DSwapChain9",
  "DD13C59C-36FA-4098-A8FB-C7ED39DC8546": "IDirect3DVertexDeclaration9",
  "EFC5557E-6265-4613-8A94-43857889EB36": "IDirect3DVertexShader9",
  "6D3BDBDC-5B02-4415-B852-CE5E8BCCB289": "IDirect3DPixelShader9",
  "B07C4FE5-310D-4BA8-A23C-4F0F206F218B": "IDirect3DStateBlock9",
  "D9771460-A695-4F26-BBD3-27B840B541CC": "IDirect3DQuery9",
  "279AFA83-4981-11CE-A521-0020AF0BE560": "IDirectSound",
  "C50A7E93-F395-4834-9EF6-7FA99DE50966": "IDirectSound8",
  "279AFA85-4981-11CE-A521-0020AF0BE560": "IDirectSoundBuffer",
  "6825A449-7524-4D82-920F-50E36AB3AB1E": "IDirectSoundBuffer8",
  "B0210783-89CD-11D0-AF08-00A0C925CD16": "IDirectSoundNotify",
  "279AFA84-4981-11CE-A521-0020AF0BE560": "IDirectSound3DListener",
  "279AFA86-4981-11CE-A521-0020AF0BE560": "IDirectSound3DBuffer",
  "89521360-AA8A-11CF-BFC7-444553540000": "IDirectInputA",
  "89521361-AA8A-11CF-BFC7-444553540000": "IDirectInputW",
  "5944E662-AA8A-11CF-BFC7-444553540000": "IDirectInput2A",
  "5944E663-AA8A-11CF-BFC7-444553540000": "IDirectInput2W",
  "9A4CB684-236D-11D3-8E9D-00C04F6844AE": "IDirectInput7A",
  "9A4CB685-236D-11D3-8E9D-00C04F6844AE": "IDirectInput7W",
  "BF798030-483A-4DA2-AA99-5D64ED369700": "IDirectInput8A",
  "BF798031-483A-4DA2-AA99-5D64ED369700": "IDirectInput8W",
  "5944E680-C92E-11CF-BFC7-444553540000": "IDirectInputDeviceA",
  "5944E681-C92E-11CF-BFC7-444553540000": "IDirectInputDeviceW",
  "5944E682-C92E-11CF-BFC7-444553540000": "IDirectInputDevice2A",
  "5944E683-C92E-11CF-BFC7-444553540000": "IDirectInputDevice2W",
  "57D7C6BC-2356-11D3-8E9D-00C04F6844AE": "IDirectInputDevice7A",
  "57D7C6BD-2356-11D3-8E9D-00C04F6844AE": "IDirectInputDevice7W",
  "54D41080-DC15-4833-A41B-748F73A38179": "IDirectInputDevice8A",
  "54D41081-DC15-4833-A41B-748F73A38179": "IDirectInputDevice8W",
}));

/** The phases of a Direct3D call's entry (`docs/core/api.md`, Diagnostics), outermost first. */
const ENTRY_PHASES = ["ring-sync", "ring-unlocked", "ring-take", "ring-held"];

const COM_METHOD = /^\{([0-9A-Fa-f-]{36})\}::(.+)$/;

/**
 * A host call's phase name as the split shows it: `gl:` and `LIBRARY:` for an
 * exported function, `Interface::Method` for a COM method.
 *
 * @param {string} name
 */
export function callName(name) {
  const com = COM_METHOD.exec(name);
  if (com) {
    const iid = com[1].toUpperCase();
    return `${INTERFACES.get(iid) ?? iid.slice(0, 8)}::${com[2]}`;
  }
  return name.replace(/^OPENGL32\.dll!/, "gl:").replace(/\.dll!/, ":");
}

/** @param {{ name: string, ms: number }[] | undefined} hooks @returns {Map<string, number>} */
function hookMs(hooks) {
  const map = new Map();
  for (const hook of hooks ?? []) {
    map.set(hook.name, hook.ms);
    map.set(`${hook.name}#calls`, hook.calls ?? 0);
  }
  return map;
}

/**
 * Rows smoothed across polls so the list does not jump every second: a
 * name keeps its place and its value follows the last readings with an
 * exponential average (half the weight on the newest second), and a name
 * that stopped rising fades to zero instead of vanishing. What the owner
 * reads is "what has been taking the time lately", not one second's noise.
 *
 * @template {{ name: string }} T
 * @param {T[]} previous
 * @param {T[]} current
 * @param {(keyof T)[]} fields  Numeric fields to average.
 * @param {number} keep         How many rows to show, by the first field.
 * @returns {T[]}
 */
export function smoothRows(previous, current, fields, keep) {
  const seen = new Map(current.map((row) => [row.name, row]));
  const merged = new Map();
  for (const row of previous) {
    const now = seen.get(row.name);
    const out = { ...row };
    for (const field of fields) {
      const was = Number(row[field]) || 0;
      const value = now ? Number(now[field]) || 0 : 0;
      /** @type {any} */ (out)[field] = was * 0.5 + value * 0.5;
    }
    merged.set(row.name, out);
  }
  for (const row of current) {
    if (!merged.has(row.name)) merged.set(row.name, { ...row });
  }
  const first = fields[0];
  return [...merged.values()]
    .filter((row) => (Number(row[first]) || 0) > 0.005)
    .sort((a, b) => (Number(b[first]) || 0) - (Number(a[first]) || 0))
    .slice(0, keep);
}

/**
 * @param {{ name: string, metrics?: Record<string, any> }[]} layers
 * @param {string} name
 * @returns {Record<string, any>}
 */
function metricsOf(layers, name) {
  return layers.find((layer) => layer.name === name)?.metrics ?? {};
}

/**
 * A later cumulative counter minus an earlier one, floored at zero: a counter
 * cannot go backwards, but a phase or a hook dropping out of `topPhases`'s
 * top sixteen between two polls would otherwise read as one that did.
 *
 * @param {number} now @param {number} was
 */
function rise(now, was) {
  return Math.max(0, now - was);
}

/**
 * What `performance.measureUserAgentSpecificMemory()` says of the tab -- the
 * page, its workers and their wasm memories together -- as MiB in all and by
 * who holds it: a worker by its script's name, the page as `page`. A tab
 * that runs out of memory goes to swap and dies with nothing said; this is
 * the number that climbs first.
 *
 * @param {{ bytes: number, breakdown?: { bytes: number, attribution?: { url?: string,
 *     scope?: string }[] }[] } | null | undefined} measured
 * @returns {{ totalMB: number, top: { name: string, mb: number }[] } | null}
 */
export function tabMemoryOf(measured) {
  if (!measured || typeof measured.bytes !== "number") return null;
  /** @type {Map<string, number>} */
  const by = new Map();
  for (const part of measured.breakdown ?? []) {
    if (!(part.bytes > 0)) continue;
    const who = part.attribution?.[0];
    const name = !who ? "shared"
      : who.scope === "Window" ? "page"
        : (who.url ?? "").split("/").pop()?.split("?")[0] || who.scope || "unknown";
    by.set(name, (by.get(name) ?? 0) + part.bytes);
  }
  return {
    totalMB: measured.bytes / (1 << 20),
    top: [...by].map(([name, bytes]) => ({ name, mb: bytes / (1 << 20) }))
      .sort((a, b) => b.mb - a.mb).slice(0, 5),
  };
}

/**
 * The kernel's `byThread` line (`"name instructions state p8 b0 | ..."`,
 * cumulative since each thread began) as each thread's instructions and state.
 *
 * @param {string | undefined} line
 * @returns {Map<string, { instructions: number, state: string }>}
 */
function threadsOf(line) {
  const threads = new Map();
  for (const entry of (line ?? "").split(" | ")) {
    const [name, instructions, state] = entry.split(" ");
    if (name && Number.isFinite(Number(instructions))) {
      threads.set(name, { instructions: Number(instructions), state });
    }
  }
  return threads;
}

/**
 * The bare regions the memory layer reports (`"Name base+size"` strings),
 * for resolving a raw guest address to the module it falls in -- the same
 * convention the test harness's own `symboliser` uses server-side
 * (`modules/core/test/page/game/harness.js`).
 *
 * @param {string[] | undefined} layout
 */
function regionsOf(layout) {
  // `"msvcrt.dll .data 0x201f000+0x1000 rw"`: a name may hold spaces, and
  // the access follows the extent.
  return (layout ?? [])
    .map((entry) => {
      const words = entry.split(" ");
      const at = words.findIndex((word) => /^(0x[0-9a-f]+|\d+)\+(0x[0-9a-f]+|\d+)$/i.test(word));
      if (at < 0) return null;
      const [base, size] = words[at].split("+").map(Number);
      return { name: words.slice(0, at).join(" "), base, end: base + size };
    })
    .filter((region) => region !== null)
    .sort((a, b) => a.base - b.base);
}

/** @param {{ name: string, base: number, end: number }[]} regions @param {number} address */
function whereIn(regions, address) {
  const region = regions.find((r) => address >= r.base && address < r.end);
  return region ? `${region.name}+0x${(address - region.base).toString(16)}` : "<unmapped>";
}

/**
 * Folds an `Image+0xrva` string through a bundle's own symbol table (the
 * largest function start at or below the RVA) -- the cpu layer never reads
 * this table itself (`docs/core/cpu.md`'s "Sampling"), so an address bucket
 * arrives named only as far as the module it falls in, and this is the step
 * that turns it into a function.
 *
 * @param {string} at
 * @param {Record<string, { rva: number, name: string | null }[]> | null | undefined} symbols
 */
function foldSymbol(at, symbols) {
  const match = symbols ? /^(.+)\+0x([0-9a-f]+)$/.exec(at) : null;
  if (!match) return at;
  const [, image, rvaHex] = match;
  const starts = symbols[image];
  if (!starts || starts.length === 0) return at;
  const rva = parseInt(rvaHex, 16);
  let found = null;
  for (const entry of starts) {
    if (entry.rva > rva) break;
    found = entry;
  }
  if (!found) return at;
  const offset = rva - found.rva;
  const label = found.name ?? `${image}+0x${found.rva.toString(16)}`;
  return offset === 0 ? label : `${label}+0x${offset.toString(16)}`;
}

/**
 * @typedef {Object} OverlayRows
 * @property {number} fps                 Canvas presents per second.
 * @property {number | null} frameMs       Wall ms per presented frame.
 * @property {number | null} gpuMs         The GPU's ms per frame, submit to done; null
 *           when no frame reached it in the window.
 * @property {number} instructionsPerSecond
 * @property {number | null} nsPerInstruction  Null with no guest phase yet.
 * @property {{ name: string, ms: number }[]} budget   The frame in ms per frame, by activity.
 * @property {{ name: string, ms: number }[]} phases   Host calls by function, ms per frame,
 *           when every call is profiled (`profileCalls`); empty otherwise.
 * @property {number | null} notInPhaseMs
 *           Wall time per frame that no phase accounted for: the frame minus
 *           every phase's self time (`log.phasesSelfMs`). Null when the two
 *           polls cannot give it -- no frame presented, or no phase totals.
 * @property {{ name: string, ms: number }[]} entryWork
 *           What a Direct3D 8 or 9 call does before its method, ms per frame by
 *           phase (`ring-sync` and the three inside it), each by its own self
 *           time; empty when none of them rose in the window.
 * @property {{ batchesPerSecond: number, readMs: number | null, sweepMs: number | null }
 *     | null} worker
 *           The graphics worker's thread (`graphics.worker.phases`): its
 *           batches read and played, without the look at objects at zero, and
 *           that look, in ms per frame; null ms when no frame was presented.
 *           Null when the worker has said nothing of its time -- not in use,
 *           not answered yet, or a build that times nothing.
 * @property {number} drawsPerFrame
 * @property {{ msPerFrame: number, top: { name: string, ms: number, calls: number }[] } | null} hooks
 *           Null when no sidecar hook is bound.
 * @property {{ name: string, share: number, instructionsPerSecond: number, ms: number }[]} guestCode
 *           The top eight guest functions by instructions this second, from
 *           the cpu layer's always-on sampler (`docs/core/cpu.md`'s
 *           "Sampling"). Empty before the sampler has anything to report.
 * @property {{ name: string, share: number, instructionsPerSecond: number, state: string }[]} threads
 *           The guest's threads by instructions retired this second, from the
 *           kernel's per-thread counts (`byThread`), the busiest first; empty
 *           before the kernel has reported twice.
 * @property {number | null} parallelBound
 *           This second's instructions over the busiest thread's: the most any
 *           number of executors running threads at once could have sped the
 *           guest up -- 1.0 is a program that is one thread. Null with none retired.
 * @property {number} guestMappedMB
 *           The guest's address space the memory layer has mapped, in MiB.
 * @property {{ name: string, count: number }[]} shownBy
 *           Canvas copies this second by what was shown (`presenter.shownBy`):
 *           a Direct3D target, OpenGL's gl-shown pair, the desktop's bytes. Two names
 *           rising together is a picture painted over by another.
 * @property {string | null} lastFrame
 *           The device's last presented frame in one line (`seam.device.
 *           recentFrames`): draws, of them offscreen, clears and the back
 *           buffer's clear colour, the viewport and the target. Null before
 *           a device has presented.
 */

/**
 * @param {{ name: string, metrics?: Record<string, any> }[] | null} previous
 *        The prior snapshot, or null for the first poll -- which has nothing to
 *        take a delta against and answers null.
 * @param {{ name: string, metrics?: Record<string, any> }[]} current
 * @param {number} elapsedMs  Wall time between the two polls, from the caller's
 *        own clock (`performance.now()`), not the guest's.
 * @param {Record<string, { rva: number, name: string | null }[]> | null} [symbols]
 *        A bundle's own `symbols.json` (`getSidecarSymbols`), for naming a
 *        bucket's function rather than its bare `image+0xrva`. Undefined or
 *        null for a bundle that carries none.
 * @returns {OverlayRows | null}
 */
export function overlayRows(previous, current, elapsedMs, symbols) {
  if (!previous || !(elapsedMs > 0)) return null;
  const seconds = elapsedMs / 1000;

  const cpuWas = metricsOf(previous, "cpu");
  const cpuNow = metricsOf(current, "cpu");
  const graphicsWas = metricsOf(previous, "graphics");
  const graphicsNow = metricsOf(current, "graphics");
  const logWas = metricsOf(previous, "log");
  const logNow = metricsOf(current, "log");
  const bridgeWas = metricsOf(previous, "bridge");
  const bridgeNow = metricsOf(current, "bridge");

  const instructions = rise(cpuNow.instructions ?? 0, cpuWas.instructions ?? 0);
  const frames = rise(graphicsNow.presenter?.shown ?? 0, graphicsWas.presenter?.shown ?? 0);
  const draws = rise(
    graphicsNow.seam?.device?.draws ?? 0,
    graphicsWas.seam?.device?.draws ?? 0,
  );

  const phasesWas = phaseSelfMs(logWas.topPhases);
  const phasesNow = phaseSelfMs(logNow.topPhases);
  const perFrame = (ms) => (frames > 0 ? ms / frames : 0);
  /** @type {{ name: string, ms: number }[]} */
  const deltas = [...phasesNow.entries()]
    .map(([name, ms]) => ({ name, ms: rise(ms, phasesWas.get(name) ?? 0) }));
  const of = (name) => deltas.find((row) => row.name === name)?.ms ?? 0;
  const guestMs = of("guest");
  // The frame's budget in ms per frame, by what the engine was doing. The
  // phase names are the engine's own (`docs/core/log.md`); `trap` holds every
  // host call, and with `profileCalls` on each call is a phase of its own
  // named `LIBRARY!function`, which is what the split below lists.
  const hostCalls = deltas.filter((row) => row.name.includes("!") || COM_METHOD.test(row.name));
  const gpuNames = new Set(["uploads", "passes", "submit", "present"]);
  const waitNames = new Set(["yield", "idle-deadline", "poll", "pump"]);
  const budget = [
    { name: "cork (game code)", ms: perFrame(guestMs) },
    { name: "host calls (GL, audio, win32)", ms: perFrame(of("trap")) },
    // Inside host calls, but not the call itself: shown apart, as the split below shows it.
    { name: "Direct3D entry (state to the device)", ms: perFrame(ENTRY_PHASES.reduce((sum, name) => sum + of(name), 0)) },
    { name: "GPU encode (uploads, passes, submit)", ms: perFrame(deltas.filter((row) => gpuNames.has(row.name)).reduce((sum, row) => sum + row.ms, 0)) },
    { name: "waiting for the page", ms: perFrame(deltas.filter((row) => waitNames.has(row.name)).reduce((sum, row) => sum + row.ms, 0)) },
    { name: "scheduler, audio ticks", ms: perFrame(deltas.filter((row) => ["turn", "waveTick", "videoTick", "microtasks"].includes(row.name)).reduce((sum, row) => sum + row.ms, 0)) },
  ].filter((row) => row.ms > 0.005);
  const phases = hostCalls
    .map((row) => ({ name: callName(row.name), ms: perFrame(row.ms) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);

  // What no phase covered: the time between the polls less every phase's
  // self time, so code nobody wrapped in a phase -- bookkeeping before a
  // call reaches its device, the loop between slices -- shows as itself
  // rather than inside the budget's rows. A weighted phase is an estimate
  // and can overshoot the wall by a little, which is not time found twice.
  const phasesSelf = typeof logNow.phasesSelfMs === "number" && typeof logWas.phasesSelfMs === "number"
    ? rise(logNow.phasesSelfMs, logWas.phasesSelfMs)
    : null;
  const notInPhaseMs = frames > 0 && phasesSelf !== null
    ? Math.max(0, elapsedMs - phasesSelf) / frames
    : null;

  // The work a Direct3D call does before its method, which the trap's own
  // time no longer holds: the guest's state brought to the device.
  const entryWork = ENTRY_PHASES
    .map((name) => ({ name, ms: perFrame(of(name)) }))
    .filter((row) => row.ms > 0);

  // The graphics worker keeps no phase table; its totals since it started
  // cross with its diagnostics, and a delta of them is its window.
  const workerNow = graphicsNow.worker?.phases ?? null;
  const workerWas = graphicsWas.worker?.phases ?? null;
  const worker = workerNow && workerWas
    ? {
      batchesPerSecond: rise(workerNow["batch-read"].count, workerWas["batch-read"].count) / seconds,
      readMs: frames > 0
        ? rise(workerNow["batch-read"].selfMs, workerWas["batch-read"].selfMs) / frames : null,
      sweepMs: frames > 0
        ? rise(workerNow["batch-sweep"].ms, workerWas["batch-sweep"].ms) / frames : null,
    }
    : null;

  // The GPU's time per frame, from a submit to the work done
  // (`seam.device.timing`); null when no frame reached the GPU in the window.
  const timingNow = graphicsNow.seam?.device?.timing;
  const timingWas = graphicsWas.seam?.device?.timing;
  const gpuFrames = timingNow && timingWas ? rise(timingNow.gpuFrames, timingWas.gpuFrames) : 0;
  const gpuMs = gpuFrames > 0 ? rise(timingNow.gpuMs, timingWas.gpuMs) / gpuFrames : null;

  const hooksNow = bridgeNow.hooks ?? [];
  const hooksWas = hookMs(bridgeWas.hooks);
  const hooks = hooksNow.length === 0 ? null : {
    msPerFrame: (frames > 0
      ? hooksNow.reduce((sum, hook) => sum + rise(hook.ms, hooksWas.get(hook.name) ?? 0), 0) / frames
      : 0),
    top: hooksNow
      .map((hook) => ({
        name: hook.name,
        ms: rise(hook.ms, hooksWas.get(hook.name) ?? 0),
        calls: rise(hook.calls ?? 0, hooksWas.get(`${hook.name}#calls`) ?? 0),
      }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 6),
  };

  // The cpu layer's always-on sampler: raw address buckets, cumulative since
  // boot (`docs/core/cpu.md`'s "Sampling"). Reported here by the bucket's own
  // address, matching `rise()`'s pattern for every other cumulative counter
  // on this page -- a bucket absent from the prior poll's top 64 is treated
  // as having started this second at zero, which is right unless it was
  // already hot and simply ranked below 64th, a rare miss at this cadence.
  const samplesWas = new Map((cpuWas.samples?.top ?? []).map((bucket) => [bucket.address, bucket]));
  const regions = regionsOf(metricsOf(current, "memory").layout);
  const guestDeltas = (cpuNow.samples?.top ?? [])
    .map((bucket) => {
      const was = samplesWas.get(bucket.address);
      return {
        address: bucket.address,
        instructions: rise(bucket.instructions, was?.instructions ?? 0),
      };
    })
    .filter((bucket) => bucket.instructions > 0)
    .sort((a, b) => b.instructions - a.instructions);
  // The sampler carries no clock (its cost would be a fifth of a heavy
  // frame); a bucket's ms is its share of the second's instructions against
  // the guest phase's own ms over the same interval.
  const guestTotal = guestDeltas.reduce((sum, bucket) => sum + bucket.instructions, 0);
  const guestCode = guestDeltas.slice(0, 8).map((bucket) => ({
    name: foldSymbol(whereIn(regions, bucket.address), symbols),
    share: guestTotal > 0 ? (100 * bucket.instructions) / guestTotal : 0,
    instructionsPerSecond: bucket.instructions / seconds,
    ms: instructions > 0 ? (bucket.instructions / instructions) * guestMs : 0,
  }));

  const threadsWas = threadsOf(metricsOf(previous, "kernel").byThread);
  const threadDeltas = [...threadsOf(metricsOf(current, "kernel").byThread)]
    .map(([name, now]) => ({
      name,
      state: now.state,
      instructions: rise(now.instructions, threadsWas.get(name)?.instructions ?? 0),
    }))
    .sort((a, b) => b.instructions - a.instructions);
  const threadTotal = threadDeltas.reduce((sum, thread) => sum + thread.instructions, 0);
  const threads = threadDeltas
    .filter((thread) => thread.instructions > 0)
    .slice(0, 6)
    .map((thread) => ({
      name: thread.name,
      share: (100 * thread.instructions) / threadTotal,
      instructionsPerSecond: thread.instructions / seconds,
      state: thread.state,
    }));
  const parallelBound = threadTotal > 0 ? threadTotal / threadDeltas[0].instructions : null;

  // The guest's address space the memory layer has mapped, reserved or
  // committed: what a program's own allocations have grown to.
  const guestMappedMB = regionsOf(metricsOf(current, "memory").layout)
    .reduce((sum, region) => sum + (region.end - region.base), 0) / (1 << 20);

  const shownWas = graphicsWas.presenter?.shownBy ?? {};
  const shownBy = Object.entries(graphicsNow.presenter?.shownBy ?? {})
    .map(([name, count]) => ({ name, count: rise(count, shownWas[name] ?? 0) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  const recent = graphicsNow.seam?.device?.recentFrames;
  const last = Array.isArray(recent) && recent.length > 0 ? recent[recent.length - 1] : null;
  const lastFrame = last && typeof last.clears === "number"
    ? `#${last.index} draws ${last.draws}`
      + (last.offscreenDraws > 0 ? ` (${last.offscreenDraws} offscreen into ${last.offscreenTargets})` : "")
      + `, clears ${last.clears}${last.clearColor ? ` ${last.clearColor}` : ""}`
      + `, viewport ${last.viewport} of ${last.target}`
    : null;

  return {
    fps: frames / seconds,
    frameMs: frames > 0 ? elapsedMs / frames : null,
    gpuMs,
    instructionsPerSecond: instructions / seconds,
    nsPerInstruction: instructions > 0 ? (guestMs * 1e6) / instructions : null,
    budget,
    phases,
    notInPhaseMs,
    entryWork,
    worker,
    guestCode,
    threads,
    parallelBound,
    guestMappedMB,
    drawsPerFrame: frames > 0 ? draws / frames : draws,
    hooks,
    shownBy,
    lastFrame,
  };
}
