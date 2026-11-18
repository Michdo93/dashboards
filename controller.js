/**
 * controller.js - Controller-Schicht
 *
 * App verdrahtet beim Start Model (model.js) und View (app.js): erzeugt den
 * openHAB-Client, legt den ItemStore an, lässt die View alle [data-oh-item]-
 * Elemente daran binden, lädt die Initialzustände und hält danach den
 * Live-Update-Stream (ItemStateChangedEvent) offen. Eingehende Events werden
 * an das Model weitergereicht - die View aktualisiert sich darüber automatisch
 * per Observer-Pattern, der Controller muss dafür nichts weiter tun.
 */
(function () {
  "use strict";

  const { ItemStore } = window.OHModel;
  const View = window.OHView;

  const App = {
    store: null,
    api: null,
    itemEvents: null,

    init() {
      const cfg = window.OPENHAB_CONFIG || {};
      if (!cfg.url || typeof openHAB === "undefined") {
        console.warn("openHAB ist nicht konfiguriert - siehe config.js");
        return;
      }
      const client = new openHAB.OpenHABClient(cfg.url, cfg.username, cfg.password, cfg.token);
      this.api = new openHAB.Items(client);
      this.itemEvents = new openHAB.ItemEvents(client);
      this.store = new ItemStore(this.api, View.showToast);

      // View: alle gebundenen Elemente an ihr Model-Item koppeln
      document.querySelectorAll("[data-oh-item]").forEach((el) => View.bindElement(el, this.store));
      View.bindInteractions(this.store);
      View.initColorWheels(this.store);

      // Initialzustand laden (je referenziertes Item genau ein REST-Aufruf)
      this.store.loadInitial();

      // Live-Updates: ausschließlich ItemStateChangedEvent, kein Polling
      this.connectEventStream();
    },

    async connectEventStream() {
      try {
        const response = await this.itemEvents.ItemStateChangedEvent("*");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              this.handleItemEvent(JSON.parse(line.slice(6)));
            } catch (e) {
              /* unbekanntes Event-Format ignorieren */
            }
          }
        }
      } catch (err) {
        console.error("openHAB SSE-Verbindung verloren, neuer Versuch in 5s", err);
        setTimeout(() => this.connectEventStream(), 5000);
      }
    },

    handleItemEvent(evt) {
      const match = /openhab\/items\/([^/]+)\/statechanged$/.exec(evt.topic || "");
      if (!match) return;
      try {
        const payload = JSON.parse(evt.payload);
        const state = payload.value !== undefined ? payload.value : payload;
        this.store.applyEvent(match[1], String(state));
      } catch (e) {
        /* Payload nicht parsebar - ignorieren */
      }
    },
  };

  window.OHController = { App };

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------
  window.addEventListener("load", () => {
    const params = new URLSearchParams(window.location.search);
    const lockedRoom = params.get("raum");
    if (lockedRoom) {
      window.switchTab(lockedRoom);
    } else {
      window.switchTab(window.location.hash.replace("#", "") || "smarthome");
    }
    App.init();
  });
})();
