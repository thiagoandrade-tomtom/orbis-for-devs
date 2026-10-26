import { useEffect, useState } from "react";
import OrbitingMenu from "./OrbitingMenu";
import PillarsBanner from "./PillarsBanner";
import "./pillars.css";

// #pillars opens the website banner prototype; anything else is the hero.
export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash === "#pillars" ? <PillarsBanner /> : <OrbitingMenu />;
}
