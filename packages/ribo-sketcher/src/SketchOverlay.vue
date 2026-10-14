<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Button from 'primevue/button'
import type { EObject } from '@emfts/core'
import { sketchToScreen, type DocumentService, type Vec2 } from 'ribo-contracts'
import { isArc, isCircle, isDimension, isLine, type Dimension, type SketchCurve, type SketchPoint } from 'ribo-model'
import { layoutDimension, layoutGlyphs, measure } from './annotations'
import { gridStep, type SketcherController } from './SketcherController'
import { pos } from './SketchEditor'
import { ConstraintTool, DimensionTool, type Preview } from './tools'

const props = defineProps<{ controller: SketcherController; document: DocumentService }>()
const controller = props.controller

const svg = ref<SVGSVGElement>()
const fieldInputs = ref<HTMLInputElement[]>([])
const dimensionInput = ref<HTMLInputElement>()
const cursor = ref<Vec2>([0, 0])
const hover = shallowRef<EObject | undefined>()
const fieldValues = ref<string[]>([])
const dimensionText = ref('')
const free = shallowRef<{ points: Set<SketchPoint>; curves: Set<SketchCurve> }>({ points: new Set(), curves: new Set() })

const view = computed(() => controller.view())
const sketch = computed(() => controller.active.value)
const tool = computed(() => {
  void controller.tick.value
  return controller.current.value
})

/** Everything the drawing depends on; reading it subscribes the template */
const revision = computed(() => [props.document.revision.value, controller.tick.value, view.value] as const)

const S = (p: Vec2) => sketchToScreen(view.value!, p)

// ------------------------------------------------------------- underdefined

let freeTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [() => props.document.revision.value, sketch, () => props.document.solverReady.value],
  () => {
    clearTimeout(freeTimer)
    freeTimer = setTimeout(() => {
      if (sketch.value) free.value = props.document.underdefined(sketch.value)
    }, 150)
  },
  { immediate: true },
)

const dof = computed(() => {
  void revision.value
  return free.value.points.size + free.value.curves.size
})

// --------------------------------------------------------------------- grid

const grid = computed(() => {
  const v = view.value
  if (!v || !controller.options.value.grid) return { minor: '', major: '' }
  const step = gridStep(v.scale)
  const majorEvery = 5
  const [u0, v1] = [v.center[0] - v.width / 2 / v.scale, v.center[1] + v.height / 2 / v.scale]
  const [u1, v0] = [v.center[0] + v.width / 2 / v.scale, v.center[1] - v.height / 2 / v.scale]
  let minor = ''
  let major = ''
  for (let i = Math.ceil(u0 / step); i * step <= u1; i++) {
    const x = S([i * step, 0])[0].toFixed(1)
    const d = `M${x} 0V${v.height}`
    if (i % majorEvery === 0) major += d
    else minor += d
  }
  for (let j = Math.ceil(v0 / step); j * step <= v1; j++) {
    const y = S([0, j * step])[1].toFixed(1)
    const d = `M0 ${y}H${v.width}`
    if (j % majorEvery === 0) major += d
    else minor += d
  }
  return { minor, major }
})

const axes = computed(() => {
  const v = view.value
  if (!v) return { x: '', y: '' }
  const o = S([0, 0])
  return { x: `M0 ${o[1]}H${v.width}`, y: `M${o[0]} 0V${v.height}` }
})

// ------------------------------------------------------------------ regions

const regions = computed(() => {
  void revision.value
  if (!sketch.value || !controller.options.value.profiles || !view.value) return []
  const planned = props.document.sketchPlan(sketch.value)
  return (planned?.regions ?? []).map((region) => {
    const ring = (points: Vec2[]) => 'M' + points.map((p) => S(p).map((c) => c.toFixed(1)).join(' ')).join('L') + 'Z'
    return ring(region.outline) + region.holeOutlines.map(ring).join('')
  })
})

// ----------------------------------------------------------------- geometry

function curvePath(curve: SketchCurve): string {
  if (isLine(curve) && curve.start && curve.end) {
    const [a, b] = [S(pos(curve.start)), S(pos(curve.end))]
    return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`
  }
  if (isCircle(curve) && curve.center) {
    const c = S(pos(curve.center))
    const r = curve.radius * view.value!.scale
    return `M${c[0] - r} ${c[1]}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
  }
  if (isArc(curve) && curve.center && curve.start && curve.end) {
    return arcPath(pos(curve.center), Math.hypot(curve.start.x - curve.center.x, curve.start.y - curve.center.y), pos(curve.start), pos(curve.end))
  }
  return ''
}

/** Counter-clockwise arc in sketch coordinates as an SVG path */
function arcPath(center: Vec2, radius: number, from: Vec2, to: Vec2): string {
  const a0 = Math.atan2(from[1] - center[1], from[0] - center[0])
  const a1 = Math.atan2(to[1] - center[1], to[0] - center[0])
  let sweep = a1 - a0
  while (sweep <= 0) sweep += 2 * Math.PI
  const r = radius * view.value!.scale
  const [s, e] = [S(from), S(to)]
  // y is flipped on screen: counter-clockwise in the sketch is sweep-flag 0
  return `M${s[0]} ${s[1]}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${e[0]} ${e[1]}`
}

const picked = computed(() => {
  const t = tool.value
  return new Set<EObject>(t instanceof DimensionTool || t instanceof ConstraintTool ? t.picked() : [])
})

const curves = computed(() => {
  void revision.value
  if (!sketch.value || !view.value) return []
  const selection = controller.selection.value
  return sketch.value.curves.toArray().map((curve) => ({
    curve,
    d: curvePath(curve),
    construction: curve.construction ?? false,
    selected: selection.has(curve) || picked.value.has(curve),
    hover: hover.value === curve,
    free: free.value.curves.has(curve),
  }))
})

const points = computed(() => {
  void revision.value
  if (!sketch.value || !view.value) return []
  const selection = controller.selection.value
  return sketch.value.points.toArray().map((point) => ({
    point,
    at: S(pos(point)),
    origin: point.origin ?? false,
    selected: selection.has(point) || picked.value.has(point),
    hover: hover.value === point,
    free: free.value.points.has(point),
  }))
})

const glyphs = computed(() => {
  void revision.value
  if (!sketch.value || !view.value || !controller.options.value.constraints) return []
  return layoutGlyphs(view.value, sketch.value).map((g) => ({
    ...g,
    selected: controller.selection.value.has(g.constraint),
    hover: hover.value === g.constraint,
  }))
})

const dimensions = computed(() => {
  void revision.value
  if (!sketch.value || !view.value || !controller.options.value.dimensions) return []
  return sketch.value.constraints
    .toArray()
    .filter(isDimension)
    .map((dimension) => {
      const value = measure(dimension.kind, dimension.points.toArray(), dimension.curves.toArray())
      const layout = layoutDimension(view.value!, dimension, value)
      if (!layout) return undefined
      return {
        ...layout,
        d: layout.lines.map((line) => 'M' + line.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')).join(''),
        arrows: layout.arrows.map(({ at, dir }) => {
          const n: Vec2 = [-dir[1], dir[0]]
          const back: Vec2 = [at[0] - dir[0] * 8, at[1] - dir[1] * 8]
          return `M${at[0]} ${at[1]}L${back[0] + n[0] * 3} ${back[1] + n[1] * 3}L${back[0] - n[0] * 3} ${back[1] - n[1] * 3}Z`
        }),
        selected: controller.selection.value.has(dimension),
        hover: hover.value === dimension,
        editing: controller.editing.value === dimension,
      }
    })
    .filter((d): d is NonNullable<typeof d> => d !== undefined)
})

// ------------------------------------------------------------------ preview

const previews = computed(() => {
  void revision.value
  const t = tool.value
  if (!t || !view.value) return []
  return t.preview().map((p: Preview) => {
    switch (p.kind) {
      case 'line': {
        const [a, b] = [S(p.a), S(p.b)]
        return { kind: 'path', d: `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`, dashed: p.construction }
      }
      case 'polyline':
        return { kind: 'path', d: 'M' + p.points.map((q) => S(q).join(' ')).join('L') }
      case 'circle': {
        const c = S(p.c)
        return { kind: 'circle', cx: c[0], cy: c[1], r: p.r * view.value!.scale, dashed: p.construction }
      }
      case 'arc': {
        const from: Vec2 = [p.c[0] + p.r * Math.cos(p.from), p.c[1] + p.r * Math.sin(p.from)]
        const to: Vec2 = [p.c[0] + p.r * Math.cos(p.to), p.c[1] + p.r * Math.sin(p.to)]
        return { kind: 'path', d: arcPath(p.c, p.r, from, to) }
      }
      case 'text': {
        const at = S(p.at)
        return { kind: 'text', x: at[0], y: at[1], text: p.text }
      }
      case 'box': {
        const [a, b] = [S(p.a), S(p.b)]
        return { kind: 'rect', x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }
      }
    }
  })
})

const snapMarker = computed(() => {
  void revision.value
  const snap = tool.value?.snapped()
  if (!snap || snap.kind === 'free' || !view.value) return undefined
  return { kind: snap.kind, at: S(snap.at) }
})

// ------------------------------------------------------------------- fields

const fields = computed(() => {
  void revision.value
  return tool.value?.fields() ?? []
})

watch(
  () => fields.value.map((f) => f.label).join('|') + tool.value?.id,
  () => {
    fieldValues.value = fields.value.map(() => '')
  },
)

function applyFields() {
  const values = fieldValues.value.map((v) => v.trim())
  fieldValues.value = fields.value.map(() => '')
  tool.value?.apply(values)
  controller.tick.value++
  svg.value?.focus()
}

function onFieldKey(event: KeyboardEvent, index: number) {
  if (event.key === 'Enter') {
    event.preventDefault()
    applyFields()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    fieldValues.value = fields.value.map(() => '')
    ;(event.target as HTMLInputElement).blur()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const next = (index + (event.shiftKey ? -1 : 1) + fields.value.length) % fields.value.length
    fieldInputs.value[next]?.focus()
  }
}

// ---------------------------------------------------------- dimension edit

const editingLabel = computed(() => {
  const dimension = controller.editing.value
  if (!dimension || !view.value) return undefined
  return S([dimension.labelX, dimension.labelY])
})

watch(
  () => controller.editing.value,
  async (dimension) => {
    if (!dimension) return
    dimensionText.value = dimension.expression ?? ''
    await nextTick()
    dimensionInput.value?.focus()
    dimensionInput.value?.select()
  },
)

function onDimensionKey(event: KeyboardEvent) {
  const dimension = controller.editing.value
  if (!dimension) return
  if (event.key === 'Enter') {
    event.preventDefault()
    controller.commitDimension(dimension, dimensionText.value)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    controller.editing.value = undefined
  }
}

function editDimension(dimension: Dimension) {
  controller.editing.value = dimension
}

// ------------------------------------------------------------------- input

function local(event: PointerEvent | MouseEvent): Vec2 {
  const rect = svg.value!.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}

function pointer(event: PointerEvent | MouseEvent) {
  const screen = local(event)
  return { at: controller.toSketch(screen), screen, shift: event.shiftKey || event.ctrlKey || event.metaKey, button: event.button }
}

function onPointerDown(event: PointerEvent) {
  if (!view.value) return
  if (event.button === 0) svg.value?.setPointerCapture(event.pointerId)
  if (event.button === 0 || event.button === 2) {
    tool.value?.down(pointer(event))
    controller.tick.value++
  }
}

function onPointerMove(event: PointerEvent) {
  if (!view.value) return
  const p = pointer(event)
  cursor.value = p.screen
  tool.value?.move(p)
  const hit = controller.hit(p.screen)
  hover.value = !hit ? undefined : hit.kind === 'point' ? hit.point : hit.kind === 'curve' ? hit.curve : hit.kind === 'dimension' ? hit.dimension : hit.constraint
  controller.tick.value++
}

function onPointerUp(event: PointerEvent) {
  if (!view.value || event.button !== 0) return
  tool.value?.up(pointer(event))
  controller.tick.value++
}

function onDoubleClick(event: MouseEvent) {
  if (!view.value) return
  tool.value?.dblclick(pointer(event))
  controller.tick.value++
}

function onKeyDown(event: KeyboardEvent) {
  if (!sketch.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === 'Escape') {
    controller.escape()
    controller.tick.value++
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    event.stopPropagation()
    controller.deleteSelection()
    return
  }
  // Typing a value while drawing goes into the first field
  if (fields.value.length && !event.ctrlKey && !event.metaKey && !event.altKey && /^[0-9.,(+\-]$/.test(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    fieldValues.value[0] = event.key === ',' ? '.' : event.key
    nextTick(() => fieldInputs.value[0]?.focus())
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown, { capture: true }))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, { capture: true })
  clearTimeout(freeTimer)
})

const drawing = computed(() => tool.value && !['select', 'trim', 'dimension'].includes(tool.value.id))
const hintText = computed(() => {
  void revision.value
  return tool.value?.hint() ?? ''
})
</script>

<template>
  <div v-if="sketch && view" class="ribo-sketch-overlay" :data-revision="revision[0]">
    <svg
      ref="svg"
      class="ribo-sketch-svg"
      :class="{ drawing }"
      :width="view.width"
      :height="view.height"
      tabindex="-1"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @dblclick="onDoubleClick"
    >
      <g class="grid">
        <path class="minor" :d="grid.minor" />
        <path class="major" :d="grid.major" />
        <path class="axis-x" :d="axes.x" />
        <path class="axis-y" :d="axes.y" />
      </g>

      <path v-for="(d, i) in regions" :key="'r' + i" class="region" :d="d" fill-rule="evenodd" />

      <path
        v-for="(c, i) in curves"
        :key="'c' + i"
        class="curve"
        :class="{ construction: c.construction, selected: c.selected, hover: c.hover, free: c.free }"
        :d="c.d"
      />

      <g v-for="(dim, i) in dimensions" :key="'d' + i" class="dimension" :class="{ selected: dim.selected, hover: dim.hover }">
        <path class="dimension-line" :d="dim.d" />
        <path v-for="(a, k) in dim.arrows" :key="k" class="dimension-arrow" :d="a" />
        <g v-if="!dim.editing" class="dimension-label" @dblclick.stop="editDimension(dim.dimension)">
          <rect :x="dim.label[0] - dim.text.length * 3.6 - 5" :y="dim.label[1] - 9" :width="dim.text.length * 7.2 + 10" height="18" rx="3" />
          <text :x="dim.label[0]" :y="dim.label[1] + 4">{{ dim.text }}</text>
        </g>
      </g>

      <g v-for="(g, i) in glyphs" :key="'g' + i" class="glyph" :class="{ selected: g.selected, hover: g.hover }">
        <rect :x="g.at[0] - 7" :y="g.at[1] - 7" width="14" height="14" rx="2" />
        <text :x="g.at[0]" :y="g.at[1] + 4">{{ g.text }}</text>
      </g>

      <g v-for="(p, i) in points" :key="'p' + i">
        <rect
          v-if="p.origin"
          class="origin"
          :x="p.at[0] - 4"
          :y="p.at[1] - 4"
          width="8"
          height="8"
        />
        <circle v-else class="point" :class="{ selected: p.selected, hover: p.hover, free: p.free }" :cx="p.at[0]" :cy="p.at[1]" :r="p.hover || p.selected ? 4.5 : 3" />
      </g>

      <g class="preview">
        <template v-for="(p, i) in previews" :key="'v' + i">
          <path v-if="p.kind === 'path'" :d="p.d" :class="{ dashed: p.dashed }" />
          <circle v-else-if="p.kind === 'circle'" :cx="p.cx" :cy="p.cy" :r="p.r" :class="{ dashed: p.dashed }" />
          <rect v-else-if="p.kind === 'rect'" class="box" :x="p.x" :y="p.y" :width="p.w" :height="p.h" />
          <text v-else-if="p.kind === 'text'" class="preview-text" :x="p.x" :y="p.y">{{ p.text }}</text>
        </template>
      </g>

      <g v-if="snapMarker" class="snap">
        <rect v-if="snapMarker.kind === 'point'" :x="snapMarker.at[0] - 6" :y="snapMarker.at[1] - 6" width="12" height="12" />
        <path
          v-else-if="snapMarker.kind === 'midpoint'"
          :d="`M${snapMarker.at[0]} ${snapMarker.at[1] - 7}L${snapMarker.at[0] + 7} ${snapMarker.at[1] + 5}L${snapMarker.at[0] - 7} ${snapMarker.at[1] + 5}Z`"
        />
        <path v-else :d="`M${snapMarker.at[0] - 5} ${snapMarker.at[1] - 5}L${snapMarker.at[0] + 5} ${snapMarker.at[1] + 5}M${snapMarker.at[0] + 5} ${snapMarker.at[1] - 5}L${snapMarker.at[0] - 5} ${snapMarker.at[1] + 5}`" />
      </g>
    </svg>

    <div v-if="fields.length" class="ribo-sketch-fields" :style="{ left: cursor[0] + 18 + 'px', top: cursor[1] + 18 + 'px' }">
      <label v-for="(field, i) in fields" :key="field.label">
        <span>{{ field.label }}</span>
        <input
          :ref="(el) => (fieldInputs[i] = el as HTMLInputElement)"
          v-model="fieldValues[i]"
          :placeholder="field.placeholder"
          spellcheck="false"
          @keydown.stop="onFieldKey($event, i)"
        />
      </label>
    </div>

    <input
      v-if="editingLabel"
      ref="dimensionInput"
      v-model="dimensionText"
      class="ribo-sketch-dimension-input"
      :style="{ left: editingLabel[0] - 50 + 'px', top: editingLabel[1] - 13 + 'px' }"
      spellcheck="false"
      @keydown.stop="onDimensionKey"
      @blur="controller.editing.value = undefined"
    />

    <div class="ribo-sketch-hud">
      <span class="ribo-sketch-hint">{{ hintText }}</span>
      <span class="ribo-sketch-state" :class="{ done: dof === 0 }">
        {{ dof === 0 ? 'Vollständig bestimmt' : 'Unterbestimmt (blau)' }}
      </span>
    </div>

    <div class="ribo-sketch-finish">
      <Button label="Skizze beenden" icon="pi pi-check" severity="success" size="small" @click="controller.finish()" />
    </div>
  </div>
</template>

<style scoped>
.ribo-sketch-overlay {
  position: absolute;
  inset: 0;
  --sk-defined: #0f172a;
  --sk-free: #2563eb;
  --sk-construction: #ea580c;
  --sk-selected: #0ea5e9;
  --sk-dimension: #334155;
  --sk-grid: rgb(100 116 139 / 0.16);
  --sk-grid-major: rgb(100 116 139 / 0.32);
  --sk-region: rgb(59 130 246 / 0.1);
}

.ribo-sketch-svg {
  position: absolute;
  inset: 0;
  outline: none;
  user-select: none;
}

.ribo-sketch-svg.drawing {
  cursor: crosshair;
}

.grid path {
  fill: none;
  stroke-width: 1;
}
.grid .minor {
  stroke: var(--sk-grid);
}
.grid .major {
  stroke: var(--sk-grid-major);
}
.grid .axis-x {
  stroke: rgb(220 38 38 / 0.5);
}
.grid .axis-y {
  stroke: rgb(22 163 74 / 0.5);
}

.region {
  fill: var(--sk-region);
  stroke: none;
}

.curve {
  fill: none;
  stroke: var(--sk-defined);
  stroke-width: 1.6;
}
.curve.free {
  stroke: var(--sk-free);
}
.curve.construction {
  stroke: var(--sk-construction);
  stroke-dasharray: 6 4;
  stroke-width: 1.2;
}
.curve.hover {
  stroke-width: 3;
}
.curve.selected {
  stroke: var(--sk-selected);
  stroke-width: 3;
}

.point {
  fill: var(--sk-defined);
  stroke: none;
}
.point.free {
  fill: var(--sk-free);
}
.point.selected {
  fill: var(--sk-selected);
}
.origin {
  fill: #eab308;
  stroke: #854d0e;
}

.dimension-line {
  fill: none;
  stroke: var(--sk-dimension);
  stroke-width: 1;
}
.dimension-arrow {
  fill: var(--sk-dimension);
}
.dimension-label rect {
  fill: var(--p-content-background);
  stroke: var(--sk-dimension);
  stroke-width: 0.75;
}
.dimension-label text {
  fill: var(--sk-dimension);
  font-size: 12px;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}
.dimension.hover .dimension-label rect,
.dimension.selected .dimension-label rect {
  stroke: var(--sk-selected);
  stroke-width: 1.5;
}
.dimension-label {
  cursor: text;
}

.glyph rect {
  fill: var(--p-content-background);
  stroke: var(--sk-dimension);
  stroke-width: 0.75;
  opacity: 0.9;
}
.glyph text {
  fill: var(--sk-dimension);
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
}
.glyph.hover rect,
.glyph.selected rect {
  stroke: var(--sk-selected);
  stroke-width: 1.5;
}

.preview path,
.preview circle {
  fill: none;
  stroke: var(--sk-selected);
  stroke-width: 1.4;
}
.preview .dashed {
  stroke-dasharray: 5 4;
  stroke: var(--sk-construction);
}
.preview .box {
  fill: rgb(14 165 233 / 0.08);
  stroke: var(--sk-selected);
  stroke-dasharray: 4 3;
}
.preview-text {
  fill: var(--sk-selected);
  font-size: 12px;
  font-weight: 600;
  text-anchor: middle;
  paint-order: stroke;
  stroke: var(--p-content-background);
  stroke-width: 3px;
}

.snap rect,
.snap path {
  fill: none;
  stroke: #16a34a;
  stroke-width: 1.5;
}

.ribo-sketch-fields {
  position: absolute;
  display: flex;
  gap: 0.375rem;
  padding: 0.375rem;
  border-radius: 6px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  pointer-events: auto;
}

.ribo-sketch-fields label {
  display: flex;
  flex-direction: column;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.ribo-sketch-fields input,
.ribo-sketch-dimension-input {
  width: 6.5rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.ribo-sketch-dimension-input {
  position: absolute;
  width: 100px;
  border-color: var(--p-primary-color);
  text-align: center;
}

.ribo-sketch-hud {
  position: absolute;
  left: 50%;
  bottom: 2rem;
  transform: translateX(-50%);
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.35rem 0.85rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-content-background) 90%, transparent);
  border: 1px solid var(--p-content-border-color);
  font-size: 0.8rem;
  pointer-events: none;
  white-space: nowrap;
}

.ribo-sketch-state {
  color: var(--sk-free);
  font-weight: 600;
}

.ribo-sketch-state.done {
  color: var(--sk-defined);
}

.ribo-sketch-finish {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
</style>

<style>
/* Unscoped: in a scoped block Vue keeps only the :global() part of a selector */
html.dark-theme .ribo-sketch-overlay {
  --sk-defined: #f1f5f9;
  --sk-free: #60a5fa;
  --sk-construction: #fb923c;
  --sk-selected: #38bdf8;
  --sk-dimension: #cbd5e1;
  --sk-grid: rgb(148 163 184 / 0.12);
  --sk-grid-major: rgb(148 163 184 / 0.26);
  --sk-region: rgb(96 165 250 / 0.12);
}
</style>
