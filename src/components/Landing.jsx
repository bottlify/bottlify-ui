/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import { Box, Button, Divider, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import glowMask from "../assets/hero-glow-mask.png";
import hero600 from "../assets/hero-600.webp";
import hero900 from "../assets/hero-900.webp";
import hero1105 from "../assets/hero-1105.webp";
import eyeLeft from "../assets/hero-eye-left.png";
import eyeRight from "../assets/hero-eye-right.png";

// The illustration's own pixel grid, and the two eyes on it. The painting's
// eyes are blank glass: each is fitted as an ellipse (the white inside the dark
// rim), which becomes the window a black pupil moves in, clipped to it, and the
// glass on top is the painting's own highlights cut out by luminance. The
// pupils are about the size the painted pupils of an earlier version were.
// All in image pixels.
const ART = { width: 1105, height: 960 };
const EYES = [
  {
    // The fitted white, brought in so the window stays inside the painted rim.
    cx: 667.6, cy: 231.6, rx: 36.3, ry: 28.2, angle: -60.3,
    // The pupil rests one image pixel right of the window's centre (which in
    // the window's own frame is this offset), and the clamp is the nearer side.
    pupil: { rx: 26.8, ry: 23.1, ox: 0.5, oy: 0.87 }, travel: { x: 8.0, y: 3.2 },
    glass: { src: eyeLeft, x: 629, y: 193, w: 74, h: 79 },
  },
  {
    // The fitted white plus 2 px all round, so the pupil has room to move.
    cx: 824.2, cy: 256, rx: 33.8, ry: 31.8, angle: 88.7,
    // Larger than its share of the rim: this eye is drawn a little smaller,
    // and the two pupils should read the same size on screen.
    pupil: { rx: 28.1, ry: 26.4 }, travel: { x: 4.7, y: 4.4 },
    glass: { src: eyeRight, x: 791, y: 221, w: 67, h: 70 },
  },
];
const PUPIL_COLOR = "rgb(14,14,14)";
// The light of the game, five colours on short periods that never line up,
// each holding a level and then jumping to the next: a picture playing on a
// screen, not a lamp breathing. Every jump is a few percent of a pastel at low
// alpha, and no layer jumps more than three times a second.
const GLOW = [
  { color: "#d48f95", period: 2.3, levels: [0.12, 0.16, 0.09, 0.18, 0.11, 0.14] },
  { color: "#d7b36f", period: 1.7, levels: [0.08, 0.13, 0.06, 0.11, 0.15] },
  { color: "#9dc48a", period: 3.1, levels: [0.05, 0.1, 0.04, 0.12, 0.07, 0.09, 0.05] },
  { color: "#84b4d6", period: 1.3, levels: [0.05, 0.09, 0.03] },
  { color: "#ad95cf", period: 0.9, levels: [0.06, 0.12] },
];
const flicker = (levels) => {
  const frames = {};
  const n = levels.length;
  levels.forEach((level, i) => {
    frames[`${((i * 100) / n).toFixed(1)}%`] = { opacity: level };
    frames[`${(((i + 1) * 100) / n - 1).toFixed(1)}%`] = { opacity: level };
  });
  frames["100%"] = { opacity: levels[0] };
  return frames;
};
const pct = (value, of) => `${(value / of) * 100}%`;

/**
 * The front page for bottlify.app: what it is, and where it actually is.
 *
 * Two sections only. Every claim here is one the repository can back today, and
 * the state of the work is the second half of the pitch rather than a
 * disclaimer bolted on, because the project is early and a landing page that
 * hides that ages into a lie.
 */
export function Landing() {
  return (
    <Box component="main">
      <Hero />
      <Divider />
      <Post />
    </Box>
  );
}

function Hero() {
  const art = useRef(null);
  // The picture is the painting, the glass over its eyes and the mask of its
  // light, each its own file; shown as they come, a part floats over nothing
  // or the toad stares without eyes. It appears once every part is here --
  // at once when the browser already has them.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    let live = true;
    const parts = [...art.current.querySelectorAll("img")].map((image) => image.decode());
    const mask = new Image();
    mask.src = glowMask;
    parts.push(mask.decode());
    // A part that fails to come is no reason to keep the rest hidden.
    Promise.allSettled(parts).then(() => live && setPainted(true));
    return () => { live = false; };
  }, []);

  // The pupils follow the pointer anywhere on the page. Each is worked out on
  // its own from where it sits on screen, clamped to the ring around it, so a
  // pointer close to the face converges them by itself.
  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return undefined;
    const root = art.current;
    const image = root.querySelector("img");
    const pupils = [...root.querySelectorAll("[data-pupil]")];
    let pointer = null;
    let frame = 0;
    const place = () => {
      frame = 0;
      const scale = image.getBoundingClientRect().width / ART.width;
      pupils.forEach((pupil, i) => {
        const eye = EYES[i];
        let dx = 0;
        let dy = 0;
        if (pointer && scale > 0) {
          const box = pupil.getBoundingClientRect();
          const px = (pointer.x - (box.left + box.width / 2)) / scale;
          const py = (pointer.y - (box.top + box.height / 2)) / scale;
          // Into the window's frame, then no further than the rim in that direction.
          const t = (eye.angle * Math.PI) / 180;
          dx = px * Math.cos(t) + py * Math.sin(t);
          dy = -px * Math.sin(t) + py * Math.cos(t);
          const k = Math.hypot(dx / eye.travel.x, dy / eye.travel.y);
          if (k > 1) {
            dx /= k;
            dy /= k;
          }
        }
        pupil.style.transform = `translate(${(dx * scale).toFixed(2)}px, ${(dy * scale).toFixed(2)}px)`;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const onMove = (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const rest = () => {
      pointer = null;
      schedule();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", rest);
    window.addEventListener("blur", rest);
    const resized = new ResizeObserver(schedule);
    resized.observe(image);
    return () => {
      resized.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", rest);
      window.removeEventListener("blur", rest);
    };
  }, []);

  return (
    <Box
      sx={{
        px: { xs: 3, md: 6 },
        py: { xs: 8, md: 12 },
        display: "grid",
        gap: { xs: 6, md: 8 },
        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1.15fr) minmax(0, 0.85fr)" },
        alignItems: "center",
      }}
    >
      <Box>
        <Typography
          variant="h1"
          sx={{
            fontWeight: 800,
            letterSpacing: "-0.035em",
            lineHeight: 1.02,
            fontSize: { xs: "2.6rem", sm: "3.4rem", md: "4.2rem" },
          }}
        >
          Original Windows games,
          <Box component="span" sx={{ color: "text.secondary" }}> in a browser tab.</Box>
        </Typography>
        <Typography
          variant="h6"
          color="text.secondary"
          sx={{ mt: 3, maxWidth: 620, fontWeight: 400, lineHeight: 1.6 }}
        >
          Nothing is installed and nothing is streamed from a server. The game&apos;s own code,
          the same x86 executable it shipped with, runs on your machine, inside the page.
        </Typography>

        <Button
          href="/library"
          size="large"
          variant="contained"
          sx={{ mt: 5, px: 3.5, fontWeight: 700, bgcolor: "text.primary", color: "#1e2022" }}
        >
          Open the library
        </Button>
      </Box>

      <Box
        ref={art}
        data-hero
        aria-hidden
        sx={{
          position: "relative",
          justifySelf: "center",
          // Grows with the window and never past the column. The source is
          // 1105 px, so above ~550 px rendered a retina screen gets it 1:1.
          width: "clamp(375px, 40vw, 640px)",
          maxWidth: "100%",
          opacity: painted ? 1 : 0,
          transition: "opacity 300ms ease-out",
          background: "radial-gradient(closest-side, rgba(255,255,255,0.07), transparent 70%)",
          "& img": { width: "100%", height: "auto", display: "block" },
          "@keyframes hero-glow-0": flicker(GLOW[0].levels),
          "@keyframes hero-glow-1": flicker(GLOW[1].levels),
          "@keyframes hero-glow-2": flicker(GLOW[2].levels),
          "@keyframes hero-glow-3": flicker(GLOW[3].levels),
          "@keyframes hero-glow-4": flicker(GLOW[4].levels),
          "@keyframes hero-halo": { from: { transform: "scale(1)" }, "50%": { transform: "scale(1.03)" }, to: { transform: "scale(1)" } },
          "@media (prefers-reduced-motion: reduce)": {
            "& [data-glow], & [data-halo]": { animation: "none" },
            "& [data-pupil]": { transition: "none" },
          },
        }}
      >
        <picture>
          <source
            type="image/webp"
            srcSet={`${hero600} 600w, ${hero900} 900w, ${hero1105} 1105w`}
            sizes="(min-width: 900px) min(40vw, 640px), min(100vw - 48px, 375px)"
          />
          <img src={hero900} width={ART.width} height={ART.height} alt="" decoding="async" />
        </picture>

        {/* Each eye: an elliptical window over the painted white with the
            pupil inside it; the window clips the pupil, so it can never leave
            the socket. The glass goes on top, unrotated. */}
        {EYES.map((eye, i) => (
          <Box
            key={`eye-${eye.cx}`}
            data-eye={i}
            sx={{
              position: "absolute",
              overflow: "hidden",
              borderRadius: "50%",
              left: pct(eye.cx - eye.rx, ART.width),
              top: pct(eye.cy - eye.ry, ART.height),
              width: pct(2 * eye.rx, ART.width),
              height: pct(2 * eye.ry, ART.height),
              transform: `rotate(${eye.angle}deg)`,
            }}
          >
            <Box
              data-pupil={i}
              sx={{
                position: "absolute",
                borderRadius: "50%",
                background: PUPIL_COLOR,
                boxShadow: "0 0 1.5px 1px rgba(0,0,0,0.5)",
                left: pct(eye.rx + (eye.pupil.ox ?? 0) - eye.pupil.rx, 2 * eye.rx),
                top: pct(eye.ry + (eye.pupil.oy ?? 0) - eye.pupil.ry, 2 * eye.ry),
                width: pct(2 * eye.pupil.rx, 2 * eye.rx),
                height: pct(2 * eye.pupil.ry, 2 * eye.ry),
                transition: "transform 120ms ease-out",
                willChange: "transform",
              }}
            />
          </Box>
        ))}
        {EYES.map((eye) => (
          <Box
            key={`glass-${eye.cx}`}
            component="img"
            src={eye.glass.src}
            alt=""
            data-glass
            sx={{
              position: "absolute",
              pointerEvents: "none",
              left: pct(eye.glass.x, ART.width),
              top: pct(eye.glass.y, ART.height),
              width: `${(eye.glass.w / ART.width) * 100}% !important`,
              height: `${(eye.glass.h / ART.height) * 100}% !important`,
            }}
          />
        ))}

        {/* The light of the game: five colours flickering on the picture's own
            lit region around the set, the halo swelling a little with them. */}
        <Box
          data-halo
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            transformOrigin: "37% 67%",
            animation: "hero-halo 2.3s ease-in-out infinite",
          }}
        >
          {GLOW.map((layer, i) => (
            <Box
              key={layer.color}
              data-glow={i}
              sx={{
                position: "absolute",
                inset: 0,
                background: layer.color,
                mixBlendMode: "screen",
                opacity: layer.levels[0],
                maskImage: `url(${glowMask})`,
                WebkitMaskImage: `url(${glowMask})`,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
                animation: `hero-glow-${i} ${layer.period}s linear infinite`,
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The state of the machine, said the way a machine of the era said it: a
 * power-on self-test. Every line is a fact about this engine, in our own
 * words, and the two that can be checked from a page are checked -- a browser
 * without WebGPU or without cross-origin isolation reads it here before it
 * reads it in a failed launch.
 *
 * Typed out line by line with CSS alone, and shown whole for anyone who asked
 * the system for less motion. It is a screen, so it is dark whatever the page
 * around it is. Beside it, in plain words, where the project stands.
 */
function Post() {
  const lines = [
    ["BottliROM", "64 KiB, own firmware, BIOS", "SECURED"],
    ["CPU", "x86 32-bit, cork-x32", "OK"],
    ["CPU", "x86-64, cork-x64", "NOT READY"],
    ["Core", "CPU multithreading", "ALLOWED"],
    ["Memory", "guest RAM, grown on demand", "OK"],
    ["Kernel", "threads, waits, timers, processes", "OK"],
    ["Loader", "PE images, system DLLs made in guest", "OK"],
    ["Win32", "kernel32 user32 gdi32 advapi32 ole32 ...", "OK"],
    ["Display", "DirectX 7-10, OpenGL on WebGPU", navigator.gpu ? "OK" : "NOT FOUND"],
    ["Sound", "DirectSound, waveOut on WebAudio",
      globalThis.crossOriginIsolated ? "OK" : "NOT ISOLATED"],
    ["Input", "keyboard, mouse, gamepad", "OK"],
    ["Media", "video and image codecs", "OK"],
    ["Network", "Winsock over the relay", "OK"],
    ["Disk C:", "the bottle, saves in the browser", "MOUNTED"],
    ["Workers", "engine, graphics, journal, sound", "OK"],
  ];
  const text = lines.map(([name, what, says]) => `${name.padEnd(13)}${what.padEnd(44)}${says}`);
  text.push("Press any key to continue ");

  // Any key is the promise the last line makes; a shortcut is a key the person
  // meant for the browser, and a modifier alone is not a key yet.
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.length === 1 || event.key === "Enter") {
        window.history.pushState(null, "", "/library");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  let delay = 0;
  return (
    <Box
      sx={{
        px: { xs: 3, md: 6 },
        py: { xs: 7, md: 10 },
        display: "grid",
        gap: { xs: 4, md: 8 },
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1.15fr) minmax(0, 0.85fr)" },
        alignItems: "start",
      }}
    >
      <Box
        component="a"
        href="/library"
        aria-label="open the library"
        sx={{
          display: "block",
          minWidth: 0,
          p: { xs: 2.5, md: 4 },
          border: "1px solid #4a4e52",
          borderRadius: 1,
          bgcolor: "#0b0c0d",
          color: "#e6e6e3",
          textDecoration: "none",
          fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: { xs: 12, md: 14 },
          lineHeight: 1.7,
          overflowX: "auto",
          "&:focus-visible": { outline: "1px solid #e6e6e3", outlineOffset: 2 },
          "@keyframes post-type": { from: { width: 0 }, to: { width: "100%" } },
          "@keyframes post-blink": { "50%": { opacity: 0 } },
          "@media (prefers-reduced-motion: reduce)": {
            "& > div": { animation: "none", width: "auto" },
            "& > div > span": { animation: "none" },
          },
        }}
      >
        {text.map((line, at) => {
          const last = at === text.length - 1;
          const start = delay;
          delay += line.length * 0.012 + 0.25;
          return (
            <Box
              key={line}
              sx={{
                whiteSpace: "pre",
                overflow: "hidden",
                width: 0,
                animation: `post-type ${(line.length * 0.012).toFixed(2)}s steps(${line.length}) ${start.toFixed(2)}s forwards`,
              }}
            >
              {line}
              {last && (
                <Box
                  component="span"
                  aria-hidden
                  sx={{ animation: `post-blink 1s steps(1) ${delay.toFixed(2)}s infinite` }}
                >
                  _
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
          Under construction.
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 2, lineHeight: 1.75 }}>
          Bottlify is in an active phase of development. Most games do not yet run out of the
          box: what runs today runs through a reimplementation of Windows and DirectX that is
          still being built, one API at a time. Expect rough edges: a title that starts may
          stall, draw wrongly or go quiet. Expect them to be fixed rather than worked around.
        </Typography>
      </Box>
    </Box>
  );
}
