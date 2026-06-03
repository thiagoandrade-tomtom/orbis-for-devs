import { useEffect, useRef, useState } from "react";
import logoDefault from "../assets/logo_default.svg";
import logoWhite from "../assets/logo_white.svg";
// @ts-expect-error — the @tomtom-org/maps-sdk package ships its own types but
// they aren't currently exported through the entrypoint we use here.
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
// @ts-expect-error — same reason.
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";

const TOMTOM_API_KEY: string = (import.meta as any).env?.VITE_TOMTOM_API_KEY ?? "";
if (TOMTOM_API_KEY) {
  TomTomConfig.instance.put({
    apiKey: TOMTOM_API_KEY,
    apiVersion: 1,
    commonBaseURL: "https://api.tomtom.com",
  });
}

/* ─── Types ──────────────────────────────────────────────────────── */
type Tone = "negative" | "neutral" | "positive" | "alternative";

interface Item {
  id: string;
  label: string;
  kicker?: string;
  description: string;
  accent?: string;
}

interface Layer {
  id: string;
  name: string;
  tone: Tone;
  /** Orbit radius in vmin from the offscreen-right globe centre. */
  orbitR: number;
  /** Angle of the chip dot on the orbit, degrees. 180° = straight-left of globe centre. */
  dotAngle: number;
  /** Chip headline copy used in the zoom view. */
  zoomTitle: string;
  /** Hand-picked highlights to feature as 3 cards in the zoom view. */
  items: Item[];
}

/* ─── Layer data ─────────────────────────────────────────────────── */
const LAYERS: Layer[] = [
  {
    id: "map-data",
    name: "Map data",
    tone: "negative",
    orbitR: 56,
    dotAngle: 145,
    zoomTitle: "The freshest map data",
    items: [
      { id: "map-display",   kicker: "Maps",      label: "Map Display",      description: "Raster and vector basemaps for web, mobile and in-vehicle.",          accent: "Worldwide coverage" },
      { id: "traffic",       kicker: "Traffic",   label: "Live Traffic",     description: "Real-time and historical traffic data for any route or area.",       accent: "Sub-minute freshness" },
      { id: "move",          kicker: "Analytics", label: "TomTom Move",      description: "Mobility analytics and traffic reports at country scale.",           accent: "200+ markets" },
    ],
  },
  {
    id: "apis",
    name: "APIs",
    tone: "neutral",
    orbitR: 64,
    dotAngle: 168,
    zoomTitle: "Location APIs, wired up fast",
    items: [
      { id: "search",   kicker: "Places",     label: "Search API",   description: "Global address & POI search with fuzzy matching.",      accent: "190M+ places" },
      { id: "routing",  kicker: "Navigation", label: "Routing API",  description: "Live-traffic routes with vehicle profiles and waypoints.", accent: "Sub-second" },
      { id: "ev",       kicker: "EV",         label: "EV Routing",   description: "Plan EV trips with optimised charging stops along the way.",  accent: "1M+ chargers" },
    ],
  },
  {
    id: "sdks",
    name: "SDKs",
    tone: "alternative",
    orbitR: 73,
    dotAngle: 205,
    zoomTitle: "SDKs to ship maps anywhere",
    items: [
      { id: "web",    kicker: "SDK", label: "Maps SDK · Web",    description: "Customisable maps, search and routing for web apps.",  accent: "JavaScript" },
      { id: "mobile", kicker: "SDK", label: "Mobile Navigation", description: "Real-time maps and turn-by-turn for iOS and Android.", accent: "iOS · Android" },
      { id: "auto",   kicker: "SDK", label: "Automotive",        description: "Next-gen navigation for Android Automotive OS.",       accent: "In-vehicle" },
    ],
  },
  {
    id: "agents",
    name: "MCP",
    tone: "positive",
    orbitR: 80,
    dotAngle: 188,
    zoomTitle: "Build anything with AI",
    items: [
      { id: "mcp",     kicker: "AI", label: "MCP Server",  description: "Give AI applications direct access to TomTom location APIs.", accent: "Open-source" },
      { id: "toolkit", kicker: "AI", label: "Agent Toolkit", description: "53+ location tools for building spatially aware agents.",   accent: "Developer kit" },
      { id: "agent",   kicker: "AI", label: "TomTom AI Agent", description: "Conversational voice navigation powered by GenAI.",     accent: "In-vehicle" },
    ],
  },
];

/* ─── App shell ──────────────────────────────────────────────────── */
type Theme = "light" | "dark";
type View  = "idle"  | "zoom";

export default function OrbitingMenu() {
  const [theme, setTheme]             = useState<Theme>("dark");
  const [view,  setView]              = useState<View>("idle");
  const [hoveredId, setHoveredId]     = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<Layer | null>(null);

  // Zoom view is wired to the browser History API so the Back button
  // (or ⌘← / Alt←) closes the layer. Opening pushes a state entry;
  // both the Return button and a popstate from the user roll the
  // entry off via history.back(), and the popstate handler reverts UI.
  const openLayer  = (l: Layer) => {
    setActiveLayer(l);
    setView("zoom");
    window.history.pushState({ orbitView: "zoom", layer: l.id }, "");
  };
  const closeLayerUi = () => {
    setView("idle");
    window.setTimeout(() => setActiveLayer(null), 500);
  };
  const closeLayer = () => {
    // Defer the UI close to the popstate handler so Return + browser
    // Back share one code path and the history stack stays consistent.
    if (window.history.state?.orbitView === "zoom") window.history.back();
    else closeLayerUi();
  };

  useEffect(() => {
    const onPop = () => {
      // Any pop while the zoom view is open means the user navigated
      // away from the pushed entry — close the layer.
      setView(v => {
        if (v === "zoom") {
          window.setTimeout(() => setActiveLayer(null), 500);
          return "idle";
        }
        return v;
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="concept-orbit" data-theme={theme} data-view={view}>
      <ThemeToggle theme={theme} onToggle={() => setTheme(t => t === "dark" ? "light" : "dark")} />

      <IdleScene theme={theme} hoveredId={hoveredId} onHover={setHoveredId} onOpen={openLayer} />
      <LeftContent visible={view === "idle"} theme={theme} />
      {activeLayer && (
        <svg
          className={`zoom-mega-orbit tone-${activeLayer.tone} ${view === "zoom" ? "is-visible" : "is-hidden"}`}
          viewBox="-100 -100 200 200"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <circle cx="0" cy="0" r="92" />
        </svg>
      )}
      <ZoomScene layer={activeLayer} visible={view === "zoom"} onClose={closeLayer} />
    </div>
  );
}

/* ─── Left content ───────────────────────────────────────────────── */
function LeftContent({ visible, theme }: { visible: boolean; theme: Theme }) {
  return (
    <div className={`left-content ${visible ? "is-visible" : "is-hidden"}`}>
      <TomTomLogo theme={theme} />
      {/* Two non-breaking spans split by a hard <br> so the heading
          ALWAYS renders as exactly two lines. Without the spans, narrow
          columns could push "Easy to build with." to a third line. */}
      <h1 className="heading">
        <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>Hard to beat.</span>
        <br />
        <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>Easy to build with.</span>
      </h1>
      <p className="body">
        TomTom gives developers everything they need to build with location —
        map data, APIs, SDKs and agentic AI, all powered by the freshest map in the world.
      </p>
    </div>
  );
}

function TomTomLogo({ theme }: { theme: Theme }) {
  return (
    <img
      className="logo"
      src={theme === "dark" ? logoWhite : logoDefault}
      alt="TomTom"
      width={112}
      height={22}
    />
  );
}

/* ─── Card thumbnail (blueprint-style placeholder) ───────────────── */
/* Per-product wireframe sketch in the layer tone. Each id renders a
   distinctive illustration so the three cards in a row read as
   different products at a glance. Real photography/screenshots will
   replace these when product data lands. */
function CardThumb({ id }: { id: string }) {
  // Placeholder mode — illustrations removed while we work on the real
  // ones. We keep the tone-tinted background (set via CSS on .z-card-thumb)
  // and the subtle grid pattern so cards still read as distinct surfaces.
  return (
    <svg className="z-card-thumb" viewBox="0 0 300 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <pattern id={`thumb-grid-${id}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 L0 0 L0 20" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.18" />
        </pattern>
      </defs>
      <rect width="300" height="100" fill={`url(#thumb-grid-${id})`} />
    </svg>
  );
}

/* ─── Chip icons (filled glyphs, painted via currentColor) ───────── */
function ChipIcon({ id }: { id: string }) {
  switch (id) {
    case "map-data":
      return (
        <svg width="16" height="16" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <path d="M17.5 0H17.2C16.936 -0.0013 16.6743 0.0497 16.43 0.15L12 2L7.75 0.23C7.38554 0.0784 6.99474 0.0003 6.6 0H5.4C5.00528 0.0003 4.61448 0.0784 4.25 0.23L0.62 1.74C0.243218 1.89481 -0.00202752 2.26268 0 2.67V17.5C0 17.7762 0.22387 18 0.5 18H0.8C1.064 18.0013 1.32576 17.9504 1.57 17.85L6 16L10.25 17.77C10.6145 17.9216 11.0053 17.9998 11.4 18H12.6C12.9947 17.9998 13.3855 17.9216 13.75 17.77L17.38 16.26C17.7568 16.1052 18.0021 15.7374 18 15.33V0.5C18 0.2238 17.7762 0 17.5 0ZM11 15.92L6.77 14.15L6 13.83V2H6.6C6.73069 2.0016 6.85979 2.0288 6.98 2.08L11.23 3.85L12 4.17V16.0001L11.4 16C11.2626 16.0011 11.1264 15.9739 11 15.92Z" />
        </svg>
      );
    case "apis":
      return (
        <svg width="18" height="14" viewBox="0 0 20 16" fill="currentColor" aria-hidden="true">
          <path d="M16 10H9.99997V12H16V10Z" />
          <path d="M6.58597 8.00003L4.29297 5.70703L5.70697 4.29303L9.41397 8.00003L5.70697 11.707L4.29297 10.293L6.58597 8.00003Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M2 0H18C19.103 0 20 0.897 20 2V14C20 15.103 19.103 16 18 16H2C0.897 16 0 15.103 0 14V2C0 0.897 0.897 0 2 0ZM2 2V14H18.002L18 2H2Z" />
        </svg>
      );
    case "sdks":
      return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M0 8.88889V0H8.88889V8.88889H0ZM2.22222 2.22222H6.66667V6.66667H2.22222V2.22222Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M11.1111 8.88889V0H20V8.88889H11.1111ZM13.3333 2.22222H17.7778V6.66667H13.3333V2.22222Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M11.1111 11.1111V20H20V11.1111H11.1111ZM17.7778 13.3333H13.3333V17.7778H17.7778V13.3333Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M0 20V11.1111H8.88889V20H0ZM2.22222 13.3333H6.66667V17.7778H2.22222V13.3333Z" />
        </svg>
      );
    case "agents":
      return (
        <svg width="16" height="16" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true">
          <path d="M8.23848 4.20246C8.46744 3.50629 9.45223 3.50629 9.68118 4.20246L11.4711 9.64481C11.5464 9.8739 11.7261 10.0536 11.9552 10.1289L17.3975 11.9188C18.0937 12.1478 18.0937 13.1326 17.3975 13.3615L11.9552 15.1514C11.7261 15.2268 11.5464 15.4064 11.4711 15.6355L9.68118 21.0779C9.45223 21.774 8.46744 21.774 8.23848 21.0779L6.44859 15.6355C6.37325 15.4064 6.19357 15.2268 5.96448 15.1514L0.522123 13.3615C-0.17404 13.1326 -0.174042 12.1478 0.522122 11.9188L5.96448 10.1289C6.19357 10.0536 6.37325 9.8739 6.44859 9.64481L8.23848 4.20246Z" />
          <path d="M16.5737 0.584964C16.7578 -0.194989 17.8678 -0.194987 18.0519 0.584965L18.5098 2.52554C18.5759 2.80553 18.7945 3.02414 19.0745 3.09021L21.015 3.54813C21.795 3.73217 21.795 4.84221 21.015 5.02626L19.0745 5.48417C18.7945 5.55024 18.5759 5.76885 18.5098 6.04884L18.0519 7.98942C17.8678 8.76937 16.7578 8.76937 16.5737 7.98942L16.1158 6.04884C16.0498 5.76885 15.8311 5.55024 15.5512 5.48417L13.6106 5.02626C12.8306 4.84221 12.8306 3.73217 13.6106 3.54813L15.5512 3.09021C15.8311 3.02414 16.0498 2.80553 16.1158 2.52554L16.5737 0.584964Z" />
        </svg>
      );
    default:
      return null;
  }
}

/* Hook that tracks viewport width so orbit sizes can compress on narrow
   screens. Avoids chips overlapping the hero text on tablet/mobile. */
function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

/* ─── Idle scene ─────────────────────────────────────────────────── */
function IdleScene({
  theme, hoveredId, onHover, onOpen,
}: {
  theme: Theme;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (l: Layer) => void;
}) {
  const vw = useViewportWidth();
  // Scale orbits down on narrow viewports so the chips don't slam into
  // the hero text on the left. Smooth interpolation between 0.70 and 1
  // across 560–1280px viewports — kicks in earlier than the old 900px
  // cutoff because at 1024 the leftmost chip was within 12px of the
  // body text and at 840 it overlapped by 9px.
  // Figma shows the side-by-side layout from 841px up; at ≤840 the globe
  // drops to the bottom and text takes the top half (stacked / portrait).
  const stacked = vw <= 840;
  // Two regimes:
  // - Stacked (≤840): globe is centred at the bottom with radius
  //   55vmin (see CSS). Orbits MUST be larger than that so they arc
  //   outside the globe instead of cutting across its surface.
  //   1.15× pushes the innermost (56vmin) to 64.4vmin — clears the
  //   55vmin globe with ~9vmin of breathing room.
  // - Desktop (>840): compress orbits below 1500 so the outermost
  //   (80vmin) chip doesn't collide with the hero text. At 1500+
  //   they run full size; below 600 they cap at 0.55.
  const orbitScale = stacked
    ? 1.15
    : vw >= 1500 ? 1
    : vw <= 600  ? 0.55
    : 0.55 + ((vw - 600) / 900) * 0.45;
  return (
    <div className="idle-scene">
      <div className="idle-vignette" aria-hidden="true" />

      <GlobeMap theme={theme} />
      <GlobeGrid theme={theme} />

      {/* Concentric dashed orbits anchored to the offscreen-right globe centre.
          ViewBox units == vmin, so circle r maps 1:1 to orbitR in CSS.
          Each orbit pairs a decorative dashed ring with a wider invisible
          `orbit-hit` ring that captures hover/click. */}
      <div className="orbits-wrap">
        <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
          {LAYERS.map((l, i) => {
            const r = l.orbitR * orbitScale;
            return (
              <g key={`orbit-${l.id}`}>
                <circle
                  cx="0"
                  cy="0"
                  r={r}
                  className={`orbit-ring tone-${l.tone} ${hoveredId === l.id ? "is-active" : ""}`}
                  style={{ animationDelay: `${0.15 + i * 0.12}s` }}
                />
                <circle
                  cx="0"
                  cy="0"
                  r={r}
                  className="orbit-hit"
                  role="button"
                  aria-label={`Open ${l.name}`}
                  onMouseEnter={() => onHover(l.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(l.id)}
                  onBlur={() => onHover(null)}
                  onClick={() => onOpen(l)}
                  tabIndex={0}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Chips (satellite + label tag) */}
      <div className="chips">
        {LAYERS.map((l, i) => {
          // Stacked-mode angle spread: the desktop dotAngles span 145°-195°
          // (a 50° range). In stacked we map that range to an arc centred
          // at 270° (straight up from the globe). The multiplier controls
          // how wide the arc is — smaller = tighter = more likely every
          // chip + label fits inside narrow viewports.
          //   0.7 → 35° arc (252.5°-287.5°) → outer chips at vmin=375
          //   land ~80px inside each viewport edge.
          const angle = stacked ? (l.dotAngle - 170) * 0.7 + 270 : l.dotAngle;
          const rad = (angle * Math.PI) / 180;
          const r = l.orbitR * orbitScale;
          const dx = `calc(${Math.cos(rad).toFixed(4)} * ${r}vmin)`;
          const dy = `calc(${Math.sin(rad).toFixed(4)} * ${r}vmin)`;
          const enterDelay = 0.45 + i * 0.12;
          return (
            <button
              key={`chip-${l.id}`}
              className={`chip tone-${l.tone} ${hoveredId === l.id ? "is-hovered" : ""}`}
              style={{
                left: `calc(var(--globe-cx) + ${dx})`,
                top:  `calc(var(--globe-cy) + ${dy})`,
                animationDelay: `${enterDelay}s`,
              }}
              onMouseEnter={() => onHover(l.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(l.id)}
              onBlur={() => onHover(null)}
              onClick={() => onOpen(l)}
              aria-label={`Open ${l.name}`}
            >
              <span className="chip-pill">
                <ChipIcon id={l.id} />
                <span className="chip-label">{l.name}</span>
              </span>
              <span className="chip-stem" aria-hidden="true" />
              <span className="chip-dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Real globe (TomTom Orbis basemap via MapLibre) ─────────────── */
/* The container is a square anchored so its CENTRE sits on the viewport's
   right edge. MapLibre paints a real sphere inside that container, so
   half the globe falls offscreen naturally — without us clipping the
   map to a circle (which would just give a flat mercator on a disc). */
function GlobeMap({ theme }: { theme: Theme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  // Start the camera over North America (lon ≈ -90°) so the demo
  // doesn't open on the middle of the Atlantic.
  const lonRef       = useRef(-90);
  const rafRef       = useRef(0);
  const themeRef     = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  // Reads --map-space-deep / --map-space-horizon from CSS so the sky
  // re-paints whenever the theme toggles. Also re-applies projection
  // + strips every label layer (setStyle wipes both).
  const applyGlobeChrome = (m: any) => {
    const root = getComputedStyle(document.documentElement);
    const deep    = root.getPropertyValue("--map-space-deep").trim()    || "#0C1422";
    const horizon = root.getPropertyValue("--map-space-horizon").trim() || "#3A6BA3";
    try {
      m.setSky?.({
        "sky-color":         deep,
        "sky-horizon-blend": 0.65,
        "horizon-color":     horizon,
        "horizon-fog-blend": 0.5,
        "fog-color":         deep,
        "fog-ground-blend":  0.6,
        "atmosphere-blend":  0.85,
      });
    } catch {}
    try { m.setProjection?.({ type: "globe" }); } catch {}
    // Hide every text/icon layer — we want a clean texture, no labels.
    try {
      const style = m.getStyle?.();
      (style?.layers || []).forEach((l: any) => {
        if (l.type === "symbol") {
          try { m.setLayoutProperty(l.id, "visibility", "none"); } catch {}
        }
      });
    } catch {}
  };

  useEffect(() => {
    if (!TOMTOM_API_KEY || !containerRef.current) return;

    // Force the dark Orbis style in both themes — the dark surface
    // anchors the sky atmosphere consistently and reads cleanly as a
    // texture under the wireframe in either theme.
    const map = new TomTomMap({
      key: TOMTOM_API_KEY,
      style: "standardDark",
      language: "en-GB",
      mapLibre: {
        container: containerRef.current,
        center: [0, 0],
        zoom: 0,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        interactive: false,
        fadeDuration: 220,
        projection: { type: "globe" },
      },
    });
    mapRef.current = map;

    const m = map.mapLibreMap;

    // Drive zoom so the rendered sphere's VISIBLE limb matches the
    // wireframe horizon circle. MapLibre's globe projection isn't ortho
    // — project() distances vary non-linearly with longitude offset, so
    // sampling at the limb (89° from the current camera) is the only
    // stable way to measure the actual on-screen sphere radius. The
    // previous code measured project([90,0])-project([0,0]) regardless
    // of camera rotation, which gave bogus values once the animation
    // tick rotated the camera off [0,0].
    const syncToViewport = () => {
      if (!m) return;
      const vmin = Math.min(window.innerWidth, window.innerHeight);
      const target = vmin * 0.50;
      if (!isFinite(target) || target < 1) return;
      try {
        m.resize();
        for (let i = 0; i < 8; i++) {
          const center = m.getCenter();
          const cP = m.project([center.lng, 0]);
          const limbP = m.project([center.lng + 89, 0]);
          const actual = Math.hypot(limbP.x - cP.x, limbP.y - cP.y);
          if (!isFinite(actual) || actual <= 0) break;
          const err = (actual - target) / target;
          if (Math.abs(err) < 0.003) break;
          const next = m.getZoom() + Math.log2(target / actual);
          m.setZoom(Math.max(-2, Math.min(6, next)));
        }
      } catch {}
    };

    m?.once?.("load", () => {
      applyGlobeChrome(m);
      syncToViewport();
    });
    // Re-apply on every style swap (setStyle wipes sky/projection/labels).
    m?.on?.("styledata", () => applyGlobeChrome(m));

    // Synchronous resize handler — computation is one log2, safe to run
    // on every event so the globe tracks the wireframe in lock-step.
    const onResize = () => syncToViewport();
    window.addEventListener("resize", onResize);

    // Slow longitude drift — same tempo as the wireframe (3°/s),
    // latitude 0 to match the wireframe's equator-centred view.
    let last = 0;
    const tick = (ts: number) => {
      if (last) {
        lonRef.current = (lonRef.current + (ts - last) * 0.003) % 360;
        const lon = ((lonRef.current + 180) % 360) - 180;
        try { m?.setCenter([lon, 0]); } catch {}
      }
      last = ts;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      try { m?.remove?.(); } catch {}
      try { map.remove?.(); } catch {}
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No style swap on theme change — both themes share standardDark.

  if (!TOMTOM_API_KEY) return null;
  return <div ref={containerRef} className="globe-map" aria-hidden="true" />;
}

/* ─── Globe grid (canvas, orthographic projection) ───────────────── */
function GlobeGrid({ theme }: { theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Start the wireframe at the same longitude as the real globe so they
  // stay in lockstep. -90° puts North America at centre on first frame.
  const rotRef    = useRef(-90);
  const rafRef    = useRef(0);
  const themeRef  = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth, h = parent.clientHeight;
      canvas.width  = w * dpr;  canvas.height = h * dpr;
      canvas.style.width  = `${w}px`; canvas.style.height = `${h}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let last = 0;

    const tick = (ts: number) => {
      if (last) rotRef.current = (rotRef.current + (ts - last) * 0.003) % 360;
      last = ts;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr, H = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      // Wireframe always uses the dark palette: when the real globe is
      // loaded it sits behind us and is always dark; when there's no
      // API key the page background falls back to dark anyway in dark
      // theme and the wireframe vanishes harmlessly in light theme.
      const hasRealGlobe = !!TOMTOM_API_KEY;
      const dark = hasRealGlobe ? true : themeRef.current === 'dark';

      // Globe centre: offscreen right (matches Figma node 257:16260).
      // Centre at 50vw + 35vmin, 50vh. Radius = 35vmin.
      const vmin = Math.min(W, H);
      // On narrow viewports (≤640px), stack the layout: globe centred
      // at the BOTTOM of the screen. On wider, anchor to right edge.
      // Centre must match the CSS --globe-cx / --globe-cy vars exactly,
      // otherwise the wireframe drifts off the real-globe sphere.
      const narrow = W <= 840;
      const cx   = narrow ? W * 0.5 : W;
      const cy   = narrow ? H * 1.10 : H * 0.5;
      // Single source of truth — same formula as syncToViewport and the
      // CSS --globe-r var. Pure vmin (no pixel clamp) so the wireframe,
      // MapLibre sphere, and the orbit rings all scale at the exact
      // same rate on resize. The old pixel clamp was the cause of the
      // globe "growing faster than the orbits" feel on window resize.
      const R    = vmin * 0.50;
      const lon0 = (rotRef.current * Math.PI) / 180;

      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

      // Soft sphere shading
      const sg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.05, cx, cy, R);
      if (dark) {
        sg.addColorStop(0,   'rgba(40,60,110,0.55)');
        sg.addColorStop(0.6, 'rgba(14,22,52,0.35)');
        sg.addColorStop(1,   'rgba(4,8,22,0.10)');
      } else {
        sg.addColorStop(0,   'rgba(210,230,255,0.55)');
        sg.addColorStop(0.6, 'rgba(160,190,235,0.30)');
        sg.addColorStop(1,   'rgba(110,150,210,0.10)');
      }
      ctx.fillStyle = sg; ctx.fill();

      const lineRgb = dark ? '160,200,255' : '60,100,180';
      const lc = (a: number) => `rgba(${lineRgb},${a})`;

      // Latitude lines every 5°
      for (let latDeg = -90; latDeg <= 90; latDeg += 5) {
        const φ   = (latDeg * Math.PI) / 180;
        const eq  = latDeg === 0;
        const maj = latDeg % 30 === 0;
        const mid = latDeg % 10 === 0;
        ctx.beginPath();
        ctx.strokeStyle = lc(eq ? (dark ? 0.55 : 0.40) : maj ? (dark ? 0.30 : 0.22) : mid ? (dark ? 0.16 : 0.12) : (dark ? 0.08 : 0.06));
        ctx.lineWidth   = eq ? 0.85 : maj ? 0.52 : mid ? 0.32 : 0.20;
        let started = false;
        for (let d = -180; d <= 180; d += 0.8) {
          const λ = (d * Math.PI) / 180 + lon0;
          if (Math.cos(λ) < 0) { started = false; continue; }
          const x = cx + R * Math.cos(φ) * Math.sin(λ);
          const y = cy - R * Math.sin(φ);
          started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
        }
        ctx.stroke();
      }

      // Longitude lines every 5°
      for (let lonDeg = 0; lonDeg < 360; lonDeg += 5) {
        const λ   = (lonDeg * Math.PI) / 180 + lon0;
        if (Math.cos(λ) <= 0) continue;
        const maj = lonDeg % 30 === 0;
        const mid = lonDeg % 10 === 0;
        ctx.beginPath();
        ctx.strokeStyle = lc(maj ? (dark ? 0.28 : 0.20) : mid ? (dark ? 0.14 : 0.10) : (dark ? 0.07 : 0.05));
        ctx.lineWidth   = maj ? 0.50 : mid ? 0.30 : 0.18;
        for (let d = -90; d <= 90; d += 0.8) {
          const φ = (d * Math.PI) / 180;
          const x = cx + R * Math.cos(φ) * Math.sin(λ);
          const y = cy - R * Math.sin(φ);
          d === -90 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.restore();

      // Atmosphere halo
      const hg = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.12);
      hg.addColorStop(0, dark ? 'rgba(80,140,255,0.20)' : 'rgba(60,110,200,0.14)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.fillStyle = hg; ctx.fill();

      // Horizon limb
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? 'rgba(140,190,255,0.40)' : 'rgba(60,100,180,0.30)';
      ctx.lineWidth = 1.0; ctx.stroke();

      ctx.restore();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className="globe-canvas" aria-hidden="true" />;
}


/* ─── Zoom scene ─────────────────────────────────────────────────── */
function ZoomScene({
  layer, visible, onClose,
}: {
  layer: Layer | null;
  visible: boolean;
  onClose: () => void;
}) {
  // Translate vertical mouse-wheel into horizontal scroll on the cards
  // row, but ONLY when the cards are in carousel mode (i.e. they have
  // horizontal overflow). In grid mode there's no horizontal scroll to
  // drive, so we no-op and let the page's vertical scroll behave normally.
  const cardsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = cardsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const canScrollX = el.scrollWidth > el.clientWidth + 1;
      if (!canScrollX) return;
      // Honour the larger axis so trackpads (which usually send the
      // intended horizontal component already) still work naturally.
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layer?.id]);

  if (!layer) {
    return <div className={`zoom-scene ${visible ? "is-visible" : "is-hidden"}`} />;
  }

  const cards = layer.items.slice(0, 3);
  // Hide kickers when every card in the layer would show the same value
  // (e.g. all "AI" in MCP, all "SDK" in SDKs) — repetition adds noise.
  const showKickers = new Set(cards.map(c => c.kicker)).size > 1;

  return (
    <div className={`zoom-scene tone-${layer.tone} ${visible ? "is-visible" : "is-hidden"}`}>
      <div className="zoom-ambient" aria-hidden="true" />
      <div className="zoom-globe" aria-hidden="true" />

      <button className="return-pill" onClick={onClose}>
        <svg width="14" height="12" viewBox="0 0 16 14" fill="currentColor" aria-hidden="true">
          <path d="M4.78563 5.63379L8.65165 1.76777L6.88388 0L0 6.88388L6.88388 13.7678L8.65165 12L4.78544 8.13379H15.7677V5.63379H4.78563Z" />
        </svg>
        <span>Return</span>
      </button>

      <header className="zoom-header">
        <h2 className="zoom-title">{layer.zoomTitle}</h2>
        <p className="zoom-lede">
          {layer.name} sits in the {layer.tone === "neutral" ? "core" : layer.tone === "positive" ? "build" : layer.tone === "alternative" ? "agentic" : "data"} layer of the TomTom platform. Pick a starting point below — every product ships with docs, samples and a live playground.
        </p>
      </header>

      <div className="zoom-body">
        <div className="zoom-cards" ref={cardsRef}>
          {cards.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="z-card"
              style={{ animationDelay: `${0.18 + i * 0.08}s` }}
              onClick={(e) => e.preventDefault()}
              aria-label={`Open ${item.label}`}
            >
              <CardThumb id={item.id} />
              <div className="z-card-body">
                {showKickers && item.kicker && (
                  <p className="z-card-kicker">{item.kicker}</p>
                )}
                <p className="z-card-title">{item.label}</p>
                <p className="z-card-desc">{item.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="zoom-ctas">
        <a className="cta cta-primary" href="#" onClick={(e) => e.preventDefault()}>
          <span>Launch the demo</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M5.02441 0V1.77734H1.77734V14.2227H14.2227V11.0391H16V14.2227C15.9998 15.2028 15.2028 15.9998 14.2227 16H1.77734C0.797242 15.9998 0.000234661 15.2028 0 14.2227V1.77734C0.000235242 0.797243 0.797243 0.000235242 1.77734 0H5.02441Z" />
            <path d="M15.9971 6.98535H13.9043V3.5918L7.78223 9.71387L6.30273 8.23438L12.4248 2.1123H9.03125V0.0195312H15.9971V6.98535Z" />
          </svg>
        </a>
        <a className="cta cta-secondary" href="#" onClick={(e) => e.preventDefault()}>
          <span>TomTom Docs</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M5.02441 0V1.77734H1.77734V14.2227H14.2227V11.0391H16V14.2227C15.9998 15.2028 15.2028 15.9998 14.2227 16H1.77734C0.797242 15.9998 0.000234661 15.2028 0 14.2227V1.77734C0.000235242 0.797243 0.797243 0.000235242 1.77734 0H5.02441Z" />
            <path d="M15.9971 6.98535H13.9043V3.5918L7.78223 9.71387L6.30273 8.23438L12.4248 2.1123H9.03125V0.0195312H15.9971V6.98535Z" />
          </svg>
        </a>
      </div>
    </div>
  );
}

/* ─── Theme toggle ───────────────────────────────────────────────── */
/* Segmented two-icon switch — matches Figma node 257:16425 (switcher). */
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const setTheme = (t: Theme) => { if (t !== theme) onToggle(); };
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      <button
        type="button"
        role="radio"
        aria-checked={theme === "light"}
        className={`theme-seg ${theme === "light" ? "is-active" : ""}`}
        onClick={() => setTheme("light")}
        aria-label="Light theme"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          {[0,1,2,3,4,5,6,7].map(j => {
            const a = (j * 45) * Math.PI / 180;
            return <line key={j}
              x1={8+Math.cos(a)*5} y1={8+Math.sin(a)*5}
              x2={8+Math.cos(a)*7} y2={8+Math.sin(a)*7}
              stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />;
          })}
        </svg>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={theme === "dark"}
        className={`theme-seg ${theme === "dark" ? "is-active" : ""}`}
        onClick={() => setTheme("dark")}
        aria-label="Dark theme"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M12 9.5A5 5 0 0 1 6.5 4c0-.7.15-1.36.4-1.95A6 6 0 1 0 13.95 9.6c-.6.25-1.25.4-1.95.4z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
