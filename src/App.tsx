import { useState } from "react";
import { TrainMap } from "./TrainMap";
import { useLiveVehicles } from "./useLiveVehicles";

const LINES = [
  { label: "Western", color: "#f4b000" },
  { label: "Eastern", color: "#2f9e44" },
  { label: "Onehunga", color: "#7048e8" },
  { label: "Southern / Pukekohe", color: "#d94841" },
];

export function App() {
  const { data } = useLiveVehicles();
  const vehicles = data?.vehicles ?? [];
  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const [darkMode, setDarkMode] = useState(false);

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
        <nav className="map-legend" aria-label="Train line legend">
          {LINES.map((line) => (
            <div key={line.label} className="map-legend-item">
              <span className="map-legend-swatch" style={{ background: line.color }} aria-hidden="true" />
              {line.label}
            </div>
          ))}
        </nav>
        <TrainMap vehicles={vehicles} darkMode={darkMode} onToggleDarkMode={() => setDarkMode((d) => !d)} />
      </section>
    </main>
  );
}
