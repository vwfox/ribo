<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import type { DocumentService } from 'ribo-contracts'
import {
  ExtentDirection,
  FeatureOperation,
  SketchAxis,
  SketchPlane,
  isComponent,
  isDesign,
  isConstructionPlane,
  isEdgeFeature,
  isJoint,
  isExtrude,
  isFillet,
  isHole,
  isLine,
  isShell,
  isParameter,
  isProfileFeature,
  isRevolve,
  isSketch,
  type Sketch,
  type SketchLine,
} from 'ribo-model'
import ToggleSwitch from 'primevue/toggleswitch'
import Slider from 'primevue/slider'
import { HoleType, type Hole } from 'ribo-model'
import ExpressionField from './ExpressionField.vue'
import { HOLE_PRESETS } from './holePresets'
import './fields.css'

const props = defineProps<{ document: DocumentService; editSketch: (sketch: Sketch) => void }>()

const selected = computed(() => props.document.selection.value)
const design = computed(() => props.document.design.value)

const PLANES = [
  { label: 'XY (oben)', value: SketchPlane.XY },
  { label: 'XZ (vorne)', value: SketchPlane.XZ },
  { label: 'YZ (rechts)', value: SketchPlane.YZ },
]
const OPERATIONS = [
  { label: 'Neuer Körper', value: FeatureOperation.NewBody },
  { label: 'Verbinden', value: FeatureOperation.Join },
  { label: 'Ausschneiden', value: FeatureOperation.Cut },
  { label: 'Schnittmenge', value: FeatureOperation.Intersect },
]
const DIRECTIONS = [
  { label: 'Eine Seite', value: ExtentDirection.OneSide },
  { label: 'Umgekehrt', value: ExtentDirection.Reversed },
  { label: 'Symmetrisch', value: ExtentDirection.Symmetric },
]

const parameterValue = computed(() => {
  void props.document.revision.value
  const parameter = selected.value
  if (!isParameter(parameter)) return undefined
  return props.document.parameterValues().get(parameter)
})

/*
 * Options carry indexes, not EObjects: PrimeVue compares option values deeply,
 * and an EObject's containment graph is cyclic.
 */

/** Sketches the selected feature may use: the ones before it in the timeline */
const sketches = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  return isProfileFeature(feature) ? props.document.sketchesBefore(feature) : []
})
const sketchOptions = computed(() => sketches.value.map((sketch, index) => ({ label: sketch.name, value: index })))
const sketchIndex = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  if (!isProfileFeature(feature) || !feature.sketch) return undefined
  const index = sketches.value.indexOf(feature.sketch)
  return index < 0 ? undefined : index
})

function setSketch(index: number | undefined) {
  const feature = selected.value
  const sketch = index === undefined ? undefined : sketches.value[index]
  if (!isProfileFeature(feature) || feature.sketch === sketch) return
  props.document.history.record('Skizze wählen', () => {
    feature.profiles.clear()
    if (isRevolve(feature)) feature.axisLine = undefined as never
    feature.sketch = sketch as Sketch
  })
}

const profileInfo = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  if (!isProfileFeature(feature) || !feature.sketch) return undefined
  const index = design.value.features.indexOf(feature)
  const planned = props.document.plan.value.features.find((f) => (f.kind === 'extrude' || f.kind === 'revolve') && f.index === index)
  const regions = props.document.sketchPlan(feature.sketch)?.regions.length ?? 0
  return {
    automatic: feature.profiles.size() === 0,
    used: planned && (planned.kind === 'extrude' || planned.kind === 'revolve') ? planned.profiles.length : 0,
    regions,
  }
})

const PLANE_BASES: Record<string, string> = {
  XY: 'Ursprungsebene XY',
  XZ: 'Ursprungsebene XZ',
  YZ: 'Ursprungsebene YZ',
  Face: 'Körperfläche',
  Plane: 'andere Konstruktionsebene',
}

const TILT_AXES = [
  { label: 'um X', value: SketchAxis.X },
  { label: 'um Y', value: SketchAxis.Y },
]

const JOINT_KINDS = [
  { label: 'Ausrichtung', value: 'Rigid' },
  { label: 'Scharnier', value: 'Revolute' },
  { label: 'Schiebe', value: 'Slider' },
  { label: 'Zylinder', value: 'Cylindrical' },
  { label: 'Planar', value: 'Planar' },
  { label: 'Kugel', value: 'Ball' },
]

const FACINGS = [
  { label: 'Aufeinander', value: false },
  { label: 'Bündig', value: true },
]

/** What an alignment of two reference kinds holds; the rest stays free for further alignments or moving by hand */
const ALIGNMENT_HINTS: Record<string, string> = {
  'Face-Face': 'Die Flächen liegen in einer Ebene. Verschieben in der Ebene und Drehen bleiben frei – z. B. mit einer Kante an Kante festlegen.',
  'Edge-Edge': 'Die Kanten liegen auf einer Linie. Entlang der Kante und um sie bleibt das Bauteil frei.',
  'CircularEdge-CircularEdge': 'Die Achsen fallen zusammen. Drehen um die Achse bleibt frei.',
  'Edge-Face': 'Die Kante liegt in der Ebene der Fläche.',
  'CircularEdge-Face': 'Der Kreis liegt auf der Fläche, seine Achse steht senkrecht darauf.',
  'CircularEdge-Edge': 'Der Kreismittelpunkt liegt auf der Linie der Kante.',
}

const EDGE_SENSES = [
  { label: 'Gleich gerichtet', value: false },
  { label: 'Gegenläufig', value: true },
]

type JointValue = 'angle' | 'offset' | 'shiftX' | 'shiftY' | 'tiltX' | 'tiltY'

interface JointControl {
  key: JointValue
  label: string
  unit: string
  /** Moved with a slider; the others are fixed offsets */
  moves: boolean
  range: [number, number]
}

const ANGLE: [number, number] = [-180, 180]
const TRAVEL: [number, number] = [-100, 100]

/** Which values each joint kind offers, and which of them it moves */
const JOINT_CONTROLS: Record<string, JointControl[]> = {
  Rigid: [{ key: 'offset', label: 'Abstand', unit: 'mm', moves: false, range: TRAVEL }],
  Revolute: [
    { key: 'angle', label: 'Winkel', unit: '°', moves: true, range: ANGLE },
    { key: 'offset', label: 'Versatz entlang der Achse', unit: 'mm', moves: false, range: TRAVEL },
  ],
  Slider: [
    { key: 'offset', label: 'Weg', unit: 'mm', moves: true, range: TRAVEL },
    { key: 'angle', label: 'Drehung um die Achse', unit: '°', moves: false, range: ANGLE },
  ],
  Cylindrical: [
    { key: 'angle', label: 'Winkel', unit: '°', moves: true, range: ANGLE },
    { key: 'offset', label: 'Weg entlang der Achse', unit: 'mm', moves: true, range: TRAVEL },
  ],
  Planar: [
    { key: 'shiftX', label: 'Verschiebung X', unit: 'mm', moves: true, range: TRAVEL },
    { key: 'shiftY', label: 'Verschiebung Y', unit: 'mm', moves: true, range: TRAVEL },
    { key: 'angle', label: 'Drehung', unit: '°', moves: true, range: ANGLE },
    { key: 'offset', label: 'Abstand der Flächen', unit: 'mm', moves: false, range: TRAVEL },
  ],
  Ball: [
    { key: 'tiltX', label: 'Neigung X', unit: '°', moves: true, range: [-90, 90] },
    { key: 'tiltY', label: 'Neigung Y', unit: '°', moves: true, range: [-90, 90] },
    { key: 'angle', label: 'Drehung', unit: '°', moves: true, range: ANGLE },
  ],
}

const jointControls = computed(() => {
  const joint = selected.value
  if (!isJoint(joint)) return []
  // Two edges on one line have no distance
  if (alignmentKinds.value === 'Edge-Edge' || alignmentKinds.value === 'CircularEdge-Edge') return []
  return JOINT_CONTROLS[joint.kind ?? 'Rigid'] ?? []
})

/** The pair of reference kinds of a selected alignment, sorted, e.g. 'Edge-Face'; undefined for joints */
const alignmentKinds = computed(() => {
  void props.document.revision.value
  const joint = selected.value
  if (!isJoint(joint) || (joint.kind ?? 'Rigid') !== 'Rigid') return undefined
  return [joint.first?.kind ?? 'Face', joint.second?.kind ?? 'Face'].sort().join('-')
})

/** What the facing choice means for the selected relation, or undefined when it has none */
const facings = computed(() => {
  const kinds = alignmentKinds.value
  if (kinds === undefined || kinds === 'Face-Face') return FACINGS
  if (kinds === 'Edge-Edge') return EDGE_SENSES
  return undefined
})

/** A joint value as a number, for its slider; expressions that are no plain number show 0 */
function jointNumber(key: JointValue): number {
  void props.document.revision.value
  const joint = selected.value
  if (!isJoint(joint)) return 0
  const value = Number(joint[key])
  return Number.isFinite(value) ? value : 0
}

let sliding = false
/** Moving the joint by a slider is one undo step per gesture */
function slide(key: JointValue, value: number | number[]) {
  const joint = selected.value
  if (!isJoint(joint)) return
  if (!sliding) {
    sliding = true
    props.document.history.begin('Gelenk bewegen')
  }
  joint[key] = String(Math.round((Array.isArray(value) ? value[0]! : value) * 10) / 10)
}

function slideEnd() {
  if (!sliding) return
  sliding = false
  props.document.history.end()
}

/** Clears one origin: the next pick in the viewport sets it again */
function repickOrigin(which: 'first' | 'second') {
  const joint = selected.value
  if (!isJoint(joint)) return
  props.document.history.record('Bezug neu wählen', () => {
    joint[which] = undefined as never
  })
}

const ORIGIN_KINDS: Record<string, string> = { Face: 'Fläche', CircularEdge: 'Kreiskante', Edge: 'Kante' }

const originName = (origin: { component?: { name?: string }; kind?: string } | undefined) =>
  origin ? `${ORIGIN_KINDS[origin.kind ?? 'Face'] ?? 'Fläche'} an ${origin.component?.name ?? 'Hauptbauteil'}` : 'noch nicht gewählt'

const HOLE_TYPES = [
  { label: 'Einfach', value: HoleType.Simple },
  { label: 'Senkbohrung', value: HoleType.Counterbore },
  { label: 'Senkung', value: HoleType.Countersink },
]

const presetOptions = [
  { label: 'Eigene Werte', value: '' },
  ...HOLE_PRESETS.map((p) => ({ label: p.label, value: p.label, group: p.group })),
]

/** Sketches a hole may use: the ones before it */
const holeSketches = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  return isHole(feature) ? props.document.sketchesBefore(feature) : []
})
const holeSketchOptions = computed(() => holeSketches.value.map((sketch, index) => ({ label: sketch.name, value: index })))
const holeSketchIndex = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  if (!isHole(feature) || !feature.sketch) return undefined
  const index = holeSketches.value.indexOf(feature.sketch)
  return index < 0 ? undefined : index
})

function setHoleSketch(index: number) {
  const feature = selected.value
  if (isHole(feature)) feature.sketch = holeSketches.value[index]!
}

const holeCount = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  if (!isHole(feature) || !feature.sketch) return 0
  const index = design.value.features.indexOf(feature)
  const planned = props.document.plan.value.features.find((f) => f.kind === 'hole' && f.index === index)
  return planned?.kind === 'hole' ? planned.centers.length : 0
})

/** Fills the hole's values from a preset */
function applyPreset(label: string) {
  const hole = selected.value as Hole
  props.document.history.record('Bohrungsvorlage', () => {
    hole.preset = label
    const preset = HOLE_PRESETS.find((p) => p.label === label)
    if (!preset) return
    hole.holeType = preset.type
    hole.diameter = preset.diameter
    hole.depth = preset.depth ?? ''
    if (preset.headDiameter) hole.headDiameter = preset.headDiameter
    if (preset.headDepth) hole.headDepth = preset.headDepth
    if (preset.countersinkAngle) hole.countersinkAngle = preset.countersinkAngle
  })
}

/** Removes all picked edges or faces of the selected fillet, chamfer or shell */
function clearPicks() {
  const feature = selected.value
  props.document.history.record('Auswahl leeren', () => {
    if (isEdgeFeature(feature)) feature.edges.clear()
    else if (isShell(feature)) feature.faces.clear()
  })
}

function resetProfiles() {
  const feature = selected.value
  if (isProfileFeature(feature)) props.document.history.record('Profile automatisch', () => feature.profiles.clear())
}

/** Axis options of a revolve: the sketch axes and the lines of its sketch */
const axisLines = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  if (!isRevolve(feature) || !feature.sketch) return []
  return feature.sketch.curves.toArray().filter((c): c is SketchLine => isLine(c))
})
const axisOptions = computed(() => [
  { label: 'X-Achse der Skizze', value: 'X' },
  { label: 'Y-Achse der Skizze', value: 'Y' },
  ...axisLines.value.map((line, i) => ({
    label: `${line.construction ? 'Hilfslinie' : 'Linie'} ${i + 1} (${Math.round(line.start.x)}, ${Math.round(line.start.y)} → ${Math.round(line.end.x)}, ${Math.round(line.end.y)})`,
    value: `line:${i}`,
  })),
])
const axisValue = computed(() => {
  void props.document.revision.value
  const feature = selected.value
  if (!isRevolve(feature)) return undefined
  if (feature.axisLine) return `line:${axisLines.value.indexOf(feature.axisLine)}`
  return feature.axis ?? 'Y'
})

function setAxis(value: string) {
  const feature = selected.value
  if (!isRevolve(feature)) return
  props.document.history.record('Drehachse', () => {
    if (value.startsWith('line:')) {
      feature.axisLine = axisLines.value[Number(value.slice(5))]!
    } else {
      feature.axisLine = undefined as never
      feature.axis = value as SketchAxis
    }
  })
}
</script>

<template>
  <!-- Reading the revision here re-renders the panel on every model change -->
  <div class="ribo-properties" :data-revision="document.revision.value">
    <!-- The design: the file as a whole -->
    <template v-if="isDesign(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name des Designs</span>
        <InputText :model-value="design.name" size="small" fluid @update:model-value="design.name = $event ?? ''" />
      </label>
      <p class="ribo-hint">
        {{ design.components.size() + 1 }} {{ design.components.size() ? 'Bauteile' : 'Bauteil' }} · {{ design.features.size() }} Features ·
        {{ design.parameters.size() }} Parameter
      </p>
    </template>

    <!-- Nothing selected: the root component -->
    <template v-else-if="!selected">
      <p class="ribo-hint">
        Ausgewählt ist das <strong>Hauptbauteil</strong>: alles, was nicht in einem eigenen Bauteil liegt. Es steht fest.
      </p>
      <label class="ribo-switch">
        <ToggleSwitch :model-value="design.visible" @update:model-value="design.visible = $event" />
        <span>Hauptbauteil sichtbar</span>
      </label>
      <p v-if="!design.features.size()" class="ribo-hint">
        Starte mit <strong>Skizze erstellen</strong> (S): Ebene oder ebene Fläche anklicken, zeichnen, bemaßen, Skizze beenden. Dann
        <strong>Extrudieren</strong> (E) und die Profile im Ansichtsfenster anklicken. Alle Maße sind Ausdrücke in mm bzw. Grad und können
        Parameter verwenden, z.&nbsp;B. <code>wand * 2 + 0.4</code>.
      </p>
    </template>

    <!-- Parameter -->
    <template v-else-if="isParameter(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid spellcheck="false" @update:model-value="selected.name = $event ?? ''" />
      </label>
      <label class="ribo-field">
        <span class="ribo-field-label">Ausdruck</span>
        <InputText
          :model-value="selected.expression"
          :invalid="parameterValue instanceof Error"
          size="small"
          fluid
          spellcheck="false"
          @update:model-value="selected.expression = $event ?? ''"
        />
        <small v-if="parameterValue instanceof Error" class="ribo-field-error">{{ parameterValue.message }}</small>
        <small v-else-if="parameterValue !== undefined" class="ribo-field-hint">= {{ Number(parameterValue.toFixed(3)) }}</small>
      </label>
      <label class="ribo-field">
        <span class="ribo-field-label">Kommentar</span>
        <InputText :model-value="selected.comment" size="small" fluid @update:model-value="selected.comment = $event ?? ''" />
      </label>
    </template>

    <!-- Sketch -->
    <template v-else-if="isSketch(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <Button label="Skizze bearbeiten" icon="pi pi-pencil" size="small" @click="editSketch(selected)" />
      <div v-if="selected.reference" class="ribo-field">
        <span class="ribo-field-label">Ebene</span>
        <div class="ribo-profile-info">
          <span><i class="pi pi-clone" /> {{ selected.reference.name }}</span>
          <Button label="Ebene zeigen" size="small" text @click="document.select(selected.reference)" />
        </div>
      </div>
      <div v-else class="ribo-field">
        <span class="ribo-field-label">Ebene</span>
        <Select
          :model-value="selected.plane"
          :options="PLANES"
          option-label="label"
          option-value="value"
          size="small"
          fluid
          @update:model-value="selected.plane = $event"
        />
      </div>
      <ExpressionField v-model="selected.offset" label="Versatz" unit="mm" :document="document" />
      <p class="ribo-hint">
        {{ selected.curves.size() }} Kurven · {{ document.sketchPlan(selected)?.regions.length ?? 0 }} geschlossene Profile
      </p>
      <div class="ribo-button-row">
        <Button label="Extrudieren" icon="pi pi-box" size="small" severity="secondary" @click="document.addExtrude(selected)" />
        <Button label="Drehen" icon="pi pi-sync" size="small" severity="secondary" @click="document.addRevolve(selected)" />
      </div>
    </template>

    <!-- Extrude / Revolve -->
    <template v-else-if="isProfileFeature(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <div class="ribo-field">
        <span class="ribo-field-label">Skizze</span>
        <Select
          :model-value="sketchIndex"
          :options="sketchOptions"
          option-label="label"
          option-value="value"
          placeholder="Skizze wählen"
          size="small"
          fluid
          @update:model-value="setSketch"
        />
      </div>
      <div v-if="profileInfo" class="ribo-field">
        <span class="ribo-field-label">Profile</span>
        <div class="ribo-profile-info">
          <span v-if="profileInfo.automatic">Automatisch: {{ profileInfo.used }} von {{ profileInfo.regions }} (äußere Profile)</span>
          <span v-else>{{ profileInfo.used }} von {{ profileInfo.regions }} angeklickt</span>
          <Button v-if="!profileInfo.automatic" label="Automatisch" size="small" text @click="resetProfiles" />
        </div>
        <small class="ribo-field-hint">Im Ansichtsfenster Profile anklicken, um sie zu wählen</small>
      </div>
      <div class="ribo-field">
        <span class="ribo-field-label">Vorgang</span>
        <Select
          :model-value="selected.operation"
          :options="OPERATIONS"
          option-label="label"
          option-value="value"
          size="small"
          fluid
          @update:model-value="selected.operation = $event"
        />
      </div>
      <template v-if="isExtrude(selected)">
        <ExpressionField v-model="selected.distance" label="Abstand" unit="mm" :document="document" />
        <div class="ribo-field">
          <span class="ribo-field-label">Richtung</span>
          <SelectButton
            :model-value="selected.direction"
            :options="DIRECTIONS"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            size="small"
            @update:model-value="selected.direction = $event"
          />
        </div>
      </template>
      <template v-else-if="isRevolve(selected)">
        <div class="ribo-field">
          <span class="ribo-field-label">Achse</span>
          <Select
            :model-value="axisValue"
            :options="axisOptions"
            option-label="label"
            option-value="value"
            size="small"
            fluid
            @update:model-value="setAxis"
          />
        </div>
        <ExpressionField v-model="selected.angle" label="Winkel" unit="°" :document="document" />
      </template>
    </template>

    <!-- Fillet / Chamfer -->
    <template v-else-if="isEdgeFeature(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <ExpressionField v-if="isFillet(selected)" v-model="selected.radius" label="Radius" unit="mm" :document="document" />
      <ExpressionField v-else v-model="(selected as any).distance" label="Abstand" unit="mm" :document="document" />
      <div class="ribo-field">
        <span class="ribo-field-label">Kanten</span>
        <div class="ribo-profile-info">
          <span>{{ selected.edges.size() }} gewählt</span>
          <Button v-if="selected.edges.size()" label="Leeren" size="small" text @click="clearPicks" />
        </div>
        <small class="ribo-field-hint">Kanten im Ansichtsfenster anklicken, ein erneuter Klick entfernt sie. Die feinen Linien sind die Kanten vor dem Feature.</small>
      </div>
    </template>

    <!-- Shell -->
    <template v-else-if="isShell(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <ExpressionField v-model="selected.thickness" label="Wandstärke (nach innen)" unit="mm" :document="document" />
      <ExpressionField
        v-model="selected.depth"
        label="Tiefe ab der offenen Fläche"
        unit="mm"
        empty-hint="leer = ganz aushöhlen, Boden so dick wie die Wand"
        :document="document"
      />
      <div class="ribo-field">
        <span class="ribo-field-label">Offene Flächen</span>
        <div class="ribo-profile-info">
          <span>{{ selected.faces.size() }} gewählt</span>
          <Button v-if="selected.faces.size()" label="Leeren" size="small" text @click="clearPicks" />
        </div>
        <small class="ribo-field-hint">Die Flächen anklicken, die offen bleiben sollen, z.&nbsp;B. die Oberseite einer Box.</small>
      </div>
    </template>

    <!-- Component -->
    <template v-else-if="isComponent(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <div class="ribo-button-row">
        <Button
          :label="design.activeComponent === selected ? 'Aktiv' : 'Aktivieren'"
          :icon="design.activeComponent === selected ? 'pi pi-circle-fill' : 'pi pi-circle'"
          :disabled="design.activeComponent === selected"
          size="small"
          severity="secondary"
          @click="document.activate(selected)"
        />
        <Button label="Zum Hauptbauteil" size="small" text @click="document.activate(undefined)" />
      </div>
      <label class="ribo-switch">
        <ToggleSwitch :model-value="selected.grounded" @update:model-value="selected.grounded = $event" />
        <span>Fixiert (bewegt sich durch Gelenke nicht)</span>
      </label>
      <label class="ribo-switch">
        <ToggleSwitch :model-value="selected.visible" @update:model-value="selected.visible = $event" />
        <span>Sichtbar</span>
      </label>
      <div class="ribo-field">
        <span class="ribo-field-label">Lage (gilt, solange kein Gelenk das Bauteil setzt)</span>
      </div>
      <div class="ribo-grid3">
        <ExpressionField v-model="selected.positionX" label="X" unit="mm" :document="document" />
        <ExpressionField v-model="selected.positionY" label="Y" unit="mm" :document="document" />
        <ExpressionField v-model="selected.positionZ" label="Z" unit="mm" :document="document" />
        <ExpressionField v-model="selected.rotationX" label="Drehung X" unit="°" :document="document" />
        <ExpressionField v-model="selected.rotationY" label="Drehung Y" unit="°" :document="document" />
        <ExpressionField v-model="selected.rotationZ" label="Drehung Z" unit="°" :document="document" />
      </div>
    </template>

    <!-- Joint -->
    <template v-else-if="isJoint(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <div class="ribo-field">
        <span class="ribo-field-label">Art</span>
        <SelectButton
          :model-value="selected.kind"
          :options="JOINT_KINDS"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          @update:model-value="selected.kind = $event"
        />
      </div>
      <div class="ribo-field">
        <span class="ribo-field-label">Bezüge</span>
        <span class="ribo-origin" :class="{ missing: !selected.first }">
          1: {{ originName(selected.first) }}
          <Button v-if="selected.first" v-tooltip="'Bezug 1 neu wählen'" icon="pi pi-refresh" size="small" text rounded @click="repickOrigin('first')" />
        </span>
        <span class="ribo-origin" :class="{ missing: !selected.second }">
          2: {{ originName(selected.second) }}
          <Button v-if="selected.second" v-tooltip="'Bezug 2 neu wählen'" icon="pi pi-refresh" size="small" text rounded @click="repickOrigin('second')" />
        </span>
        <small v-if="!selected.first || !selected.second" class="ribo-field-hint">
          Im Ansichtsfenster eine ebene Fläche, eine Kreiskante (Achse, z. B. für Scharniere) oder eine gerade Kante anklicken – Bezug 1 am Bauteil, das stehen bleibt,
          Bezug 2 am Bauteil, das sich bewegt.
        </small>
        <div v-else class="ribo-joint-actions">
          <Button label="Bezüge tauschen" icon="pi pi-arrow-right-arrow-left" size="small" text @click="document.swapJointOrigins(selected)" />
          <Button
            v-if="selected.kind === 'Rigid'"
            v-tooltip="'Das Bauteil bleibt in seiner jetzigen Lage stehen, die Ausrichtung wird entfernt'"
            label="In Lage übernehmen"
            icon="pi pi-check"
            size="small"
            text
            @click="document.applyAlignment(selected)"
          />
        </div>
      </div>
      <div v-if="facings" class="ribo-field">
        <span class="ribo-field-label">{{ facings === EDGE_SENSES ? 'Richtung der Kanten' : 'Lage zueinander' }}</span>
        <SelectButton
          :model-value="selected.flip"
          :options="facings"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          @update:model-value="selected.flip = $event"
        />
        <small v-if="facings === EDGE_SENSES" class="ribo-field-hint">Liegt das Bauteil auf der falschen Seite, die Richtung umschalten.</small>
      </div>
      <small v-if="alignmentKinds" class="ribo-field-hint">{{ ALIGNMENT_HINTS[alignmentKinds] }}</small>
      <template v-for="control in jointControls" :key="control.key">
        <ExpressionField v-model="selected[control.key]" :label="control.label" :unit="control.unit" :document="document" />
        <Slider
          v-if="control.moves"
          :model-value="jointNumber(control.key)"
          :min="control.range[0]"
          :max="control.range[1]"
          @update:model-value="slide(control.key, $event)"
          @slideend="slideEnd"
        />
      </template>
    </template>

    <!-- Construction plane -->
    <template v-else-if="isConstructionPlane(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <div class="ribo-field">
        <span class="ribo-field-label">Bezug</span>
        <span>{{ PLANE_BASES[selected.base] }}{{ selected.base === 'Plane' && selected.reference ? `: ${selected.reference.name}` : '' }}</span>
      </div>
      <ExpressionField v-model="selected.offset" label="Versatz entlang der Normalen" unit="mm" :document="document" />
      <ExpressionField v-model="selected.angle" label="Neigung" unit="°" :document="document" />
      <div class="ribo-field">
        <span class="ribo-field-label">Neigungsachse</span>
        <SelectButton
          :model-value="selected.tiltAxis"
          :options="TILT_AXES"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          @update:model-value="selected.tiltAxis = $event"
        />
      </div>
      <small class="ribo-field-hint">Neue Skizze auf dieser Ebene: „Skizze erstellen“ und die Ebene im Ansichtsfenster anklicken.</small>
    </template>

    <!-- Hole -->
    <template v-else-if="isHole(selected)">
      <label class="ribo-field">
        <span class="ribo-field-label">Name</span>
        <InputText :model-value="selected.name" size="small" fluid @update:model-value="selected.name = $event ?? ''" />
      </label>
      <div class="ribo-field">
        <span class="ribo-field-label">Skizze mit den Bohrpunkten</span>
        <Select
          :model-value="holeSketchIndex"
          :options="holeSketchOptions"
          option-label="label"
          option-value="value"
          placeholder="Skizze wählen"
          size="small"
          fluid
          @update:model-value="setHoleSketch"
        />
        <small class="ribo-field-hint">{{ holeCount }} Bohrung(en) – an freien Punkten und Kreismittelpunkten der Skizze</small>
      </div>
      <div class="ribo-field">
        <span class="ribo-field-label">Vorlage</span>
        <Select
          :model-value="selected.preset ?? ''"
          :options="presetOptions"
          option-label="label"
          option-value="value"
          filter
          size="small"
          fluid
          @update:model-value="applyPreset"
        />
      </div>
      <div class="ribo-field">
        <span class="ribo-field-label">Art</span>
        <SelectButton
          :model-value="selected.holeType"
          :options="HOLE_TYPES"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          @update:model-value="selected.holeType = $event"
        />
      </div>
      <ExpressionField v-model="selected.diameter" label="Durchmesser" unit="mm" :document="document" />
      <ExpressionField v-model="selected.depth" label="Tiefe" unit="mm" empty-hint="leer = durch alles" :document="document" />
      <template v-if="selected.holeType !== 'Simple'">
        <ExpressionField
          v-model="selected.headDiameter"
          :label="selected.holeType === 'Countersink' ? 'Senkdurchmesser' : 'Kopfdurchmesser'"
          unit="mm"
          :document="document"
        />
        <ExpressionField v-if="selected.holeType === 'Counterbore'" v-model="selected.headDepth" label="Senktiefe" unit="mm" :document="document" />
        <ExpressionField v-else v-model="selected.countersinkAngle" label="Senkwinkel" unit="°" :document="document" />
      </template>
      <label class="ribo-switch">
        <ToggleSwitch :model-value="selected.reversed" @update:model-value="selected.reversed = $event" />
        <span>Richtung umkehren</span>
      </label>
    </template>

    <div v-if="selected" class="ribo-actions">
      <Button
        v-if="isProfileFeature(selected) || isEdgeFeature(selected) || isShell(selected) || isHole(selected) || isJoint(selected)"
        v-tooltip.bottom="'Änderungen sind übernommen – schließt den Schritt (Enter)'"
        label="OK"
        icon="pi pi-check"
        severity="success"
        size="small"
        @click="document.select(undefined)"
      />
      <Button label="Löschen" icon="pi pi-trash" size="small" severity="danger" text @click="document.remove(selected)" />
    </div>
  </div>
</template>

<style scoped>
.ribo-origin {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.8rem;
}

.ribo-origin.missing {
  color: var(--p-orange-500);
}

.ribo-joint-actions {
  display: flex;
  flex-wrap: wrap;
}

.ribo-properties {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ribo-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.ribo-grid3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
}

.ribo-switch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ribo-profile-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.ribo-hint {
  margin: 0;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}

.ribo-actions {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--p-content-border-color);
  padding-top: 0.5rem;
}
</style>
