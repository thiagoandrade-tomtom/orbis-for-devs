import { useEffect, useRef, useState } from "react";
import { TomTomMap, TrafficFlowModule } from "@tomtom-org/maps-sdk/map";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { calculateRoute } from "@tomtom-org/maps-sdk/services";
import landCloud from "./landCloud.json";
import maplibregl from "maplibre-gl";

const TOMTOM_API_KEY: string = (import.meta as any).env?.VITE_TOMTOM_API_KEY ?? "";
if (TOMTOM_API_KEY) {
  TomTomConfig.instance.put({
    apiKey: TOMTOM_API_KEY,
    apiVersion: 1,
    commonBaseURL: "https://api.tomtom.com",
  });
}

/* ─── Pillars ────────────────────────────────────────────────────── */
/* Ordered from raw → ready-made. Each pillar owns a real Orbis style
   (bare geometry, the real world in full detail, the ready preset) plus a canvas
   overlay that tells the granularity story: loose points → services
   calling each other → a finished, working experience. Names are
   working titles — edit here. */
type Mode = "data" | "intel" | "build";

interface Pillar {
  mode: Mode;
  kicker: string;
  title: string;
  /** One short line. The products live in it, not in extra tags. */
  description: string;
  cta: string;
  style: string;
  /** Which symbol layers stay visible (matched against layer ids). */
  labels: RegExp | null;
}

const PILLARS: Pillar[] = [
  {
    mode: "data",
    kicker: "Encode",
    title: "Data",
    description: "Map data, embeddings and ontology to train your models.",
    cta: "Explore data",
    style: "monoDark",
    labels: null,
  },
  {
    mode: "intel",
    kicker: "Ground",
    title: "Intelligence",
    description: "APIs and MCP servers that ground agents in the real world.",
    cta: "Browse APIs",
    // Satellite: the real world in full detail, i.e. what the services
    // ground answers in. Kept label-free and dimmed so the calls lead.
    style: "satellite",
    labels: null,
  },
  {
    mode: "build",
    kicker: "Build",
    title: "Studio",
    description: "SDKs, tools and agents with rich, ready-made presets.",
    cta: "Start building",
    style: "standardDark",
    // The full preset: country + major city names, the way the SDK ships.
    labels: /country|capital|city|place/i,
  },
];

const MODES: Mode[] = PILLARS.map((p) => p.mode);
/* Graticule spacing in degrees, the same "tile" size in every pillar:
   only its strength changes, never its proportions. */
const GRID_STEP = 10;
const BUILD = MODES.indexOf("build");
const CYCLE_MS = 5000;
const ROT_SPEED = 0.003; // degrees per ms — same tempo as the hero globe
/* Where the camera parks per pillar (Data keeps spinning). rot is the
   negated centre longitude; lat tilts north so the region drops from
   the crown (under the header) into the middle of the visible cap.
   Intelligence parks over New York before diving in, Studio over the
   European routes. */
/* While spinning (Data), the camera stays tilted north so the visible
   cap reads from Europe / the northern landmasses rather than Africa. */
const SPIN_LAT = 25;
const PARK: Partial<Record<Mode, { rot: number; lat: number }>> = {
  intel: { rot: 74, lat: 20 },
  build: { rot: -10, lat: 25 },
};

/* Intelligence keeps the globe at orbit scale and opens a lens on one
   city with live traffic on, the way the map looks with the traffic
   layer switched on. Orbis traffic-flow tiles only exist from zoom 6,
   so the lens is a second, street-level map rather than the globe. */
const CITY = { name: "New York", lngLat: [-73.98, 40.74] as [number, number], zoom: 11.2 };

/* Map-anchored tooltips: one component for every pillar, positioned by
   the overlay each frame and joined to their point by a leader line.
   They live in their own layer above the canvas, never inside a map. */
type TipIcon = "traffic" | "modules" | "ai";
interface Tip {
  id: string;
  mode: Mode;
  lngLat: [number, number];
  side: "left" | "right";
  icon: TipIcon;
  kicker: string;
  title: string;
  line: string;
  /** Point already has a map marker (a route stop): no extra dot. */
  onStop?: boolean;
}
const TIPS: Tip[] = [
  { id: "traffic", mode: "intel", lngLat: CITY.lngLat, side: "left", icon: "traffic",
    kicker: "Traffic API · live", title: CITY.name, line: "Reading traffic…" },
  // Studio tips hang off each route's origin stop and point away from
  // each other, so markers, leaders and cards never stack up.
  { id: "eta", mode: "build", lngLat: [4.90, 52.37], side: "left", icon: "modules", onStop: true,
    kicker: "Routing SDK", title: "Amsterdam → Barcelona", line: "Fastest route" },
  { id: "agent", mode: "build", lngLat: [13.40, 52.52], side: "right", icon: "ai", onStop: true,
    kicker: "Agent", title: "“Plan Berlin to Milan with fast chargers.”", line: "Done. 1 stop, 350 kW." },
];
const LEADER = 28; // px from the anchor dot to the tooltip / lens edge

/** Live text for a tooltip's last line (route ETA, traffic share). */
function setTipLine(id: string, text: string) {
  document.querySelectorAll(`[data-tip="${id}"] .tip-line`).forEach((el) => { el.textContent = text; });
}

/* Service endpoints for the "Ground" arcs — calls hop between them.
   A few carry the name of the service answering there. */
const NODES: { lat: number; lon: number; label?: string }[] = [
  { lat: 52.4, lon: 4.9, label: "Routing API" }, { lat: 40.7, lon: -74, label: "Search API" },
  { lat: 37.8, lon: -122.4, label: "MCP server" }, { lat: -23.5, lon: -46.6 },
  { lat: 35.7, lon: 139.7, label: "Traffic API" }, { lat: 1.35, lon: 103.8 },
  { lat: 28.6, lon: 77.2, label: "Geocoding API" }, { lat: 51.5, lon: -0.1 },
  { lat: -33.9, lon: 151.2 }, { lat: 25.2, lon: 55.3 }, { lat: 19.4, lon: -99.1 },
  { lat: 31.2, lon: 121.5 }, { lat: 6.5, lon: 3.4, label: "EV charging API" }, { lat: 55.8, lon: 37.6 },
];
const ARCS: [number, number][] = [
  [0, 1], [0, 7], [0, 6], [0, 13], [1, 2], [1, 3], [1, 10], [2, 4], [4, 11],
  [4, 5], [5, 8], [6, 9], [9, 0], [3, 12], [12, 7], [11, 5], [7, 1],
];

/* Studio: real routes calculated by the Routing API on load, drawn on
   the map itself (so they sit on the roads, not over the sea). */
const ROUTES: { id: string; from: string; to: string; locations: [number, number][] }[] = [
  { id: "ams-bcn", from: "Amsterdam", to: "Barcelona", locations: [[4.90, 52.37], [2.35, 48.86], [2.17, 41.39]] },
  { id: "ber-mil", from: "Berlin", to: "Milan", locations: [[13.40, 52.52], [11.58, 48.14], [9.19, 45.46]] },
];
/* Charging stop for the agent's Berlin–Milan plan, as a fraction of the
   way along the real route geometry so it always sits on the line. One
   stop: at globe scale the route is ~55px tall and two crowd it. */
const CHARGER_AT = [0.5];

/* Deterministic PRNG so the point cloud is stable across renders. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/* Land-only point cloud, prebuilt from Natural Earth 1:50m land (lat/lon
   ×10): an even sampling of every landmass plus denser clusters around
   major metros. Nothing sits on water. */
interface CloudPt { lat: number; lon: number; a: number; s: number; hot: boolean; phase: number }
const CLOUD: CloudPt[] = (() => {
  const r = rng(7);
  const out: CloudPt[] = [];
  const add = (arr: number[], hot: boolean) => {
    for (let i = 0; i < arr.length; i += 2) {
      out.push({
        lat: arr[i] / 10, lon: arr[i + 1] / 10, hot,
        a: hot ? 0.55 + 0.45 * r() : 0.22 + 0.25 * r(),
        s: hot ? 0.8 + 0.8 * r() : 0.55 + 0.35 * r(),
        phase: r() * Math.PI * 2,
      });
    }
  };
  add(landCloud.base, false);
  add(landCloud.hot, true);
  return out;
})();

/* ─── Geometry ───────────────────────────────────────────────────── */
interface Geo { cx: number; cy: number; R: number; W: number; H: number }

/* Stage geometry — single source of truth for the canvas overlay and
   the MapLibre containers. Measured from the real layout: the globe's
   crown sits just under the header and it sinks behind the cards, so
   the visible cap is always the gap between the two — at any viewport
   it neither vanishes behind the cards nor swallows the banner. */
const CAP = 0.78;      // visible cap height as a fraction of R
const SINK = 28;       // px the globe dips behind the cards' top edge
function computeGeo(el: HTMLElement): Geo {
  const W = el.clientWidth, H = el.clientHeight;
  const box = el.getBoundingClientRect();
  const head = el.querySelector(".pillars-head")?.getBoundingClientRect();
  const cards = el.querySelector(".pillars-row")?.getBoundingClientRect();
  const top = (head ? head.bottom - box.top : H * 0.25) + 40;
  const bottom = (cards ? cards.top - box.top : H * 0.6) + SINK;
  const band = Math.max(bottom - top, 80);
  // Width cap keeps it from turning into a wall on short-and-wide screens.
  const R = Math.min(band / CAP, W * (W <= 720 ? 0.7 : 0.34));
  return { W, H, R, cx: W / 2, cy: top + R };
}

interface Pt { x: number; y: number; z: number }
type Projector = (lat: number, lon: number, lift?: number) => Pt;

/** Orthographic projection centred on (lat0, -lon0), degrees. */
function ortho(lat: number, lon: number, lon0: number, lat0: number) {
  const φ = (lat * Math.PI) / 180, λ = ((lon + lon0) * Math.PI) / 180, φ0 = (lat0 * Math.PI) / 180;
  return {
    x: Math.cos(φ) * Math.sin(λ),
    y: Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ),
    z: Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ),
  };
}

/* Screen projection. When a basemap is up we ask MapLibre where a
   lat/lon actually lands — its globe uses a perspective camera, so a
   pure orthographic guess drifts towards the limb (pins ended up in
   the sea). Orthographic stays as the fallback and for the
   front/back-face test. */
function makeProjector(g: Geo, lon0: number, lat0: number, map: any): Projector {
  const offX = g.cx - g.R * 1.2, offY = g.cy - g.R * 1.2;
  return (lat, lon, lift = 0) => {
    const o = ortho(lat, lon, lon0, lat0);
    const z = o.z;
    let x: number, y: number;
    if (map) {
      const p = map.project([lon, lat]);
      x = p.x + offX; y = p.y + offY;
    } else {
      x = g.cx + g.R * o.x;
      y = g.cy - g.R * o.y;
    }
    if (lift) { x = g.cx + (x - g.cx) * (1 + lift); y = g.cy + (y - g.cy) * (1 + lift); }
    return { x, y, z };
  };
}

/* Spherical interpolation between two lat/lon points. */
function slerp(a: [number, number], b: [number, number], t: number): [number, number] {
  const toV = ([lat, lon]: [number, number]) => {
    const φ = (lat * Math.PI) / 180, λ = (lon * Math.PI) / 180;
    return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
  };
  const p = toV(a), q = toV(b);
  const d = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  if (d < 1e-6) return a;
  const s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d);
  const v = [p[0] * s1 + q[0] * s2, p[1] * s1 + q[1] * s2, p[2] * s1 + q[2] * s2];
  return [(Math.asin(v[2]) * 180) / Math.PI, (Math.atan2(v[1], v[0]) * 180) / Math.PI];
}

/* One accent for every overlay — the pillars differ by structure, not hue. */
const ACCENT = "125,190,255";

/* House arrow, shared with the rest of the site. */
function Arrow() {
  return (
    <svg className="pillar-arrow" width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
      <path d="M12 5.00026L7.05025 0L5.63604 1.42857L8.1692 3.9901H0V6.01041H8.1692L5.63604 8.57143L7.05025 10L12 5.00026Z" fillRule="evenodd" clipRule="evenodd" fill="currentColor" />
    </svg>
  );
}

/** Signed shortest angular distance a → b, degrees. */
const angDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/* ─── Component ──────────────────────────────────────────────────── */
export default function PillarsBanner() {
  const [active, setActive] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const sectionRef = useRef<HTMLElement>(null);

  // Reveal gate: the globe stage stays hidden until the fonts have settled
  // (so the header can't reflow and shift the globe) and the first map is
  // fitted and painted (so its sphere never pops from zoom 0 to size).
  const [ready, setReady] = useState(false);
  const [mapPainted, setMapPainted] = useState(!TOMTOM_API_KEY);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    if (document.fonts) document.fonts.ready.then(() => live && setFontsReady(true));
    else setFontsReady(true);
    // Never hold the banner hostage to a slow network.
    const t = window.setTimeout(() => live && setReady(true), 6000);
    return () => { live = false; window.clearTimeout(t); };
  }, []);
  useEffect(() => { if (fontsReady && mapPainted) setReady(true); }, [fontsReady, mapPainted]);

  // Respect reduced motion: no spin, no shimmer, no auto-cycle.
  const reducedRef = useRef(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => { reducedRef.current = mq.matches; setReduced(mq.matches); };
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Only animate while the banner is on screen and the tab is visible.
  const visibleRef = useRef(true);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const sync = (v: boolean) => { visibleRef.current = v && !document.hidden; setOnScreen(visibleRef.current); };
    let inView = true;
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(inView); });
    io.observe(el);
    const onVis = () => sync(inView);
    document.addEventListener("visibilitychange", onVis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Idle auto-cycle so the banner tells the whole story on its own (and
  // on touch devices, where there's no hover). Starts once the globe is
  // revealed, pauses off screen, stops once someone engages.
  const cycling = ready && onScreen && !interacted && !reduced;
  useEffect(() => {
    if (!cycling) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % PILLARS.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [cycling]);

  const [geo, setGeo] = useState<Geo | null>(null);
  const rotRef = useRef(-12); // start with Europe facing the viewer
  // Loaded MapLibre instances, shared so the overlay can project with
  // the real camera and drive it from a single RAF.
  const mapsRef = useRef<any[]>([]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const fit = () => setGeo(computeGeo(el));
    fit();
    // Header and cards reflow independently (fonts, wrapping), so watch them too.
    const ro = new ResizeObserver(fit);
    [el, el.querySelector(".pillars-head"), el.querySelector(".pillars-row")]
      .forEach((n) => n && ro.observe(n));
    return () => ro.disconnect();
  }, []);

  const pick = (i: number) => { setInteracted(true); setActive(i); };

  return (
    <section
      ref={sectionRef}
      className="pillars"
      data-mode={PILLARS[active].mode}
      aria-label="TomTom for developers"
    >
      <div className={`pillars-stage${ready ? " is-ready" : ""}`}>
        {geo && <PillarGlobes geo={geo} active={active} rotRef={rotRef} mapsRef={mapsRef} onPainted={() => setMapPainted(true)} />}
        {geo && <PillarOverlay geo={geo} activeRef={activeRef} rotRef={rotRef} mapsRef={mapsRef} visibleRef={visibleRef} reducedRef={reducedRef} />}
        {geo && <PillarTips geo={geo} />}
      </div>

      <header className="pillars-head">
        <h2 className="pillars-title">One map. Every layer.</h2>
        <p className="pillars-sub">From raw data to ready-made experiences. Pick the depth you build at.</p>
      </header>

      <div className="pillars-cols" role="tablist" aria-label="Product segments">
        <div className="pillars-scale" aria-hidden="true">
          <span>Granular</span>
          <span className="pillars-scale-line" />
          <span>Ready to use</span>
        </div>
        <div className="pillars-row">
        {PILLARS.map((p, i) => (
          <button
            key={p.mode}
            role="tab"
            aria-selected={i === active}
            className={`pillar${i === active ? " is-active" : ""}`}
            onMouseEnter={() => pick(i)}
            onFocus={() => pick(i)}
            onClick={() => pick(i)}
          >
            <span className="pillar-kicker">{p.kicker}</span>
            <span className="pillar-title">{p.title}</span>
            <span className="pillar-desc">{p.description}</span>
            <span className="pillar-cta">{p.cta}<Arrow /></span>
            {cycling && i === active && (
              <span key={active} className="pillar-progress" style={{ animationDuration: `${CYCLE_MS}ms` }} />
            )}
          </button>
        ))}
        </div>
      </div>
    </section>
  );
}

/* Studio's preset keeps its labels, smaller: web labels read best at 70%. */
const LABEL_SCALE = 0.7;

/* Scale a style's text-size by k. Zoom curves must stay the outermost
   expression in MapLibre, so the factor goes on each output stop
   rather than wrapping the whole interpolate/step. */
function scaleSize(v: any, k: number): any {
  if (typeof v === "number") return v * k;
  if (Array.isArray(v) && (v[0] === "interpolate" || v[0] === "interpolate-hcl" || v[0] === "interpolate-lab")) {
    return [...v.slice(0, 3), ...v.slice(3).map((x: any, i: number) => (i % 2 ? scaleSize(x, k) : x))];
  }
  if (Array.isArray(v) && v[0] === "step") {
    return [v[0], v[1], scaleSize(v[2], k), ...v.slice(3).map((x: any, i: number) => (i % 2 ? scaleSize(x, k) : x))];
  }
  if (v && typeof v === "object" && Array.isArray(v.stops)) {
    return { ...v, stops: v.stops.map(([z, x]: [any, any]) => [z, scaleSize(x, k)]) };
  }
  return ["*", v, k];
}

/* Match a map's rendered sphere to radius R (px) by sampling its visible
   limb 89° south of the camera centre, valid whatever the tilt. MapLibre's
   globe isn't orthographic, so iterate rather than solve once. */
function fitGlobe(m: any, R: number) {
  try {
    m.resize();
    for (let i = 0; i < 10; i++) {
      const c = m.getCenter();
      const a = m.project([c.lng, c.lat]), b = m.project([c.lng, c.lat - 89]);
      const actual = Math.hypot(b.x - a.x, b.y - a.y);
      if (!isFinite(actual) || actual <= 0) break;
      if (Math.abs(actual - R) / R < 0.002) break;
      m.setZoom(Math.max(-2, Math.min(6, m.getZoom() + Math.log2(R / actual))));
    }
    // MapLibre scales the globe by 1/cos(centre latitude), so store the
    // equator-equivalent zoom; the camera re-derives it for any tilt.
    m.__z0 = m.getZoom() - Math.log2(Math.cos((m.getCenter().lat * Math.PI) / 180));
  } catch {}
}
/** Zoom that keeps the sphere at its fitted radius with the camera at lat. */
const zoomAt = (m: any, lat: number) => m.__z0 + Math.log2(Math.cos((lat * Math.PI) / 180));

/* ─── Real globes — one Orbis style per pillar, cross-faded ──────── */
/* Three stacked MapLibre instances instead of one map + setStyle():
   a style swap reloads every tile and flashes, which kills the hover.
   Stacking costs three GL contexts but makes the switch an opacity
   transition. The camera is driven by the overlay's RAF. */
function PillarGlobes({ geo, active, rotRef, mapsRef, onPainted }: {
  geo: Geo;
  active: number;
  rotRef: React.MutableRefObject<number>;
  mapsRef: React.MutableRefObject<any[]>;
  /** First map fitted and its first frame of tiles rendered. */
  onPainted: () => void;
}) {
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const all = useRef<any[]>([]);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const activeRef = useRef(active);
  activeRef.current = active;
  // Route draw-on progress, restarted every time Studio becomes active.
  const routeAnim = useRef({ t: 0, start: 0 });
  const routeCoords = useRef<Record<string, [number, number][]>>({});

  useEffect(() => {
    if (active === BUILD) routeAnim.current = { t: 0, start: performance.now() };
  }, [active]);

  useEffect(() => {
    if (!TOMTOM_API_KEY) return;
    let raf = 0;
    let alive = true;

    const chrome = (m: any, labels: RegExp | null) => {
      try { m.setProjection?.({ type: "globe" }); } catch {}
      try {
        m.setSky?.({
          "sky-color": "#0C0C12", "sky-horizon-blend": 0.6, "horizon-color": "#2D5C99",
          "horizon-fog-blend": 0.5, "fog-color": "#0C0C12", "fog-ground-blend": 0.6, "atmosphere-blend": 0.8,
        });
      } catch {}
      try {
        (m.getStyle?.()?.layers || []).forEach((l: any) => {
          if (l.type !== "symbol" || l.id.startsWith("studio-")) return;
          const keep = !!labels && labels.test(l.id);
          try { m.setLayoutProperty(l.id, "visibility", keep ? "visible" : "none"); } catch {}
          // Kept labels run at LABEL_SCALE of the style's size, once per layer
          // (styledata fires repeatedly; scaling again would compound).
          m.__scaled ??= new Set<string>();
          if (keep && !m.__scaled.has(l.id)) {
            m.__scaled.add(l.id);
            try {
              const size = m.getLayoutProperty(l.id, "text-size");
              if (size !== undefined) m.setLayoutProperty(l.id, "text-size", scaleSize(size, LABEL_SCALE));
            } catch {}
          }
        });
      } catch {}
    };

    PILLARS.forEach((p, i) => {
      const container = refs.current[i];
      if (!container) return;
      const map = new TomTomMap({
        style: p.style as any,
        language: "en-GB",
        mapLibre: {
          container,
          center: [-rotRef.current, SPIN_LAT],
          zoom: 0,
          // Small (mobile) globes need zoom < 0 to match the overlay radius.
          minZoom: -2,
          interactive: false,
          fadeDuration: 0,
          ...({ attributionControl: false, projection: { type: "globe" } } as any),
        },
      });
      const m: any = map.mapLibreMap;
      all.current[i] = m;
      m?.once?.("load", () => {
        chrome(m, p.labels);
        fitGlobe(m, geoRef.current.R);
        mapsRef.current[i] = m;
        // Dev-only handle for checking the sphere fit from the console.
        if ((import.meta as any).env?.DEV) (window as any).__pillarsMaps = mapsRef.current;
        if (p.mode === "build") addStudio(m).catch(() => {});
        // The banner opens on the first pillar: reveal once it has painted.
        if (i === 0) m.once("idle", () => onPaintedRef.current());
      });
      m?.on?.("styledata", () => chrome(m, p.labels));
    });

    /* Studio layer: real routes + charging stops + an ETA card and an
       agent exchange, all anchored by MapLibre so they stay glued to
       the ground and hide behind the globe's limb. */
    async function addStudio(m: any) {
      m.addSource("studio-routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "studio-routes-casing", type: "line", source: "studio-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0C0C12", "line-width": 6, "line-opacity": 0.6 },
      });
      m.addLayer({
        id: "studio-routes-line", type: "line", source: "studio-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": `rgb(${ACCENT})`, "line-width": 3 },
      });

      const results = await Promise.all(ROUTES.map(async (r) => {
        try {
          const res: any = await calculateRoute({ locations: r.locations } as any);
          const f = res?.features?.[0];
          const coords: [number, number][] = f?.geometry?.coordinates ?? r.locations;
          const summary = f?.properties?.summary ?? f?.summary;
          // Thin the polyline — the draw-on animation re-slices it per frame.
          const step = Math.max(1, Math.floor(coords.length / 400));
          return { r, coords: coords.filter((_, k) => k % step === 0 || k === coords.length - 1), summary };
        } catch {
          return { r, coords: r.locations, summary: null };
        }
      }));
      if (!alive) return;
      results.forEach(({ r, coords }) => { routeCoords.current[r.id] = coords; });

      const marker = (el: HTMLElement, lngLat: [number, number], anchor: string, offset: [number, number] = [0, 0]) =>
        new maplibregl.Marker({ element: el, anchor: anchor as any, offset, opacityWhenCovered: "0" } as any)
          .setLngLat(lngLat).addTo(m);

      // Origin / destination dots
      results.forEach(({ r }) => {
        [r.locations[0], r.locations[r.locations.length - 1]].forEach((ll, k) => {
          const el = document.createElement("div");
          el.className = `studio-stop${k ? " is-end" : ""}`;
          marker(el, ll, "center");
        });
      });
      const plan = results[1].coords;
      CHARGER_AT.map((f) => plan[Math.floor((plan.length - 1) * f)]).forEach((ll) => {
        if (!ll) return;
        const el = document.createElement("div");
        el.className = "studio-charger";
        el.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 1 3 9h4l-1 6 6-8H8z"/></svg>`;
        marker(el, ll, "center");
      });

      // Real ETA into the Routing SDK tooltip.
      const main = results[0];
      if (main.summary) {
        const t = main.summary.travelTimeInSeconds;
        const km = Math.round(main.summary.lengthInMeters / 1000).toLocaleString("en");
        setTipLine("eta", `${Math.floor(t / 3600)} h ${String(Math.round((t % 3600) / 60)).padStart(2, "0")} min · ${km} km`);
      }
    }

    // Draw-on animation for the Studio routes.
    const tick = (ts: number) => {
      const m = mapsRef.current[BUILD];
      const src = m?.getSource?.("studio-routes");
      if (src && Object.keys(routeCoords.current).length) {
        const a = routeAnim.current;
        if (a.t < 1) {
          a.t = Math.min(1, (ts - a.start) / 1800);
          const e = 1 - Math.pow(1 - a.t, 3);
          src.setData({
            type: "FeatureCollection",
            features: Object.values(routeCoords.current).map((c) => ({
              type: "Feature", properties: {},
              geometry: { type: "LineString", coordinates: c.slice(0, Math.max(2, Math.ceil(c.length * e))) },
            })),
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      all.current.forEach((m) => { try { m?.remove?.(); } catch {} });
      all.current = [];
      mapsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit whenever the measured geometry changes. This is the only
  // resize path: a window "resize" listener fires before the new layout
  // is measured and would fit the sphere to the previous radius.
  useEffect(() => {
    all.current.forEach((m) => m && fitGlobe(m, geo.R));
  }, [geo]);

  if (!TOMTOM_API_KEY) return null;
  const size = geo.R * 2.4;
  return (
    <>
      {PILLARS.map((p, i) => (
        <div
          key={p.mode}
          ref={(el) => { refs.current[i] = el; }}
          className={`pillars-map pillars-map--${p.mode}${i === active ? " is-active" : ""}`}
          style={{ left: geo.cx - size / 2, top: geo.cy - size / 2, width: size, height: size }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/* ─── Canvas overlay — the granularity story ─────────────────────── */
function PillarOverlay({ geo, activeRef, rotRef, mapsRef, visibleRef, reducedRef }: {
  geo: Geo;
  activeRef: React.MutableRefObject<number>;
  rotRef: React.MutableRefObject<number>;
  mapsRef: React.MutableRefObject<any[]>;
  visibleRef: React.MutableRefObject<boolean>;
  reducedRef: React.MutableRefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef(geo);
  geoRef.current = geo;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = geo.W * dpr;
    canvas.height = geo.H * dpr;
    canvas.style.width = `${geo.W}px`;
    canvas.style.height = `${geo.H}px`;
  }, [geo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Per-mode visibility weights, eased toward the active pillar.
    const w: Record<Mode, number> = { data: 1, intel: 0, build: 0 };
    let raf = 0, last = 0, lat0 = SPIN_LAT;
    const section = canvas.closest(".pillars")!;
    const tipEls = () => Array.from(section.querySelectorAll<HTMLElement>(".pillars-tip"));
    const lensEl = () => section.querySelector<HTMLElement>(".pillars-lens");

    const tick = (ts: number) => {
      // Off screen or hidden tab: keep the loop alive but do no work, so
      // four GL maps and the canvas cost nothing while out of view.
      if (!visibleRef.current) { last = 0; raf = requestAnimationFrame(tick); return; }
      const dt = last ? Math.min(ts - last, 64) : 16;
      last = ts;
      const target = MODES[activeRef.current];
      const still = reducedRef.current;

      // Camera: free spin for Data; Intelligence and Studio ease onto
      // their region and hold there so the content stays readable.
      const park = PARK[target];
      const ease = 1 - Math.exp(-dt / 500);
      if (park) rotRef.current += angDiff(rotRef.current, park.rot) * ease;
      else if (!still) rotRef.current = (rotRef.current + dt * ROT_SPEED) % 360;
      lat0 += ((park?.lat ?? SPIN_LAT) - lat0) * ease;
      const lon0 = rotRef.current;
      const centerLon = ((-lon0 + 540) % 360) - 180;
      mapsRef.current.forEach((m) => {
        if (!m) return;
        try {
          if (m.__z0 === undefined) m.setCenter([centerLon, lat0]);
          else m.jumpTo({ center: [centerLon, lat0], zoom: zoomAt(m, lat0) });
        } catch {}
      });

      const k = 1 - Math.exp(-dt / 180);
      MODES.forEach((m) => { w[m] += ((m === target ? 1 : 0) - w[m]) * k; });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const g = geoRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.W, g.H);
      const map = mapsRef.current.find(Boolean) ?? null;
      const proj = makeProjector(g, lon0, lat0, map);

      // Sphere body when there's no basemap to stand on.
      if (!TOMTOM_API_KEY) {
        const sg = ctx.createRadialGradient(g.cx - g.R * 0.35, g.cy - g.R * 0.35, g.R * 0.05, g.cx, g.cy, g.R);
        sg.addColorStop(0, "rgba(40,60,110,0.55)");
        sg.addColorStop(1, "rgba(4,8,22,0.25)");
        ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); ctx.fillStyle = sg; ctx.fill();
      }

      drawGrid(ctx, proj, 0.06 + w.intel * 0.22, GRID_STEP);
      if (w.data > 0.01) drawCloud(ctx, g, proj, w.data, still ? 0 : ts);
      if (w.intel > 0.01) drawArcs(ctx, g, proj, w.intel * 0.7, ts);
      placeTips(ctx, g, proj, w, tipEls(), lensEl());

      // Rim glow instead of a hard limb line: it straddles the sphere's
      // edge, so the few px between MapLibre's limb and ours never show.
      const rim = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.94, g.cx, g.cy, g.R * 1.09);
      rim.addColorStop(0, `rgba(${ACCENT},0)`);
      rim.addColorStop(0.42, `rgba(${ACCENT},0.22)`);
      rim.addColorStop(0.5, `rgba(${ACCENT},0.32)`);
      rim.addColorStop(1, `rgba(${ACCENT},0)`);
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R * 1.09, 0, Math.PI * 2);
      ctx.fillStyle = rim; ctx.fill();

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="pillars-canvas" aria-hidden="true" />;
}

function drawGrid(ctx: CanvasRenderingContext2D, proj: Projector, alpha: number, step: number) {
  ctx.lineWidth = 0.6;
  const line = (pts: Pt[], a: number) => {
    ctx.beginPath();
    let on = false;
    pts.forEach((p) => {
      if (p.z <= 0) { on = false; return; }
      on ? ctx.lineTo(p.x, p.y) : (ctx.moveTo(p.x, p.y), (on = true));
    });
    ctx.strokeStyle = `rgba(${ACCENT},${a})`;
    ctx.stroke();
  };
  for (let lat = -80; lat <= 80; lat += step) {
    const pts: Pt[] = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push(proj(lat, lon));
    line(pts, alpha * (lat === 0 ? 1.4 : 1));
  }
  for (let lon = 0; lon < 360; lon += step) {
    const pts: Pt[] = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(proj(lat, lon));
    line(pts, alpha);
  }
}

/* Encode: loose, shimmering points over every landmass. No structure,
   just signal. ~20k points, so they're batched into a few alpha
   buckets (one path + fill each) instead of one fill per dot. */
const BUCKETS = 8;
function drawCloud(ctx: CanvasRenderingContext2D, g: Geo, proj: Projector, w: number, ts: number) {
  const unit = g.R / 300;
  const paths = { base: Array.from({ length: BUCKETS }, () => new Path2D()), hot: Array.from({ length: BUCKETS }, () => new Path2D()) };
  const t = ts * 0.002;
  for (let i = 0; i < CLOUD.length; i++) {
    const c = CLOUD[i];
    const p = proj(c.lat, c.lon);
    if (p.z <= 0.02) continue;
    const alpha = c.a * (0.65 + 0.35 * Math.sin(t + c.phase)) * (0.3 + 0.7 * p.z);
    const b = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS));
    const rad = c.s * unit * 1.25;
    const path = c.hot ? paths.hot[b] : paths.base[b];
    path.moveTo(p.x + rad, p.y);
    path.arc(p.x, p.y, rad, 0, Math.PI * 2);
  }
  for (let b = 0; b < BUCKETS; b++) {
    const a = ((b + 0.5) / BUCKETS) * w;
    ctx.fillStyle = `rgba(${ACCENT},${(a * 0.75).toFixed(3)})`; ctx.fill(paths.base[b]);
    ctx.fillStyle = `rgba(190,228,255,${a.toFixed(3)})`; ctx.fill(paths.hot[b]);
  }
}

/* Ground — named services on the grid, calls travelling between them. */
function drawArcs(ctx: CanvasRenderingContext2D, g: Geo, proj: Projector, w: number, ts: number) {
  const unit = g.R / 300;
  ARCS.forEach(([ai, bi], idx) => {
    const a = NODES[ai], b = NODES[bi];
    const pts: Pt[] = [];
    for (let s = 0; s <= 40; s++) {
      const t = s / 40;
      const [lat, lon] = slerp([a.lat, a.lon], [b.lat, b.lon], t);
      pts.push(proj(lat, lon, 0.12 * Math.sin(Math.PI * t)));
    }
    ctx.lineWidth = 1.1 * unit;
    ctx.strokeStyle = `rgba(${ACCENT},${0.45 * w})`;
    ctx.beginPath();
    let on = false;
    pts.forEach((p) => {
      if (p.z <= 0) { on = false; return; }
      on ? ctx.lineTo(p.x, p.y) : (ctx.moveTo(p.x, p.y), (on = true));
    });
    ctx.stroke();
    // Request pulse
    const t = ((ts / 2400 + idx * 0.37) % 1);
    const p = pts[Math.round(t * 40)];
    if (p.z > 0) {
      ctx.fillStyle = `rgba(220,240,255,${w})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * unit, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.font = `600 ${Math.max(10, Math.round(11 * unit))}px 'Proxima Nova', sans-serif`;
  ctx.textBaseline = "middle";
  NODES.forEach((n) => {
    const p = proj(n.lat, n.lon);
    if (p.z <= 0) return;
    ctx.globalAlpha = w * (0.4 + 0.6 * p.z);
    ctx.fillStyle = "#0C0C12";
    ctx.strokeStyle = `rgb(${ACCENT})`;
    ctx.lineWidth = 1.4 * unit;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4 * unit, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (n.label && p.z > 0.35) {
      ctx.globalAlpha = w * Math.min(1, (p.z - 0.35) * 3);
      ctx.fillStyle = "rgba(220,236,255,0.9)";
      ctx.fillText(n.label, p.x + 8 * unit, p.y);
    }
  });
  ctx.globalAlpha = 1;
}

/* ─── Tooltips + traffic lens ────────────────────────────────────── */
function TipGlyph({ icon }: { icon: TipIcon }) {
  // Traffic uses the house warning icon as supplied (fill, own viewBox).
  if (icon === "traffic") return (
    <svg viewBox="0 0 21 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M10.0177 14.5234C9.87652 14.5234 9.75299 14.5764 9.64711 14.6823C9.55887 14.7881 9.48828 14.9117 9.48828 15.0528C9.48828 15.3352 9.71769 15.5646 10.0177 15.5646C10.3177 15.5646 10.5295 15.3352 10.5295 15.0528C10.5295 14.9117 10.4765 14.7881 10.3706 14.6823C10.3 14.5764 10.1589 14.5234 10.0177 14.5234Z" />
      <path d="M9.50593 8.29406C9.50593 7.99406 9.73534 7.76465 10.0353 7.76465C10.3177 7.76465 10.5648 7.99406 10.5648 8.29406L10.5471 12.9705C10.5471 13.2705 10.3177 13.4999 10.0177 13.4999C9.71769 13.4999 9.48828 13.2705 9.48828 12.9705L9.50593 8.29406Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M19.8114 16.8706L11.7114 1.02353C11.3761 0.388236 10.7055 0 9.982 0C9.25847 0 8.60553 0.388236 8.25259 1.02353L7.82906 1.8L0.240823 16.8529C-0.0944713 17.4706 -0.0768242 18.2118 0.276117 18.8118C0.629058 19.4118 1.26435 19.7647 1.95259 19.7647H18.082C18.7702 19.7647 19.4055 19.4118 19.7585 18.8118C20.1291 18.2118 20.1467 17.4706 19.8114 16.8706ZM18.8585 18.2824C18.6996 18.5647 18.4173 18.7235 18.082 18.7235H1.95259C1.63494 18.7235 1.35259 18.5647 1.17612 18.2824C0.999646 18 0.999646 17.6471 1.15847 17.3471L9.20553 1.51765L9.22318 1.5C9.382 1.23529 9.682 1.05882 9.99965 1.05882C10.3349 1.05882 10.6349 1.23529 10.7938 1.51765L18.8938 17.3647C19.0349 17.6471 19.0173 18 18.8585 18.2824Z" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon === "modules" && (<>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
        <path d="M17 14v6M14 17h6" />
      </>)}
      {icon === "ai" && (<>
        <path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z" fill="currentColor" stroke="none" />
        <path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none" />
      </>)}
    </svg>
  );
}

function PillarTips({ geo: _geo }: { geo: Geo }) {
  return (
    <div className="pillars-tips" aria-hidden="true">
      <TrafficLens />
      {TIPS.map((t) => (
        <div key={t.id} className="pillars-tip" data-tip={t.id} style={{ opacity: 0 }}>
          <span className="tip-icon"><TipGlyph icon={t.icon} /></span>
          <span className="tip-body">
            <span className="tip-kicker">{t.kicker}</span>
            <strong className="tip-title">{t.title}</strong>
            <span className="tip-line">{t.line}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* Street-level window onto CITY with Orbis live traffic on. The globe
   stays at orbit scale; this lens is what carries the detail. */
function TrafficLens() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLDivElement>(".pillars-lens-map");
    if (!TOMTOM_API_KEY || !el) return;
    const map = new TomTomMap({
      style: "satellite" as any,
      language: "en-GB",
      mapLibre: {
        container: el,
        center: CITY.lngLat,
        zoom: CITY.zoom,
        interactive: false,
        fadeDuration: 0,
        ...({ attributionControl: false } as any),
      },
    });
    const m: any = map.mapLibreMap;
    const hideLabels = () => {
      try {
        (m.getStyle()?.layers || []).forEach((l: any) => {
          if (l.type === "symbol") m.setLayoutProperty(l.id, "visibility", "none");
        });
      } catch {}
    };
    m.once("load", () => {
      hideLabels();
      TrafficFlowModule.get(map, { visible: true }).catch(() => {});
    });
    m.on("styledata", hideLabels);
    // Share of rendered flow segments that aren't free-flowing.
    m.on("idle", () => {
      try {
        const ids = (m.getStyle().layers as any[]).map((l) => l.id).filter((id) => /^Traffic - .* flow$/.test(id));
        const feats = m.queryRenderedFeatures({ layers: ids });
        if (!feats.length) return;
        const slow = feats.filter((f: any) => !/Free flow/.test(f.layer.id)).length;
        setTipLine("traffic", `${Math.round((slow / feats.length) * 100)}% of roads slowed right now`);
      } catch {}
    });
    const ro = new ResizeObserver(() => { try { m.resize(); } catch {} });
    ro.observe(el);
    return () => { ro.disconnect(); try { m.remove(); } catch {} };
  }, []);
  return (
    <div ref={ref} className="pillars-lens" style={{ opacity: 0 }}>
      <div className="pillars-lens-map" />
    </div>
  );
}

/* Position every tooltip (and the lens) next to its map point, draw the
   leader + anchor dot on the canvas, and fade by pillar weight and by
   how far round the globe the point has turned. */
function placeTips(
  ctx: CanvasRenderingContext2D, g: Geo, proj: Projector,
  w: Record<Mode, number>, els: HTMLElement[], lens: HTMLElement | null,
) {
  const vis = (z: number) => Math.max(0, Math.min(1, (z - 0.25) * 4));
  const leader = (x0: number, y0: number, x1: number, y1: number, a: number, dot = true) => {
    if (a < 0.01) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1;
    // On a stop marker the line starts at the marker's edge instead.
    const d = Math.hypot(x1 - x0, y1 - y0) || 1, gap = dot ? 0 : 8;
    ctx.beginPath(); ctx.moveTo(x0 + ((x1 - x0) / d) * gap, y0 + ((y1 - y0) / d) * gap); ctx.lineTo(x1, y1); ctx.stroke();
    if (!dot) { ctx.globalAlpha = 1; return; }
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath(); ctx.arc(x0, y0, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgb(${ACCENT})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x0, y0, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  };

  els.forEach((el) => {
    const tip = TIPS.find((t) => t.id === el.dataset.tip);
    if (!tip) return;
    const p = proj(tip.lngLat[1], tip.lngLat[0]);
    const a = w[tip.mode] * vis(p.z);
    el.style.opacity = a.toFixed(3);
    if (a < 0.01) return;
    const bw = el.offsetWidth, bh = el.offsetHeight;
    const ax = p.x + (tip.side === "right" ? LEADER : -LEADER);
    let left = tip.side === "right" ? ax : ax - bw;
    left = Math.max(8, Math.min(g.W - 8 - bw, left));
    const top = Math.max(8, p.y - bh / 2);
    el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    const edge = tip.side === "right" ? left : left + bw;
    leader(p.x, p.y, edge, Math.min(Math.max(p.y, top + 12), top + bh - 12), a, !tip.onStop);
  });

  if (lens) {
    const p = proj(CITY.lngLat[1], CITY.lngLat[0]);
    const a = w.intel * vis(p.z);
    lens.style.opacity = a.toFixed(3);
    if (a >= 0.01) {
      const r = Math.round(Math.max(52, Math.min(110, g.R * 0.21)));
      let cx = p.x + LEADER + r;
      cx = Math.min(g.W - 8 - r, cx);
      const cy = Math.max(8 + r, p.y - r * 0.35);
      if (lens.offsetWidth !== r * 2) { lens.style.width = `${r * 2}px`; lens.style.height = `${r * 2}px`; }
      lens.style.transform = `translate(${(cx - r).toFixed(1)}px, ${(cy - r).toFixed(1)}px)`;
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      leader(p.x, p.y, cx - (dx / d) * r, cy - (dy / d) * r, a);
    }
  }
}
