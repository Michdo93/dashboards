/**
 * config.js
 * Verbindungseinstellungen zu deiner openHAB-Instanz.
 * Diese Datei einfach an deine Umgebung anpassen - sie wird von app.js gelesen.
 */
window.OPENHAB_CONFIG = {
  // Basis-URL deiner openHAB-Instanz, z.B. "http://192.168.1.10:8080"
  // url: "http://192.168.0.5:8080",
  url: "https://openhab.home.arpa",

  // Variante A: Basic-Auth mit Benutzername/Passwort
  username: null,
  password: null,

  // Variante B (empfohlen): API-Token aus openHAB (Einstellungen -> API-Sicherheit)
  // Wenn gesetzt, hat der Token Vorrang vor username/password.
  // WICHTIG: Der Token MUSS in Anführungszeichen stehen (er ist ein Text/String)!
  // Falsch:   token: oh.dashboard.AbCdEf123...,   -> "oh is not defined"-Fehler
  // Richtig:  token: "oh.dashboard.AbCdEf123...",
  token: "oh.token.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
};
