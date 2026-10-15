# ribo

Parametrisches CAD für den 3D-Druck, als Web-App auf dem EMFTS/TSM-Stack.

Der Name: **gene** beschreibt den Bauplan, **ribo** (Ribosom) baut daraus Körper.

## Starten

```bash
npm install
npm run dev        # http://localhost:5174
npm run test:unit  # Vitest
npm run type-check
npm run lint

npm run build      # dist/ mit Host und allen Modulen unter dist/plugins/
npm run preview    # gebaute Version lokal ansehen
docker build -t ribo . && docker run -p 8080:80 ribo
```

Beim Start zeigt ein Startbildschirm (drehender ribo-Würfel, Fortschritt, die Module einzeln) was gerade lädt. Fehler bleiben dort stehen – mit *Neu laden*, *Trotzdem fortfahren*, *Gespeicherten Stand verwerfen* und *Fehler kopieren*. „Failed to fetch dynamically imported module“ heißt fast immer: Der Dev-Server hat gerade neu übersetzt (z. B. nach einer Änderung an `vite.config.ts`) – neu laden, sonst den Dev-Server neu starten.

Hat der automatisch gespeicherte Stand den letzten Start verhindert (Absturz oder Hänger beim Öffnen), wird er beim nächsten Start nicht wieder geöffnet, sondern beiseitegelegt; *Datei → Verworfenen Stand herunterladen* sichert ihn.

## Bedienung (Stand Schritt 4)

Der Ablauf orientiert sich an Fusion 360:

1. **Skizze erstellen** (S): Eine Ursprungsebene oder eine ebene Körperfläche anklicken. Die Ansicht dreht sich dann senkrecht auf die Ebene und wechselt in die flache 2D-Ansicht.
2. **Zeichnen**:
   - Linie (L), Rechteck mit 2 Punkten (R) oder vom Mittelpunkt aus
   - Kreis (C), 3-Punkt-Bogen (A), Polygon (P), Langloch, Punkt
   - Maße beim Zeichnen einfach eintippen. Tab wechselt das Feld, Enter übernimmt. Ausdrücke wie `breite/2` sind erlaubt.
   - Endpunkte fangen auf Punkte, Mittelpunkte und Kurven. Fast waagrechte oder senkrechte Linien bekommen automatisch H/V.
3. **Projizieren** (J): Körperkanten anklicken; sie werden als fixierte, lila Referenzgeometrie übernommen (gerade Kanten als Linie, runde als Kreis/Bogen, sonst als Linienzug). Die rote X- und grüne Y-Achse lassen sich ebenso anklicken und werden zu Hilfs-Referenzlinien, z. B. als Spiegelachse.
4. **Ändern**: Abrunden (F), Stutzen (T), Hilfsgeometrie (X), Versatz (O), Spiegeln (M), rechteckiges und kreisförmiges Muster.
   - Versatz: Kurve anklicken, verbundene Kurven werden mitgenommen; Seite mit der Maus, Abstand eintippen.
   - Spiegeln und Muster: Kurven wählen (oder vorher auswählen), Enter, dann Spiegellinie bzw. Anzahl/Abstand.
5. **Bemaßen** (D):
   - Linie, Kreis, Bogen, zwei Punkte oder zwei Linien wählen und die Bemaßung platzieren.
   - Der Wert ist sofort editierbar, ein Doppelklick ändert ihn später.
6. **Abhängigkeiten**: Horizontal/Vertikal (H), Koinzident, Parallel, Senkrecht, Tangential, Gleich, Mittelpunkt, Konzentrisch, Kollinear, Symmetrisch, Fixieren.
   - Blau ist noch beweglich, schwarz ist vollständig bestimmt.
   - Widersprüchliche Abhängigkeiten werden abgelehnt.
7. **Skizze beenden** (Strg+Enter).
8. **Extrudieren** (E) oder **Drehen**:
   - Ohne Auswahl werden die äußeren Profile genommen, Löcher bleiben also Löcher.
   - Im Ansichtsfenster Profile anklicken, um sie hinzuzufügen oder zu entfernen.
   - Drehen geht um eine Skizzenachse oder eine gewählte Linie.
9. **Bohrung** (H): an freien Punkten und Kreismittelpunkten einer Skizze. Einfach, Senkbohrung (Zylinderkopf) oder Kegelsenkung, Tiefe oder durch alles, Vorlagen M2–M8 für Durchgang, Zylinderkopf, Senkkopf, Gewindeeinsatz und Kernloch.
10. **Konstruktionsebene**: Ursprungsebene, Körperfläche oder andere Ebene anklicken, dann Versatz und Neigung einstellen. Skizzen lassen sich darauf anlegen; ein Klick auf eine schräge Fläche bei „Skizze erstellen“ legt die Ebene automatisch an.
11. **Abrunden** (F), **Fase**, **Schale**:
   - Das Feature anlegen und im Ansichtsfenster Kanten bzw. die offen bleibenden Flächen anklicken.
   - Das Ergebnis ist sofort sichtbar. Die Kanten vor dem Feature bleiben als feine Linien anklickbar.
   - Radius, Abstand, Wandstärke und die Tiefe der Schale sind Ausdrücke. Ohne Tiefe wird ganz ausgehöhlt.
12. **Zeitleiste**:
   - Unterdrücken, bis zu einem Feature zurückrollen (neue Features landen am Marker)
   - Doppelklick auf eine Skizze bearbeitet sie.
   - Sie zeigt immer das aktive Bauteil (grüner Punkt im Browser); jedes Bauteil hat seinen eigenen Marker.
13. **Parameter** treiben Bemaßungen und Abstände, z. B. `wand * 2 + 0.4`.
14. **Rückgängig/Wiederholen** mit Strg+Z / Strg+Y.
15. **3D-Druck** (Panel rechts):
    - Gewicht, Filamentlänge und Volumen, geschätzt bei 100 % Füllung
    - Prüft, ob das Teil aufs Druckbett passt (auch um 90° gedreht)
    - Überhänge über dem eingestellten Winkel und Wände unter der Mindestwandstärke, beides im Ansichtsfenster markierbar
    - Drucker-Vorlagen oder eigene Bettgröße, Material, Düse; gespeichert im Browser
16. **Als 3MF exportieren** (Strg+E) für den Slicer, außerdem STL und **STEP** für andere CAD-Programme.

**Bauteile und Beziehungen**
- **Neues Bauteil** legt ein Bauteil an und macht es aktiv: Neue Skizzen und Features landen dort und wirken nur auf dessen Körper. Im Browser aktiviert der Kreis neben dem Namen ein Bauteil, das Auge blendet es aus.
- **Ausrichten** und **Gelenk** (J) legen eine Beziehung an: erst Bezug 1 am stehenden, dann Bezug 2 am beweglichen Bauteil anklicken – eine ebene Fläche (Mitte und Normale), eine Kreiskante (Mittelpunkt und Achse, ideal für Scharniere) oder eine gerade Kante (Kantenmitte, Richtung entlang der Kante). So liegt z. B. die untere Kante eines Bauteils an der oberen Kante eines anderen.
- **Ausrichtungen** legen nur fest, was die Bezüge sagen, und lassen sich kombinieren:
  - Fläche ↔ Fläche: in einer Ebene (*aufeinander* oder *bündig*, mit Abstand) – Verschieben in der Ebene und Drehen bleiben frei,
  - Kante ↔ Kante: auf einer Linie (gleich gerichtet oder gegenläufig),
  - Kreiskante ↔ Kreiskante: gleiche Achse, mit Abstand entlang der Achse,
  - Kante ↔ Fläche: Kante in der Ebene; Kreiskante ↔ Fläche: Kreis auf der Fläche; Kreiskante ↔ Kante: Mittelpunkt auf der Linie.
  Ein Löser findet die Lage, die alle Ausrichtungen erfüllt und der eigenen Lage des Bauteils am nächsten ist. Beispiel: Fläche auf Fläche plus zwei Kanten an Kanten legen ein Bauteil vollständig fest. Was frei bleibt, verschiebt *Bauteil bewegen*; Widersprüche werden als Problem gemeldet.
- **Gelenke** (*Scharnier*, *Schiebe*, *Zylinder*, *Planar*, *Kugel*) verbinden zwei Bezüge als Ganzes; die beweglichen Werte haben Schieberegler, *Aufeinander*/*Bündig* legt fest, ob die Achsen gegeneinander oder gleich gerichtet liegen.
- In den Eigenschaften lassen sich Bezug 1 oder 2 einzeln neu wählen, die Bezüge tauschen (das andere Bauteil bewegt sich) und eine Ausrichtung *in die Lage übernehmen* (Position ins Bauteil schreiben, Beziehung entfernen).
- Das andockbare Panel **Beziehungen** zeigt je Bauteil, ob es *fixiert*, *bestimmt*, *beweglich*, teilweise bestimmt (*n frei*: verbleibende Freiheitsgrade) oder *frei* ist, und darunter seine Beziehungen (Bezugsarten, Gegenbauteil, aufeinander/bündig, Abstand); fehlende Bezüge und Probleme sind rot markiert, Unterdrücken und Löschen direkt dort.
- **Bauteil bewegen** (M): Griffe im Ansichtsfenster verschieben oder drehen das ausgewählte (sonst das aktive) Bauteil – ein Undo-Schritt je Zug. In Ausrichtungen gleitet es nur in deren freien Richtungen; Bauteile an Gelenken bewegt man über deren Werte.
- **Verschrauben** (B): je Schraube die beiden Bohrungskanten an den Berührflächen anklicken – erst im Bauteil auf der Kopfseite, dann auf der Mutterseite; beliebig viele Schrauben in einer Verschraubung. Die Bohrungsachsen werden gefluchtet – nachgiebig: Eine Schraube platziert nur, was sonst nichts hält, und verschiebt keine Bauteile, die andere Beziehungen festlegen; passen die Bohrungen dann nicht, meldet sie den Versatz. Der *Abstand* zwischen den Bohrungskanten ist leer, die Teile bleiben also auf Abstand (z. B. mit Hohlraum dazwischen); 0 zieht sie zusammen.
  - Schraube (ISO 4762, 4017, 7380, 10642), Größe M2–M8, Scheiben ISO 7089 unter Kopf und Mutter, Mutter ISO 4032, 4035, 10511 oder keine (Gewinde im Bauteil oder Einschmelzmutter).
  - Die Klemmlänge misst ribo entlang der Bohrung an den Körpern und wählt die passende Normlänge (Gewindeüberstand 2 Gänge; ohne Mutter die längste, die im Gegenstück bleibt und 1,5–2 × d fasst). Geprüft werden zu kurz, zu lang, Bohrung gegen Durchgangsloch nach ISO 273 und sich durchdringende Teile.
  - Die Bohrungsachse zeigt aus der Fläche heraus, auf der die Kante liegt; die beiden Berührflächen liegen dadurch aufeinander. Liegt ein Bauteil falsch herum, dreht *Umkehren* es um.
  - Schraube, Scheiben und Mutter erscheinen als vereinfachte Körper in der Baugruppe (grau, rot bei Problemen, hervorgehoben wenn ausgewählt) – nicht im Export, nicht im Druck. Geprüft wird, ob Kopf, Scheiben und Mutter Platz haben (Senkung zu klein oder zu flach, Mutter stößt an).
  - Das Anzugsmoment steht als Normwert für 8.8 auf Stahl dabei – in Druckteilen nur handfest anziehen.
  - Das Panel **Stückliste** zählt Schrauben, Muttern und Scheiben aller Verschraubungen und exportiert sie als CSV.
- Bauteile ohne Beziehung liegen an ihrer eigenen Position und Drehung; *Fixiert* hält ein Bauteil fest. Exportiert wird in der zusammengebauten Lage.

**Fenster**: Browser, Zeitleiste, Eigenschaften und 3D-Druck lassen sich am Titel in einen anderen Bereich (links, rechts, unten) ziehen, mit ⧉ herauslösen und als Fenster frei verschieben; am Rand rasten sie wieder ein. Liegen mehrere Panels übereinander, verteilt der Trenner dazwischen die Höhe. „Fensteranordnung zurücksetzen“ stellt den Anfang wieder her.

Navigation in 3D: links drehen, rechts oder Mitte verschieben, das Rad zoomt zum Mauszeiger. In der Skizze verschieben die rechte und die mittlere Taste.

Gespeichert wird als emfts-JSON (`.ribo.json`, Strg+S) nach dem Modell `packages/ribo-model/model/ribo.ecore` – mit Features, Zeitleiste (Reihenfolge und Marker je Bauteil), Skizzen samt Abhängigkeiten, Bauteilen und Gelenken. Öffnen liest auch XMI. Der letzte Stand liegt außerdem automatisch im Browser.

## Aufbau

Der Aufbau folgt gene. Eine dünne Vite-App (`src/main.ts`) registriert die Shared Libraries und lädt die TSM-Module aus `packages/*`, jedes mit eigener `manifest.json`. Module sprechen nur über Services aus `ribo-contracts` miteinander.

| Paket | Aufgabe |
|---|---|
| `ribo-contracts` | Service-IDs und Typen, kein Verhalten. `geometry.ts` ist worker-tauglich. |
| `ribo-model` | `model/ribo.ecore` → generierter Code (`src/generated`, **nicht editieren**) + Typ-Guards |
| `ribo-app` | Vue-Shell, Toolbar, andockbare und lösbare Panels, Action-Registry, Tastenkürzel, Toasts |
| `ribo-kernel` | replicad/OpenCascade im Web Worker: Plan → Körper → Mesh, STL/STEP |
| `ribo-geometry` | 2D-Geometrie: Schnittpunkte, nächster Punkt, Profilerkennung (Regionen mit Löchern) |
| `ribo-document` | aktuelles Design, Ausdrücke, Skizzen-Solver (PlaneGCS), Baugruppen-Kinematik, Undo/Redo, Plan-Compiler, Rebuild |
| `ribo-viewport` | three.js-Ansicht (Z oben, 220-mm-Druckbett), 2D-Skizzenansicht, Ebenen- und Profilwahl |
| `ribo-sketcher` | Skizzenmodus: Werkzeuge, Abhängigkeiten, Bemaßungen, SVG-Overlay, Skizzenpalette |
| `ribo-timeline` | Objektbrowser (Design, Bauteile, Skizzen, Features, Körper), Beziehungen, Zeitleiste mit Marker, Erstell-Aktionen, Undo/Redo |
| `ribo-properties` | Eigenschaften des gewählten Objekts |
| `ribo-fasteners` | Verschrauben (Aktion), Stückliste mit CSV-Export |
| `ribo-parts` | Bibliothek: Normteil-Katalog (ISO-Schrauben, Muttern, Scheiben, ISO 273), Klemmlänge per Strahl durch die Körper, Schraubenwahl |
| `ribo-print` | Druck-Checks (Bett, Überhänge, Wandstärke per BVH-Raycasting), Materialabschätzung, Export |
| `ribo-io` | Neu, Öffnen, Speichern, Autosave, Export (3MF, STL, STEP) |

Der Datenfluss sieht so aus:
1. Der `Design`-Baum ist ein EMF-Modell.
2. Ein `EContentAdapter` an der Wurzel meldet jede Änderung. Die Änderungen einer Aufgabe werden in einer Microtask gesammelt.
3. In dieser Microtask werden zuerst alle Skizzen gelöst, denn Parameter treiben Bemaßungen. Daraus entsteht der `BuildPlan` als reine Daten, mit erkannten Profilen.
4. Den Plan baut der Kernel-Worker entprellt nach.

Undo arbeitet wie `useHistory` im Board: Notifications werden aufgezeichnet und invertiert. Was der Solver schreibt, gilt als abgeleitet und landet nicht in der History.

EObjects stehen nur in `shallowRef`, nie in `reactive()`. Warum, steht in `useEmf.ts` im Board.

### Modell ändern

```bash
# packages/ribo-model/model/ribo.ecore bearbeiten, dann:
npm run generate
```

`@emfts/codegen` ist auf `0.0.2-next.4` gepinnt und bekommt über `overrides` sein eigenes `@emfts/core` 0.2. Grund: Mit core 0.3 bleibt die `ecorePackage`-Referenz der genconfig unaufgelöst, und es entstehen nur `RiboPackage` und `RiboFactory` ohne Klassen. Die App selbst nutzt core 0.3.

## Bekannte Grenzen

- Der Solver ändert beim Hinzufügen einer Abhängigkeit manchmal mehr Geometrie als nötig (DogLeg von PlaneGCS).
- Muster in der Skizze sind Kopien ohne Verknüpfung zum Original; Spiegeln und Versatz bleiben über Abhängigkeiten gekoppelt.
- Bohrungen modellieren kein Gewinde, sie bohren das passende Kernloch bzw. die Aufnahme für Einschmelzmuttern.
- Gewählte Kanten und Flächen werden über ihre Lage gemerkt (Toleranz 0,5 mm). Verschiebt eine Maßänderung sie weiter, meldet das Feature „nicht mehr gefunden“, und man wählt sie neu.
- Eine Schale, deren offene Fläche an eine Rundung grenzt, schafft OpenCascade nicht. Dann die Schale vor dem Abrunden anlegen (Zeitleiste zurückrollen).
- Die Enum-Attribute haben im generierten Package keinen `eType` (#83). Die Werte werden als Literal-Strings gespeichert.

## Nächste Schritte

1. ~~Gerüst und Modell, Extrude/Revolve, Viewport, STL~~
2. ~~Sketcher mit Constraints (PlaneGCS), Timeline mit Rollback, Undo/Redo~~
3. ~~Abrunden, Fase und Schale mit Kanten- und Flächenauswahl im Ansichtsfenster~~
4. ~~3MF-Export und Druck-Checks (Wanddicke, Überhänge, Bett-Passung)~~
