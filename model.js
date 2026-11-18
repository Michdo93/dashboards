/**
 * model.js - Model-Schicht (Observable)
 *
 * OHItem   - ein einzelnes openHAB-Item: Name, zuletzt bekannter State,
 *            Liste von Abonnenten (Observer-Pattern).
 * ItemStore - Registry aller im Dashboard verwendeten Items. Erzeugt bei
 *             Bedarf ein neues OHItem, lädt den Initialzustand und nimmt
 *             eingehende ItemStateChangedEvents entgegen.
 *
 * Kennt weder DOM noch openHAB-Verbindungsdetails - nur die Objekte
 * "api" (mit getItemState/sendCommand) und optional "notify" (z.B. Toast)
 * werden von außen hineingereicht (Dependency Injection).
 */
(function () {
  "use strict";

  class OHItem {
    constructor(name, api, notify) {
      this.name = name;
      this.state = undefined;
      this.pattern = null; // stateDescription.pattern von openHAB (z.B. "%.3f kWh", "%1$tH:%1$tM")
      this._api = api;
      this._notify = notify || function () {};
      this._observers = new Set();
    }

    /** View abonniert Änderungen. Ist bereits ein State bekannt, wird sofort
     *  einmal mit dem aktuellen Stand aufgerufen. Gibt eine Unsubscribe-Funktion zurück. */
    subscribe(fn) {
      this._observers.add(fn);
      if (this.state !== undefined) fn(this.state, this);
      return () => this._observers.delete(fn);
    }

    /** Setzt den State und benachrichtigt alle Abonnenten - egal ob der neue
     *  Wert vom initialen Laden oder von einem Live-Event (SSE) stammt. */
    setState(newState) {
      this.state = newState;
      this._observers.forEach((fn) => fn(newState, this));
    }

    /** Sendet einen Befehl ans echte Item (POST /rest/items/{name}). */
    sendCommand(command) {
      if (!this._api) return Promise.resolve();
      return this._api
        .sendCommand(this.name, command)
        .then(() => this._notify(`${this.name} → ${command}`))
        .catch((err) => {
          console.error("sendCommand", this.name, err);
          this._notify(`Fehler beim Senden an ${this.name}`);
        });
    }

    /** Lädt den aktuellen State einmalig per REST (GET /rest/items/{name}/state). */
    refresh() {
      if (!this._api) return Promise.resolve();
      return this._api
        .getItemState(this.name)
        .then((state) => {
          // Bei leerem Response-Body liefert openhab.js ein {status:...}-Objekt
          // statt eines Strings (z.B. bei String-Items ohne aktuellen Wert, etwa
          // Sonos-Titel/Künstler wenn gerade nichts abgespielt wird). Das ist ein
          // gültiger leerer Zustand, kein Fehler.
          this.setState(typeof state === "string" ? state : "");
        })
        .catch((err) => console.warn("Kein Zustand für", this.name, err));
    }
  }

  class ItemStore {
    constructor(api, notify) {
      this._api = api;
      this._notify = notify;
      this._items = new Map();
    }

    get(name) {
      if (!this._items.has(name)) {
        this._items.set(name, new OHItem(name, this._api, this._notify));
      }
      return this._items.get(name);
    }

    /** Lädt den Initialzustand ALLER referenzierten Items in einem einzigen
     *  REST-Aufruf (GET /rest/items?fields=name,state), statt pro Item einzeln
     *  zu fragen. Bei hunderten Items überfordern viele parallele Einzelabfragen
     *  sonst den Browser (Verbindungslimit) bzw. den Server - das führte zu
     *  regelmäßig fehlenden/leeren Anzeigen ohne klaren Fehler. */
    async loadInitial() {
      if (!this._api || this._items.size === 0) return;
      try {
        const list = await this._api.getItems({ fields: "name,state,stateDescription" });
        const byName = new Map(list.map((it) => [it.name, it]));
        for (const [name, item] of this._items) {
          if (byName.has(name)) {
            const it = byName.get(name);
            item.pattern = (it.stateDescription && it.stateDescription.pattern) || null;
            const raw = it.state;
            item.setState(typeof raw === "string" ? raw : String(raw ?? ""));
          } else {
            console.warn("Item existiert nicht in /rest/items:", name);
          }
        }
      } catch (err) {
        console.error("Konnte Item-Liste nicht in einem Rutsch laden, Fallback auf Einzelabfragen:", err);
        await Promise.all(Array.from(this._items.values()).map((item) => item.refresh()));
      }
    }

    /** Wird vom SSE-Handler für jedes eingehende ItemStateChangedEvent aufgerufen. */
    applyEvent(name, state) {
      if (this._items.has(name)) this._items.get(name).setState(state);
      // Items, die auf dieser Seite nicht gebunden sind, ignorieren wir bewusst.
    }
  }

  window.OHModel = { OHItem, ItemStore };
})();
