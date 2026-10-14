<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import type { EObject } from '@emfts/core'
import type { DocumentService } from 'ribo-contracts'
import { isConstructionPlane, isJoint, isSketch, type Component, type Feature, type Sketch } from 'ribo-model'
import { iconOf } from './icons'

const props = defineProps<{ document: DocumentService; editSketch: (sketch: Sketch) => void }>()

/** Collapsed nodes, by key */
const closed = ref(new Set<string>(['origin']))
const toggle = (key: string) => {
  const next = new Set(closed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  closed.value = next
}

interface Node {
  index: number
  component: Component | undefined
  name: string
  planes: Feature[]
  sketches: Sketch[]
  features: Feature[]
  bodies: { volume: number; number: number }[]
}

const model = computed(() => {
  void props.document.revision.value
  const document = props.document
  const design = document.design.value
  const features = design.features.toArray()
  const bodies = document.result.value?.bodies ?? []
  const node = (index: number): Node => {
    const own = features.filter((f) => !isJoint(f) && document.componentIndexOf(f) === index)
    let number = 0
    return {
      index,
      component: document.componentAt(index),
      name: index === 0 ? design.name || 'Unbenannt' : (document.componentAt(index)?.name ?? `Bauteil ${index}`),
      planes: own.filter(isConstructionPlane),
      sketches: own.filter(isSketch),
      features: own.filter((f) => !isSketch(f) && !isConstructionPlane(f)),
      bodies: bodies.flatMap((b) => (b.component === index ? [{ volume: b.volume, number: ++number }] : [])),
    }
  }
  return {
    root: node(0),
    components: design.components.toArray().map((_, i) => node(i + 1)),
    joints: features.filter(isJoint),
    parameters: design.parameters.toArray(),
    values: document.parameterValues(),
    active: document.componentIndexOf(design.activeComponent),
  }
})

const problemIndexes = computed(() => new Set(props.document.problems.value.map((p) => p.index)))
const broken = (feature: Feature) => problemIndexes.value.has(props.document.design.value.features.indexOf(feature))

const isSelected = (object: EObject | undefined) => object !== undefined && props.document.selection.value === object
const select = (object: EObject) => props.document.select(object)

function valueText(value: number | Error | undefined): string {
  if (value instanceof Error) return value.message
  return value === undefined ? '' : `${Number(value.toFixed(3))}`
}

function volumeText(volume: number) {
  return volume >= 1000 ? `${(volume / 1000).toFixed(2)} cm³` : `${volume.toFixed(0)} mm³`
}

function toggleVisible(component: Component) {
  props.document.history.record('Sichtbarkeit', () => {
    component.visible = !component.visible
  })
}

const groups = (node: Node) =>
  [
    { key: 'planes', label: 'Konstruktion', items: node.planes },
    { key: 'sketches', label: 'Skizzen', items: node.sketches },
    { key: 'features', label: 'Features', items: node.features },
  ].filter((g) => g.items.length || g.key !== 'planes')
</script>

<template>
  <div class="ribo-tree" :data-revision="document.revision.value">
    <!-- Parameters belong to the whole design -->
    <div class="ribo-tree-head" @click="toggle('parameters')">
      <i :class="closed.has('parameters') ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
      <span>Parameter</span>
      <small>{{ model.parameters.length }}</small>
      <Button v-tooltip="'Parameter hinzufügen'" icon="pi pi-plus" size="small" text rounded @click.stop="document.addParameter()" />
    </div>
    <ul v-if="!closed.has('parameters')">
      <li
        v-for="(parameter, i) in model.parameters"
        :key="i"
        :class="{ selected: isSelected(parameter), broken: model.values.get(parameter) instanceof Error }"
        @click="select(parameter)"
      >
        <i :class="iconOf(parameter)" />
        <span class="name">{{ parameter.name }}</span>
        <span class="value">{{ valueText(model.values.get(parameter)) }}</span>
      </li>
    </ul>

    <!-- The design itself, then its components -->
    <template v-for="node in [model.root, ...model.components]" :key="node.index">
      <div class="ribo-tree-component" :class="{ active: model.active === node.index, selected: isSelected(node.component) }">
        <i class="pi caret" :class="closed.has(`c${node.index}`) ? 'pi-chevron-right' : 'pi-chevron-down'" @click="toggle(`c${node.index}`)" />
        <i :class="node.index === 0 ? 'pi pi-box' : 'pi pi-th-large'" />
        <span class="name" @click="node.component ? select(node.component) : document.select(undefined)">{{ node.name }}</span>
        <Button
          v-tooltip="model.active === node.index ? 'Aktives Bauteil – neue Features landen hier' : 'Aktivieren'"
          :icon="model.active === node.index ? 'pi pi-circle-fill' : 'pi pi-circle'"
          size="small"
          text
          rounded
          @click="document.activate(node.component)"
        />
        <Button
          v-if="node.component"
          v-tooltip="node.component.visible ? 'Ausblenden' : 'Einblenden'"
          :icon="node.component.visible ? 'pi pi-eye' : 'pi pi-eye-slash'"
          size="small"
          text
          rounded
          @click="toggleVisible(node.component)"
        />
      </div>
      <div v-if="!closed.has(`c${node.index}`)" class="ribo-tree-children">
        <template v-if="node.index === 0">
          <div class="ribo-tree-head" @click="toggle('origin')">
            <i :class="closed.has('origin') ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
            <span>Ursprung</span>
          </div>
          <ul v-if="!closed.has('origin')">
            <li v-for="plane in ['XY', 'XZ', 'YZ']" :key="plane" class="static"><i class="pi pi-stop" /> <span class="name">Ebene {{ plane }}</span></li>
          </ul>
        </template>

        <template v-for="group in groups(node)" :key="group.key">
          <div class="ribo-tree-head" @click="toggle(`${node.index}${group.key}`)">
            <i :class="closed.has(`${node.index}${group.key}`) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
            <span>{{ group.label }}</span>
            <small>{{ group.items.length }}</small>
          </div>
          <ul v-if="!closed.has(`${node.index}${group.key}`)">
            <li
              v-for="(feature, i) in group.items"
              :key="i"
              :class="{ selected: isSelected(feature), suppressed: feature.suppressed, broken: broken(feature) }"
              :title="isSketch(feature) ? 'Doppelklick bearbeitet die Skizze' : ''"
              @click="select(feature)"
              @dblclick="isSketch(feature) && editSketch(feature)"
            >
              <i :class="iconOf(feature)" /> <span class="name">{{ feature.name }}</span>
              <span v-if="isSketch(feature)" class="value">{{ feature.curves.size() }} Kurven</span>
            </li>
          </ul>
        </template>

        <div class="ribo-tree-head" @click="toggle(`${node.index}bodies`)">
          <i :class="closed.has(`${node.index}bodies`) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
          <span>Körper</span>
          <small>{{ node.bodies.length }}</small>
        </div>
        <ul v-if="!closed.has(`${node.index}bodies`)">
          <li v-for="body in node.bodies" :key="body.number" class="static">
            <i class="pi pi-box" /> <span class="name">Körper {{ body.number }}</span>
            <span class="value">{{ volumeText(body.volume) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <template v-if="model.joints.length">
      <div class="ribo-tree-head" @click="toggle('joints')">
        <i :class="closed.has('joints') ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
        <span>Gelenke</span>
        <small>{{ model.joints.length }}</small>
      </div>
      <ul v-if="!closed.has('joints')">
        <li
          v-for="(joint, i) in model.joints"
          :key="i"
          :class="{ selected: isSelected(joint), suppressed: joint.suppressed, broken: broken(joint) }"
          @click="select(joint)"
        >
          <i :class="iconOf(joint)" /> <span class="name">{{ joint.name }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.ribo-tree-component {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.9rem;
  margin-top: 0.25rem;
  padding: 0 0.15rem;
  border-radius: 4px;
  font-weight: 600;
}

.ribo-tree-component .caret {
  font-size: 0.65rem;
  width: 0.8rem;
  cursor: pointer;
}

.ribo-tree-component .name {
  flex: 1;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ribo-tree-component.active {
  color: var(--p-primary-color);
}

.ribo-tree-component.selected {
  background: var(--p-highlight-background);
}

.ribo-tree-children {
  padding-left: 0.9rem;
}

.ribo-tree-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.7rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.ribo-tree-head > i {
  font-size: 0.65rem;
  width: 0.8rem;
}

.ribo-tree-head span {
  flex: 1;
}

.ribo-tree-head small {
  color: var(--p-text-muted-color);
  font-weight: 400;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0 0 0.25rem 1.2rem;
}

li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.7rem;
  padding: 0 0.25rem 0 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

li:hover {
  background: var(--p-content-hover-background);
}

li.static {
  cursor: default;
}

li.static:hover {
  background: none;
}

li.selected {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
}

li.suppressed .name {
  text-decoration: line-through;
  opacity: 0.6;
}

li.broken .name {
  color: var(--p-red-500);
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
</style>
