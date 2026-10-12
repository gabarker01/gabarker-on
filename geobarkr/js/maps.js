// Google Maps and Street View, set up as the ServiceNow widgets did.
import { GOOGLE_MAPS_KEY } from "./config.js";
import { formatDistance, formatScore } from "./geo.js";

// The guess map (GeoBarkr Map widget): whole world, latitudes clamped to ±80.
const WORLD = {
  center: { lat: 21.170226033316446, lng: -6.8097916260035705 },
  zoom: 1,
  minZoom: 1,
  restriction: { latLngBounds: { north: 80, south: -80, east: 180, west: -180 } },
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  // One finger drags the map: on a phone the map is the whole screen.
  gestureHandling: "greedy",
};

// The green "target" pin from the ServiceNow results popups.
const TARGET_PIN = {
  path: "M-1.547 12l6.563-6.609-1.406-1.406-5.156 5.203-2.063-2.109-1.406 1.406zM0 0q2.906 0 4.945 2.039t2.039 4.945q0 1.453-0.727 3.328t-1.758 3.516-2.039 3.070-1.711 2.273l-0.75 0.797q-0.281-0.328-0.75-0.867t-1.688-2.156-2.133-3.141-1.664-3.445-0.75-3.375q0-2.906 2.039-4.945t4.945-2.039z",
  fillColor: "green",
  fillOpacity: 1,
  strokeWeight: 0,
  scale: 2,
};

let mapsPromise = null;

export function loadGoogleMaps() {
  if (!mapsPromise) {
    mapsPromise = new Promise((resolve, reject) => {
      if (!GOOGLE_MAPS_KEY) {
        reject(new Error("The Google Maps key isn't set up yet (geobarkr/js/config.js)."));
        return;
      }
      window.gm_authFailure = () => {
        document.dispatchEvent(new CustomEvent("geobarkr:maps-auth-failed"));
      };
      window.__geobarkrMapsReady = async () => {
        try {
          await Promise.all(["maps", "streetView", "marker"].map((lib) => google.maps.importLibrary(lib)));
          resolve(google.maps);
        } catch (error) {
          reject(error);
        }
      };
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js"
        + `?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&loading=async&callback=__geobarkrMapsReady`;
      script.async = true;
      script.onerror = () => {
        mapsPromise = null;
        reject(new Error("Couldn't load Google Maps. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return mapsPromise;
}

// Tap (or click) to place your guess; tap again to move it.
export async function createGuessMap(element, onPick) {
  const maps = await loadGoogleMaps();
  const map = new maps.Map(element, WORLD);
  let marker = null;
  let pick = null;

  map.addListener("click", (event) => {
    pick = { lat: event.latLng.lat(), lng: event.latLng.lng() };
    if (marker) marker.setPosition(pick);
    else marker = new maps.Marker({ position: pick, map, title: "My guess is here" });
    onPick?.(pick);
  });

  return {
    map,
    getPick: () => pick,
    reset() {
      pick = null;
      if (marker) marker.setMap(null);
      marker = null;
      map.setCenter(WORLD.center);
      map.setZoom(WORLD.zoom);
    },
  };
}

// Street View at the round's place (GeoBarkr Panorama widget): no movement
// arrows, address, road names or zoom buttons, but you can still look around,
// click along the road and pinch to zoom.
export async function createPanorama(element) {
  const maps = await loadGoogleMaps();
  const panorama = new maps.StreetViewPanorama(element, {
    linksControl: false,
    panControl: true,
    enableCloseButton: false,
    addressControl: false,
    zoomControl: false,
    showRoadLabels: false,
    visible: false,
  });
  let start = null;

  function goTo(target) {
    panorama.setPosition({ lat: target.lat, lng: target.lng });
    panorama.setPov({ heading: target.heading || 0, pitch: target.pitch || 0 });
    panorama.setZoom(1);
    panorama.setVisible(true);
  }

  return {
    panorama,
    show(target) {
      const key = `${target.lat},${target.lng},${target.heading},${target.pitch}`;
      if (start && start.key === key) return;
      start = { ...target, key };
      goTo(start);
    },
    // The home button: back to where the round started.
    home() {
      if (start) goTo(start);
    },
    hide() {
      start = null;
      panorama.setVisible(false);
    },
  };
}

// Guesses, targets and the lines between them (results popups and pages).
export async function createResultsMap(element) {
  const maps = await loadGoogleMaps();
  const map = new maps.Map(element, { ...WORLD, zoom: 2 });
  let drawn = [];

  function clear() {
    for (const item of drawn) {
      if (item.close) item.close();
      if (item.setMap) item.setMap(null);
    }
    drawn = [];
  }

  // targets: [{lat, lng}]; guesses: [{lat, lng, target: {lat, lng}, title, label?}]
  function show({ targets = [], guesses = [] }) {
    clear();
    const bounds = new maps.LatLngBounds();
    for (const target of targets) {
      drawn.push(new maps.Marker({
        position: target, map, title: "Target",
        icon: { ...TARGET_PIN, anchor: new maps.Point(0, 20) },
        zIndex: 10,
      }));
      bounds.extend(target);
    }
    for (const guess of guesses) {
      const marker = new maps.Marker({ position: guess, map, title: guess.title || "Guess" });
      drawn.push(marker);
      bounds.extend(guess);
      if (guess.target) {
        drawn.push(new maps.Polyline({
          path: [guess, guess.target], geodesic: true, map,
          strokeColor: "#FF0000", strokeOpacity: 1, strokeWeight: 2,
        }));
      }
      if (guess.label) {
        const info = new maps.InfoWindow({ content: guess.label, headerDisabled: true, disableAutoPan: true });
        info.open({ map, anchor: marker });
        drawn.push(info);
      }
    }
    const points = targets.length + guesses.length;
    if (points === 1) {
      map.setCenter(targets[0] || guesses[0]);
      map.setZoom(4);
    } else if (points > 1) {
      map.fitBounds(bounds, 48);
    }
  }

  return { map, show, clear };
}

// The label on a player's guess in the round results: name, km and points.
export function guessLabel(name, distanceKm, score) {
  const box = document.createElement("div");
  box.className = "gb-map-label";
  const strong = document.createElement("strong");
  strong.textContent = name;
  const line = document.createElement("div");
  line.textContent = `${formatDistance(distanceKm)} km • ${formatScore(score)} pts`;
  box.append(strong, line);
  return box;
}
