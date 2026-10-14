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
```

## Bedienung (Stand Schritt 4)

Der Ablauf orientiert sich an Fusion 360:

1. **Skizze erstellen** (S): Eine Ursprungsebene oder eine ebene Körperfläche anklicken. Die Ansicht dreht sich dann senkrecht auf die Ebene und wechselt in die flache 2D-Ansicht.
2. **Zeichnen**:
   - Linie (L), Rechteck mit 2 Punkten (R) oder vom Mittelpunkt aus
   - Kreis (C), 3-Punkt-Bogen (A), Polygon (P), Langloch, Punkt
   - Maße beim Zeichnen einfach eintippen. Tab wechselt das Feld, Enter übernimmt. Ausdrücke wie `breite/2` sind erlaubt.
   - Endpunkte fangen auf Punkte, Mittelpunkte und Kurven. Fast waagrechte oder senkrechte Linien bekommen automatisch H/V.
3. **Ändern**: Abrunden (F), Stutzen (T), Hilfsgeometrie (X).
4. **Bemaßen** (D):
   - Linie, Kreis, Bogen, zwei Punkte oder zwei Linien wählen und die Bemaßung platzieren.
   - Der Wert ist sofort editierbar, ein Doppelklick ändert ihn später.
5. **Abhängigkeiten**: Horizontal/Vertikal (H), Koinzident, Parallel, Senkrecht, Tangential, Gleich, Mittelpunkt, Konzentrisch, Kollinear, Symmetrisch, Fixieren.
   - Blau ist noch beweglich, schwarz ist vollständig bestimmt.
   - Widersprüchliche Abhängigkeiten werden abgelehnt.
6. **Skizze beenden** (Strg+Enter).
7. **Extrudieren** (E) oder **Drehen**:
   - Ohne Auswahl werden die äußeren Profile genommen, Löcher bleiben also Löcher.
   - Im Ansichtsfenster Profile anklicken, um sie hinzuzufügen oder zu entfernen.
   - Drehen geht um eine Skizzenachse oder eine gewählte Linie.
8. **Abrunden** (F), **Fase**, **Schale**:
   - Das Feature anlegen und im Ansichtsfenster Kanten bzw. die offen bleibenden Flächen anklicken.
   - Das Ergebnis ist sofort sichtbar. Die Kanten vor dem Feature bleiben als feine Linien anklickbar.
   - Radius, Abstand, Wandstärke und die Tiefe der Schale sind Ausdrücke. Ohne Tiefe wird ganz ausgehöhlt.
9. **Zeitleiste**:
   - Unterdrücken, bis zu einem Feature zurückrollen (neue Features landen am Marker)
   - Doppelklick auf eine Skizze bearbeitet sie.
10. **Parameter** treiben Bemaßungen und Abstände, z. B. `wand * 2 + 0.4`.
11. **Rückgängig/Wiederholen** mit Strg+Z / Strg+Y.
12. **3D-Druck** (Panel rechts):
    - Gewicht, Filamentlänge und Volumen, geschätzt bei 100 % Füllung
    - Prüft, ob das Teil aufs Druckbett passt (auch um 90° gedreht)
    - Überhänge über dem eingestellten Winkel und Wände unter der Mindestwandstärke, beides im Ansichtsfenster markierbar
    - Drucker-Vorlagen oder eigene Bettgröße, Material, Düse; gespeichert im Browser
13. **Als 3MF exportieren** (Strg+E) für den Slicer, außerdem STL und **STEP** für andere CAD-Programme.

Navigation in 3D: links drehen, rechts oder Mitte verschieben, das Rad zoomt zum Mauszeiger. In der Skizze verschieben die rechte und die mittlere Taste.

Gespeichert wird als emfts-JSON (`.ribo.json`, Strg+S). Der letzte Stand liegt außerdem automatisch im Browser.

## Aufbau

Der Aufbau folgt gene. Eine dünne Vite-App (`src/main.ts`) registriert die Shared Libraries und lädt die TSM-Module aus `packages/*`, jedes mit eigener `manifest.json`. Module sprechen nur über Services aus `ribo-contracts` miteinander.

| Paket | Aufgabe |
|---|---|
| `ribo-contracts` | Service-IDs und Typen, kein Verhalten. `geometry.ts` ist worker-tauglich. |
| `ribo-model` | `model/ribo.ecore` → generierter Code (`src/generated`, **nicht editieren**) + Typ-Guards |
| `ribo-app` | Vue-Shell, Toolbar, Panel- und Action-Registry, Tastenkürzel, Toasts |
| `ribo-kernel` | replicad/OpenCascade im Web Worker: Plan → Körper → Mesh, STL/STEP |
| `ribo-geometry` | 2D-Geometrie: Schnittpunkte, nächster Punkt, Profilerkennung (Regionen mit Löchern) |
| `ribo-document` | aktuelles Design, Ausdrücke, Skizzen-Solver (PlaneGCS), Undo/Redo, Plan-Compiler, Rebuild |
| `ribo-viewport` | three.js-Ansicht (Z oben, 220-mm-Druckbett), 2D-Skizzenansicht, Ebenen- und Profilwahl |
| `ribo-sketcher` | Skizzenmodus: Werkzeuge, Abhängigkeiten, Bemaßungen, SVG-Overlay, Skizzenpalette |
| `ribo-timeline` | Browser: Parameter und Zeitleiste mit Rollback, Extrudieren/Drehen, Undo/Redo |
| `ribo-properties` | Eigenschaften des gewählten Objekts |
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

- Die Produktions-Builds der Module fehlen noch. `npm run build` baut nur den Host, die Module kommen im Dev-Server über `/plugins`.
- Skizzen liegen auf Ursprungsebenen mit Versatz. Ebene Flächen, die zu einer Ursprungsebene parallel sind, lassen sich anklicken; schräge Ebenen noch nicht.
- Der Solver ändert beim Hinzufügen einer Abhängigkeit manchmal mehr Geometrie als nötig (DogLeg von PlaneGCS).
- Offset, Spiegeln und Muster in der Skizze fehlen noch.
- Gewählte Kanten und Flächen werden über ihre Lage gemerkt (Toleranz 0,5 mm). Verschiebt eine Maßänderung sie weiter, meldet das Feature „nicht mehr gefunden“, und man wählt sie neu.
- Eine Schale, deren offene Fläche an eine Rundung grenzt, schafft OpenCascade nicht. Dann die Schale vor dem Abrunden anlegen (Zeitleiste zurückrollen).
- Die Enum-Attribute haben im generierten Package keinen `eType` (#83). Die Werte werden als Literal-Strings gespeichert.

## Nächste Schritte

1. ~~Gerüst und Modell, Extrude/Revolve, Viewport, STL~~
2. ~~Sketcher mit Constraints (PlaneGCS), Timeline mit Rollback, Undo/Redo~~
3. ~~Abrunden, Fase und Schale mit Kanten- und Flächenauswahl im Ansichtsfenster~~
4. ~~3MF-Export und Druck-Checks (Wanddicke, Überhänge, Bett-Passung)~~
