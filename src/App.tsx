import { useState } from "react";
import { TrainMap } from "./TrainMap";
import { useLiveVehicles } from "./useLiveVehicles";

const LINES = [
  { label: "Western", color: "#f4b000" },
  { label: "Eastern", color: "#2f9e44" },
  { label: "Onehunga", color: "#7048e8" },
  { label: "Southern / Pukekohe", color: "#d94841" },
];

const FERRY_COLOR = "#0c9cb2";

export function App() {
  const { data } = useLiveVehicles();
  const vehicles = data?.vehicles ?? [];
  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const [darkMode, setDarkMode] = useState(false);
  const [layers, setLayers] = useState({ trains: true, ferries: true });

  const visibleVehicles = vehicles.filter(
    (v) => (v.vehicleType === "train" && layers.trains) || (v.vehicleType === "ferry" && layers.ferries)
  );

  function toggleLayer(key: keyof typeof layers) {
    setLayers((l) => ({ ...l, [key]: !l[key] }));
  }

  return (
    <main className={`shell${darkMode ? " dark" : ""}`}>
      <section className="map-card">
        <div className="map-pill" aria-label="Auckland metro board">
          Auckland metro board
        </div>
        {updatedAt && (
          <div className="map-pill map-pill-updated" aria-live="polite" aria-label={`Last updated at ${updatedAt}`}>
            Updated {updatedAt}
          </div>
        )}
        <button
          className="map-pill map-pill-theme"
          onClick={() => setDarkMode((d) => !d)}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? "☀" : "☾"}
        </button>
        <nav className="map-legend" aria-label="Train line legend">
          <div className="map-legend-section">
            <button
              className={`map-legend-layer${layers.trains ? " active" : ""}`}
              onClick={() => toggleLayer("trains")}
            >
              Trains
            </button>
            <button
              className={`map-legend-layer${layers.ferries ? " active" : ""}`}
              onClick={() => toggleLayer("ferries")}
            >
              Ferries
            </button>
          </div>
          {layers.trains && LINES.map((line) => (
            <div key={line.label} className="map-legend-item">
              <span className="map-legend-swatch" style={{ background: line.color }} aria-hidden="true" />
              {line.label}
            </div>
          ))}
          {layers.ferries && (
            <div className="map-legend-item">
              <span className="map-legend-swatch map-legend-swatch-ferry" style={{ background: FERRY_COLOR }} aria-hidden="true" />
              Ferry
            </div>
          )}
        </nav>
        <TrainMap vehicles={visibleVehicles} darkMode={darkMode} />
      </section>
    </main>
  );
}
