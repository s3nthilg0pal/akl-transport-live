import { useEffect, useRef } from "react";
import L from "leaflet";
import type { TrainVehicle } from "./types";

const AUCKLAND: L.LatLngExpression = [-36.8485, 174.7633];
const STALE_AFTER_SECONDS = 90;
const DEFAULT_MOVE_MS = 3_000;
const MIN_MOVE_MS = 750;
const MAX_MOVE_MS = 30_000;
const SNAP_DISTANCE_METERS = 5_000;

function tileUrl(dark: boolean): string {
  return dark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
}

type MetroLine = {
  id: string;
  label: string;
  color: string;
};

type TrainMapProps = {
  vehicles: TrainVehicle[];
  darkMode: boolean;
  onToggleDarkMode: () => void;
};

type MarkerAnimation = {
  frameId: number | null;
  from: L.LatLng;
  to: L.LatLng;
  startedAt: number;
  durationMs: number;
};

export function TrainMap({ vehicles, darkMode, onToggleDarkMode }: TrainMapProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const lineLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const markerClickHandlersRef = useRef<Map<string, L.LeafletEventHandlerFn>>(new Map());
  const markerAnimationsRef = useRef<Map<string, MarkerAnimation>>(new Map());
  const vehicleTimestampsRef = useRef<Map<string, number | null>>(new Map());
  const activeShapeRef = useRef<L.Polyline | null>(null);
  const activeTripIdRef = useRef<string | null>(null);
  const activeStopMarkersRef = useRef<L.CircleMarker[]>([]);
  const activeFollowIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapNodeRef.current, {
      attributionControl: true,
      zoomControl: false
    }).setView(AUCKLAND, 11);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    const tile = L.tileLayer(tileUrl(false), {
      maxZoom: 19,
      opacity: 1,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    tileLayerRef.current = tile;

    lineLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on("dragstart", () => {
      activeFollowIdRef.current = null;
    });

    return () => {
      for (const animation of markerAnimationsRef.current.values()) {
        if (animation.frameId !== null) {
          window.cancelAnimationFrame(animation.frameId);
        }
      }
      map.remove();
      mapRef.current = null;
      lineLayerRef.current = null;
      markerLayerRef.current = null;
      markersRef.current.clear();
      markerClickHandlersRef.current.clear();
      markerAnimationsRef.current.clear();
      vehicleTimestampsRef.current.clear();
      activeShapeRef.current = null;
      activeTripIdRef.current = null;
      activeStopMarkersRef.current = [];
      activeFollowIdRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const markerLayer = markerLayerRef.current;
    const markers = markersRef.current;

    if (!markerLayer) {
      return;
    }

    const nextIds = new Set<string>();

    for (const vehicle of vehicles) {
      nextIds.add(vehicle.id);
      const stale = vehicle.ageSeconds !== null && vehicle.ageSeconds > STALE_AFTER_SECONDS;
      const icon = trainIcon(vehicle.routeId, vehicle.bearing, stale);
      const content = popupHtml(vehicle, stale);
      const existing = markers.get(vehicle.id);
      const clickHandler = () => handleTraceClick(vehicle);

      if (existing) {
        animateMarkerTo(vehicle, existing);
        existing.setIcon(icon);
        existing.setPopupContent(content);
        const previousClickHandler = markerClickHandlersRef.current.get(vehicle.id);
        if (previousClickHandler) {
          existing.off("click", previousClickHandler);
        }
        existing.on("click", clickHandler);
        markerClickHandlersRef.current.set(vehicle.id, clickHandler);
        continue;
      }

      const marker = L.marker([vehicle.latitude, vehicle.longitude], { icon });
      marker.bindPopup(content);
      marker.on("click", clickHandler);
      marker.addTo(markerLayer);
      markers.set(vehicle.id, marker);
      markerClickHandlersRef.current.set(vehicle.id, clickHandler);
      vehicleTimestampsRef.current.set(vehicle.id, vehicle.timestamp);
    }

    for (const [vehicleId, marker] of markers) {
      if (nextIds.has(vehicleId)) {
        continue;
      }

      stopMarkerAnimation(vehicleId);
      marker.remove();
      markers.delete(vehicleId);
      markerClickHandlersRef.current.delete(vehicleId);
      vehicleTimestampsRef.current.delete(vehicleId);
    }
  }, [vehicles]);

  function animateMarkerTo(vehicle: TrainVehicle, marker: L.Marker) {
    const destination = L.latLng(vehicle.latitude, vehicle.longitude);
    const current = marker.getLatLng();
    const previousTimestamp = vehicleTimestampsRef.current.get(vehicle.id) ?? null;
    const runningAnimation = markerAnimationsRef.current.get(vehicle.id);

    if (previousTimestamp === vehicle.timestamp && runningAnimation?.to.equals(destination)) {
      return;
    }

    if (!runningAnimation && current.equals(destination)) {
      vehicleTimestampsRef.current.set(vehicle.id, vehicle.timestamp);
      return;
    }

    const durationMs = movementDurationMs(previousTimestamp, vehicle.timestamp);

    vehicleTimestampsRef.current.set(vehicle.id, vehicle.timestamp);

    if (current.distanceTo(destination) > SNAP_DISTANCE_METERS || durationMs <= 0) {
      stopMarkerAnimation(vehicle.id);
      marker.setLatLng(destination);
      panFollowedMarker(vehicle.id, destination);
      return;
    }

    stopMarkerAnimation(vehicle.id);

    const animation: MarkerAnimation = {
      frameId: null,
      from: current,
      to: destination,
      startedAt: performance.now(),
      durationMs
    };

    const step = (now: number) => {
      const elapsed = now - animation.startedAt;
      const progress = Math.min(elapsed / animation.durationMs, 1);
      const eased = easeInOutCubic(progress);
      const next = L.latLng(
        animation.from.lat + (animation.to.lat - animation.from.lat) * eased,
        animation.from.lng + (animation.to.lng - animation.from.lng) * eased
      );

      marker.setLatLng(next);
      panFollowedMarker(vehicle.id, next);

      if (progress < 1) {
        animation.frameId = window.requestAnimationFrame(step);
        return;
      }

      markerAnimationsRef.current.delete(vehicle.id);
    };

    animation.frameId = window.requestAnimationFrame(step);
    markerAnimationsRef.current.set(vehicle.id, animation);
  }

  function stopMarkerAnimation(vehicleId: string) {
    const animation = markerAnimationsRef.current.get(vehicleId);
    if (!animation) {
      return;
    }

    if (animation.frameId !== null) {
      window.cancelAnimationFrame(animation.frameId);
    }
    markerAnimationsRef.current.delete(vehicleId);
  }

  function panFollowedMarker(vehicleId: string, latLng: L.LatLng) {
    if (activeFollowIdRef.current === vehicleId) {
      mapRef.current?.panTo(latLng, { animate: false });
    }
  }

  function clearActiveShape() {
    activeShapeRef.current?.remove();
    activeShapeRef.current = null;
    activeTripIdRef.current = null;
    activeFollowIdRef.current = null;
    for (const m of activeStopMarkersRef.current) m.remove();
    activeStopMarkersRef.current = [];
  }

  async function handleTraceClick(vehicle: TrainVehicle) {
    if (!mapRef.current || !vehicle.tripId) return;

    if (activeTripIdRef.current === vehicle.tripId) {
      clearActiveShape();
      return;
    }

    clearActiveShape();

    try {
      const response = await fetch(`/api/shape/${encodeURIComponent(vehicle.tripId)}`);
      if (!response.ok) return;
      const { points, stops } = await response.json() as {
        points: [number, number][];
        stops: { name: string; lat: number; lon: number }[];
      };
      if (!mapRef.current) return;

      const color = routeColor(vehicle.routeId);

      const polyline = L.polyline(points, {
        color,
        weight: 5,
        opacity: 0.85
      }).addTo(mapRef.current);

      const stopMarkers = (stops ?? []).map((stop) =>
        L.circleMarker([stop.lat, stop.lon], {
          radius: 5,
          color: "#22252b",
          weight: 2,
          fillColor: color,
          fillOpacity: 1
        })
          .bindTooltip(stop.name, { direction: "top", offset: [0, -6] })
          .addTo(mapRef.current!)
      );

      activeShapeRef.current = polyline;
      activeStopMarkersRef.current = stopMarkers;
      activeTripIdRef.current = vehicle.tripId;
      activeFollowIdRef.current = vehicle.id;
      mapRef.current.panTo([vehicle.latitude, vehicle.longitude]);
    } catch {
      // shape unavailable — silently ignore
    }
  }

  function handleRecenter() {
    mapRef.current?.setView(AUCKLAND, 11);
  }

  useEffect(() => {
    if (!mapRef.current) return;
    tileLayerRef.current?.remove();
    const tile = L.tileLayer(tileUrl(darkMode), {
      maxZoom: 19,
      opacity: 1,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(mapRef.current);
    tileLayerRef.current = tile;
  }, [darkMode]);

  return (
    <>
      <div ref={mapNodeRef} className="train-map" aria-label="Live Auckland train map" />
      <button className="map-control" onClick={onToggleDarkMode} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
        {darkMode ? "☀" : "☾"}
      </button>
      <button className="map-control map-recenter" onClick={handleRecenter} aria-label="Re-centre map on Auckland">
        ⊙
      </button>
    </>
  );
}

function trainIcon(routeId: string | null, bearing: number | null, stale: boolean): L.DivIcon {
  const color = routeColor(routeId);
  const rotation = bearing !== null ? bearing : 0;
  return L.divIcon({
    className: "train-marker-shell",
    html: `<div class="train-marker ${stale ? "train-marker-stale" : ""}" style="--route-color: ${color}; transform: rotate(${rotation}deg)" aria-hidden="true">
      <span></span>
    </div>`,
    iconSize: [30, 18],
    iconAnchor: [15, 9]
  });
}

function routeColor(routeId: string | null): string {
  const normalized = routeId?.toUpperCase() ?? "";

  if (normalized.includes("WEST")) {
    return "#f4b000";
  }

  if (normalized.includes("EAST")) {
    return "#2f9e44";
  }

  if (normalized.includes("ONE")) {
    return "#7048e8";
  }

  if (normalized.includes("STH") || normalized.includes("SOUTH") || normalized.includes("PUK")) {
    return "#d94841";
  }

  return "#1c7ed6";
}

function movementDurationMs(previousTimestamp: number | null, nextTimestamp: number | null): number {
  if (previousTimestamp !== null && nextTimestamp !== null && nextTimestamp > previousTimestamp) {
    return clamp((nextTimestamp - previousTimestamp) * 1_000, MIN_MOVE_MS, MAX_MOVE_MS);
  }

  return DEFAULT_MOVE_MS;
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function popupHtml(vehicle: TrainVehicle, stale: boolean): string {
  const updated = vehicle.timestamp
    ? new Date(vehicle.timestamp * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    : "Unknown";

  return `
    <div class="train-popup">
      <strong>${escapeHtml(vehicle.vehicleName ?? vehicle.routeId ?? "Train")}</strong>
      ${vehicle.vehicleName ? `<span>Route ${escapeHtml(vehicle.routeId ?? "unknown")}</span>` : ""}
      <span>Next stop ${escapeHtml(vehicle.nextStopName ?? vehicle.nextStopId ?? "unknown")}</span>
      <span>Vehicle ${escapeHtml(vehicle.vehicleId)}</span>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return replacements[char];
  });
}
