<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import type { DocumentService } from 'ribo-contracts'
import { isFastening, isJoint, type Component, type Fastening, type Joint, type JointOrigin } from 'ribo-model'
import { iconOf } from './icons'

const props = defineProps<{ document: DocumentService }>()

const KINDS: Record<string, string> = { Rigid: 'Ausrichtung', Revolute: 'Scharnier', Slider: 'Schiebe', Cylindrical: 'Zylinder', Planar: 'Planar', Ball: 'Kugel' }
const ORIGINS: Record<string, string> = { Face: 'Fläche', CircularEdge: 'Kreiskante', Edge: 'Kante' }

type RelationFeature = Joint | Fastening

interface Relation {
  joint: RelationFeature
  index: number
  /** Kind of relation, e.g. "Scharnier" */
  kind: string
  /** The other component, by name */
  other: string
  origins: string
  complete: boolean
}

interface Node {
  index: number
  component: Component | undefined
  name: string
  status: { label: string; icon: string; hint: string }
  relations: Relation[]
}

const nameOf = (index: number) => (index === 0 ? 'Hauptbauteil' : (props.document.componentAt(index)?.name ?? `Bauteil ${index}`))
const originText = (origin: JointOrigin | undefined) => (origin ? (ORIGINS[origin.kind ?? 'Face'] ?? 'Fläche') : '?')

/** The two references a relation ties: a screwed joint's first screw stands for it */
const endsOf = (feature: RelationFeature): [JointOrigin | undefined, JointOrigin | undefined] =>
  isFastening(feature) ? [feature.holes.toArray()[0]?.head, feature.holes.toArray()[0]?.nut] : [feature.first, feature.second]
const isComplete = (feature: RelationFeature) =>
  isFastening(feature) ? feature.holes.size() > 0 && feature.holes.toArray().every((h) => h.head && h.nut) : !!feature.first && !!feature.second
/** Holds like an alignment (only joints move) */
const isFixedRelation = (feature: RelationFeature) => isFastening(feature) || (feature.kind ?? 'Rigid') === 'Rigid'

const model = computed(() => {
  void props.document.revision.value
  const document = props.document
  const design = document.design.value
  const joints = design.features
    .toArray()
    .map((feature, index) => ({ feature, index }))
    .filter((j): j is { feature: RelationFeature; index: number } => isJoint(j.feature) || isFastening(j.feature))
  const sideOf = (origin: JointOrigin | undefined) => (origin ? document.componentIndexOf(origin.component ?? undefined) : undefined)

  const node = (index: number): Node => {
    const component = document.componentAt(index)
    // A relation is listed at the component it moves
    const relations = joints
      .filter(({ feature }) => document.movedBy(feature) === index)
      .map(({ feature, index: at }) => {
        const own = document.movedBy(feature)
        const [first, second] = endsOf(feature)
        const otherSide = first && second ? (sideOf(first) === own ? sideOf(second) : sideOf(first)) : undefined
        return {
          joint: feature,
          index: at,
          kind: isFastening(feature) ? 'Verschraubung' : (KINDS[feature.kind ?? 'Rigid'] ?? ''),
          other: otherSide === undefined || otherSide === own ? '–' : nameOf(otherSide),
          origins: isFastening(feature) ? `${feature.holes.size()}× ${feature.screw} ${feature.size}` : `${originText(first)} ↔ ${originText(second)}`,
          complete: isComplete(feature),
        }
      })
    const active = joints.filter(({ feature }) => {
      const [first, second] = endsOf(feature)
      return !feature.suppressed && first && second && (sideOf(first) === index || sideOf(second) === index)
    })
    let status: Node['status']
    if (index === 0 || component?.grounded) status = { label: 'fixiert', icon: 'pi pi-lock', hint: index === 0 ? 'Das Hauptbauteil steht fest' : 'Fixiert: bleibt an seiner Position' }
    else if (!active.length) status = { label: 'frei', icon: 'pi pi-arrows-alt', hint: 'Keine Beziehung – steht an seiner eigenen Position' }
    else if (active.some(({ feature }) => !isFixedRelation(feature))) status = { label: 'beweglich', icon: 'pi pi-sync', hint: 'Über Gelenke beweglich' }
    else {
      const left = document.freedom.value[index] ?? 0
      status = left
        ? { label: `${left} frei`, icon: 'pi pi-arrows-alt', hint: `Die Ausrichtungen lassen ${left} Freiheitsgrad${left === 1 ? '' : 'e'} – „Bauteil bewegen“ verschiebt darin, weitere Ausrichtungen legen fest` }
        : { label: 'bestimmt', icon: 'pi pi-check-circle', hint: 'Durch Ausrichtungen vollständig festgelegt' }
    }
    return { index, component, name: nameOf(index), status, relations }
  }
  return [node(0), ...design.components.toArray().map((_, i) => node(i + 1))]
})

const problems = computed(() => {
  const map = new Map<number, string[]>()
  for (const problem of props.document.problems.value) {
    if (!map.has(problem.index)) map.set(problem.index, [])
    map.get(problem.index)!.push(problem.message)
  }
  return map
})

function facing(joint: RelationFeature) {
  if (isFastening(joint)) return joint.offset && joint.offset !== '0' ? `Abstand ${joint.offset}` : ''
  const kinds = [joint.first?.kind ?? 'Face', joint.second?.kind ?? 'Face']
  const alignment = (joint.kind ?? 'Rigid') === 'Rigid'
  const parts: string[] = []
  if (!alignment || kinds.every((k) => k === 'Face')) parts.push(joint.flip ? 'bündig' : 'aufeinander')
  else if (kinds.every((k) => k === 'Edge')) parts.push(joint.flip ? 'gegenläufig' : 'gleich gerichtet')
  if (joint.offset && joint.offset !== '0') parts.push(`Abstand ${joint.offset}`)
  if (!alignment && joint.angle && joint.angle !== '0') parts.push(`${joint.angle}°`)
  return parts.join(' · ')
}

function toggleSuppressed(joint: RelationFeature) {
  props.document.history.record('Unterdrücken', () => {
    joint.suppressed = !joint.suppressed
  })
}

const isSelected = (joint: RelationFeature) => props.document.selection.value === joint
</script>

<template>
  <div class="ribo-relations" :data-revision="document.revision.value">
    <div class="ribo-relations-tools">
      <Button v-tooltip="'Ausrichtung: zwei Bezüge aufeinander legen'" label="Ausrichtung" icon="pi pi-link" size="small" text @click="document.select(document.addAlignment())" />
      <Button v-tooltip="'Gelenk: bewegliche Verbindung'" label="Gelenk" icon="pi pi-sync" size="small" text @click="document.select(document.addJoint())" />
      <Button v-tooltip="'Verschraubung: Bohrungen ausrichten, Schraube, Scheibe, Mutter'" label="Verschraubung" icon="pi pi-cog" size="small" text @click="document.select(document.addFastening())" />
    </div>

    <p v-if="model.length === 1 && !model[0]!.relations.length" class="ribo-relations-empty">
      Noch keine Bauteile. Mit „Neues Bauteil“ anlegen, dann hier Beziehungen setzen – z. B. eine Kante an die Kante eines anderen Bauteils.
    </p>

    <template v-for="node in model" :key="node.index">
      <div class="ribo-relations-component" @click="node.component ? document.select(node.component) : document.select(undefined)">
        <i class="pi pi-th-large" />
        <span class="name">{{ node.name }}</span>
        <span v-tooltip="node.status.hint" class="status" :class="/frei$/.test(node.status.label) && node.status.label !== 'frei' ? 'partly' : node.status.label"><i :class="node.status.icon" /> {{ node.status.label }}</span>
      </div>
      <ul>
        <li
          v-for="relation in node.relations"
          :key="relation.index"
          :class="{ selected: isSelected(relation.joint), suppressed: relation.joint.suppressed, broken: problems.has(relation.index) || !relation.complete }"
          :title="problems.get(relation.index)?.join('\n') ?? (relation.complete ? '' : 'Bezug fehlt – im Ansichtsfenster anklicken')"
          @click="document.select(relation.joint)"
        >
          <i :class="iconOf(relation.joint)" />
          <div class="text">
            <span class="name">{{ relation.joint.name }} <small>{{ relation.kind }}</small></span>
            <span class="detail">{{ [relation.origins, `zu ${relation.other}`, facing(relation.joint)].filter(Boolean).join(' · ') }}</span>
          </div>
          <i v-if="problems.has(relation.index) || !relation.complete" class="pi pi-exclamation-triangle problem" />
          <Button
            v-tooltip="relation.joint.suppressed ? 'Aktivieren' : 'Unterdrücken'"
            :icon="relation.joint.suppressed ? 'pi pi-eye-slash' : 'pi pi-eye'"
            size="small"
            text
            rounded
            @click.stop="toggleSuppressed(relation.joint)"
          />
          <Button v-tooltip="'Löschen'" icon="pi pi-trash" size="small" text rounded severity="danger" @click.stop="document.remove(relation.joint)" />
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.ribo-relations-tools {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.ribo-relations-empty {
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  margin: 0.25rem 0;
}

.ribo-relations-component {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.9rem;
  margin-top: 0.25rem;
  font-weight: 600;
  cursor: pointer;
}

.ribo-relations-component .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.status i {
  font-size: 0.7rem;
}

.status.bestimmt {
  color: var(--p-green-500);
}

.status.beweglich {
  color: var(--p-primary-color);
}

.status.frei,
.status.partly {
  color: var(--p-orange-500);
}

ul {
  list-style: none;
  margin: 0;
  padding: 0 0 0.25rem 1.2rem;
}

li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.2rem;
  padding: 0 0.25rem 0 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

li:hover {
  background: var(--p-content-hover-background);
}

li.selected {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
}

.text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text small,
.detail {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

li.suppressed .name {
  text-decoration: line-through;
  opacity: 0.6;
}

li.broken .name,
.problem {
  color: var(--p-red-500);
}
</style>
