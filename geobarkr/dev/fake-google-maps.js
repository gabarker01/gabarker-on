// A stand-in for the Google Maps JavaScript API, for automated tests only (the
// real API needs a key restricted to gabarker.com). Tests serve this in place
// of https://maps.googleapis.com/maps/api/js. It draws a flat world map you
// can tap, and a labelled placeholder instead of Street View imagery.
(() => {
  const src = document.currentScript?.src || "";
  const callback = new URL(src, location.href).searchParams.get("callback");
  const SVG = "http://www.w3.org/2000/svg";
  let land = null;
  const landReady = fetch("/tapmap/land-110m.geojson").then((r) => r.json()).then((json) => { land = json; }).catch(() => {});

  class LatLng {
    constructor(lat, lng) {
      if (typeof lat === "object") ({ lat, lng } = lat);
      this._lat = Number(lat);
      this._lng = Number(lng);
    }
    lat() { return this._lat; }
    lng() { return this._lng; }
    toJSON() { return { lat: this._lat, lng: this._lng }; }
  }
  const toLatLng = (p) => (p instanceof LatLng ? p : new LatLng(p));

  class Map {
    constructor(element, options = {}) {
      this.el = element;
      this.listeners = {};
      this.overlays = new Set();
      this.root = document.createElement("div");
      this.root.className = "fake-map";
      Object.assign(this.root.style, { position: "absolute", inset: "0", background: "#aad3df", overflow: "hidden", cursor: "crosshair" });
      this.svg = document.createElementNS(SVG, "svg");
      this.svg.setAttribute("viewBox", "0 0 360 180");
      this.svg.setAttribute("preserveAspectRatio", "none");
      Object.assign(this.svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
      this.root.append(this.svg);
      element.append(this.root);
      landReady.then(() => this.drawLand());
      this.root.addEventListener("click", (event) => {
        if (event.target.closest(".fake-label")) return;
        const box = this.root.getBoundingClientRect();
        const lng = ((event.clientX - box.left) / box.width) * 360 - 180;
        const lat = 90 - ((event.clientY - box.top) / box.height) * 180;
        for (const fn of this.listeners.click || []) fn({ latLng: new LatLng(lat, lng) });
      });
    }
    drawLand() {
      if (!land) return;
      const path = document.createElementNS(SVG, "path");
      let d = "";
      for (const feature of land.features || []) {
        const geometry = feature.geometry;
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        for (const polygon of polygons) for (const ring of polygon) {
          d += ring.map(([x, y], i) => `${i ? "L" : "M"}${(x + 180).toFixed(2)} ${(90 - y).toFixed(2)}`).join("") + "Z";
        }
      }
      path.setAttribute("d", d);
      path.setAttribute("fill", "#f2efe9");
      path.setAttribute("stroke", "#c9c2b5");
      path.setAttribute("stroke-width", "0.2");
      this.svg.prepend(path);
    }
    addListener(name, fn) { (this.listeners[name] ||= []).push(fn); return { remove() {} }; }
    setCenter() {}
    setZoom() {}
    fitBounds() {}
    place(latLng) {
      return { left: `${((latLng.lng() + 180) / 360) * 100}%`, top: `${((90 - latLng.lat()) / 180) * 100}%` };
    }
  }

  class Marker {
    constructor({ position, map, title, icon }) {
      this.el = document.createElement("div");
      this.el.className = icon ? "fake-marker fake-target" : "fake-marker";
      this.el.title = title || "";
      this.el.setAttribute("data-title", title || "");
      Object.assign(this.el.style, {
        position: "absolute", width: "14px", height: "14px", margin: "-14px 0 0 -7px", borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)", background: icon ? "green" : "#ea4335", border: "2px solid #fff", pointerEvents: "none",
      });
      this.position = toLatLng(position);
      this.setMap(map);
    }
    setPosition(position) { this.position = toLatLng(position); this.draw(); }
    getPosition() { return this.position; }
    setMap(map) {
      this.el.remove();
      this.map = map;
      if (map) { map.root.append(this.el); this.draw(); }
    }
    draw() { if (this.map) Object.assign(this.el.style, this.map.place(this.position)); }
  }

  class Polyline {
    constructor({ path, map }) {
      this.line = document.createElementNS(SVG, "line");
      const [a, b] = path.map(toLatLng);
      this.line.setAttribute("x1", a.lng() + 180); this.line.setAttribute("y1", 90 - a.lat());
      this.line.setAttribute("x2", b.lng() + 180); this.line.setAttribute("y2", 90 - b.lat());
      this.line.setAttribute("stroke", "#FF0000");
      this.line.setAttribute("stroke-width", "0.6");
      this.line.setAttribute("class", "fake-line");
      this.setMap(map);
    }
    setMap(map) { this.line.remove(); if (map) map.svg.append(this.line); }
  }

  class InfoWindow {
    constructor({ content }) { this.content = content; }
    open({ map, anchor }) {
      this.el = document.createElement("div");
      this.el.className = "fake-label";
      Object.assign(this.el.style, { position: "absolute", transform: "translate(-50%, -130%)", background: "#fff", padding: "4px 6px", borderRadius: "6px", boxShadow: "0 1px 4px rgba(0,0,0,.3)", whiteSpace: "nowrap" });
      this.el.append(this.content instanceof Node ? this.content : document.createTextNode(String(this.content)));
      Object.assign(this.el.style, map.place(anchor.getPosition()));
      map.root.append(this.el);
    }
    close() { this.el?.remove(); }
  }

  class StreetViewPanorama {
    constructor(element) {
      this.el = document.createElement("div");
      this.el.className = "fake-pano";
      Object.assign(this.el.style, {
        position: "absolute", inset: "0", display: "grid", placeItems: "center", textAlign: "center", color: "#fff",
        background: "linear-gradient(#7fb2e5 0 55%, #6c7a5a 55% 100%)", font: "600 18px system-ui",
      });
      element.append(this.el);
      this.pov = { heading: 0, pitch: 0 };
      this.position = null;
      this.visible = false;
      this.draw();
    }
    setPosition(p) { this.position = toLatLng(p); this.draw(); }
    getPosition() { return this.position; }
    setPov(pov) { this.pov = { ...pov }; this.draw(); }
    getPov() { return this.pov; }
    setZoom() {}
    setVisible(v) { this.visible = v; this.draw(); }
    draw() {
      this.el.style.display = this.visible ? "grid" : "none";
      this.el.textContent = this.position
        ? `Street View stand-in · heading ${Math.round(this.pov.heading)}°`
        : "";
      this.el.dataset.lat = this.position?.lat() ?? "";
      this.el.dataset.lng = this.position?.lng() ?? "";
    }
  }

  class LatLngBounds { extend() { return this; } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }

  const maps = {
    Map, Marker, Polyline, InfoWindow, StreetViewPanorama, LatLng, LatLngBounds, Point,
    event: { trigger() {} },
    importLibrary: async () => maps,
  };
  window.google = { maps };
  if (callback && typeof window[callback] === "function") setTimeout(() => window[callback](), 0);
})();
