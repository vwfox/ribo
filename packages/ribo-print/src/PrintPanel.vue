<script setup lang="ts">
import { computed, ref, type Ref } from 'vue'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import type { PrintReport } from './analysis'
import { MATERIALS, PRINTERS, type PrintSettings } from './settings'

const props = defineProps<{
  report: Readonly<Ref<PrintReport | undefined>>
  settings: Readonly<Ref<PrintSettings>>
  marks: Readonly<Ref<{ overhangs: boolean; thin: boolean }>>
  update: (settings: PrintSettings) => void
  setMark: (kind: 'overhangs' | 'thin', on: boolean) => void
  exportAs: (format: 'stl' | '3mf') => void
}>()

const showSettings = ref(false)
const r = computed(() => props.report.value)
const s = computed(() => props.settings.value)

const fmt = (value: number, digits = 1) => value.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const area = (mm2: number) => (mm2 >= 100 ? `${fmt(mm2 / 100)} cm²` : `${fmt(mm2)} mm²`)

const printerOptions = PRINTERS.map((p) => ({ label: p.id === 'custom' ? p.label : `${p.label} (${p.bed.join(' × ')})`, value: p.id }))
const materialOptions = MATERIALS.map((m) => ({ label: `${m.label} (${m.density} g/cm³)`, value: m.id }))

function setPrinter(id: string) {
  const printer = PRINTERS.find((p) => p.id === id)
  props.update({ ...s.value, printer: id, bed: id === 'custom' ? s.value.bed : ([...printer!.bed] as PrintSettings['bed']) })
}

function setBed(axis: 0 | 1 | 2, value: number | null) {
  if (!value || value <= 0) return
  const bed = [...s.value.bed] as PrintSettings['bed']
  bed[axis] = value
  props.update({ ...s.value, printer: 'custom', bed })
}

function set<K extends keyof PrintSettings>(key: K, value: PrintSettings[K] | null) {
  if (value === null || value === undefined) return
  props.update({ ...s.value, [key]: value })
}
</script>

<template>
  <div class="ribo-print">
    <div v-if="!r || r.bodies === 0" class="ribo-print-empty">Noch kein Körper zum Prüfen.</div>

    <template v-else>
      <div class="ribo-print-summary">
        <div>
          <span class="value">{{ fmt(r.weight) }} g</span>
          <span class="label">{{ s.material }}, voll</span>
        </div>
        <div>
          <span class="value">{{ fmt(r.filamentLength, 2) }} m</span>
          <span class="label">Filament ⌀{{ s.filament }}</span>
        </div>
        <div>
          <span class="value">{{ fmt(r.volume / 1000, 2) }} cm³</span>
          <span class="label">Volumen</span>
        </div>
      </div>
      <small class="ribo-print-note">Bei 100 % Füllung – mit Infill wird es weniger.</small>

      <ul class="ribo-print-checks">
        <li :class="r.fits ? 'ok' : 'bad'">
          <i :class="r.fits ? 'pi pi-check-circle' : 'pi pi-times-circle'" />
          <div>
            <strong>{{ r.fits ? 'Passt aufs Druckbett' : 'Zu groß für das Druckbett' }}</strong>
            <span>{{ r.size.map((v) => fmt(v)).join(' × ') }} mm von {{ s.bed.join(' × ') }} mm</span>
            <span v-if="r.fitsRotated">nur um 90° gedreht</span>
            <span v-if="Math.abs(r.minZ) > 0.01">Unterkante bei z = {{ fmt(r.minZ, 2) }} mm – der Slicer legt das Teil aufs Bett</span>
          </div>
        </li>

        <li :class="r.overhangs.area > 0 ? 'warn' : 'ok'">
          <i :class="r.overhangs.area > 0 ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'" />
          <div>
            <strong>{{ r.overhangs.area > 0 ? `Überhänge über ${s.overhangAngle}°` : `Keine Überhänge über ${s.overhangAngle}°` }}</strong>
            <span v-if="r.overhangs.area > 0">{{ area(r.overhangs.area) }} brauchen Stützen oder eine andere Lage</span>
          </div>
          <ToggleSwitch v-if="r.overhangs.area > 0" :model-value="marks.value.overhangs" @update:model-value="setMark('overhangs', $event)" v-tooltip.left="'Im Ansichtsfenster rot markieren'" />
        </li>

        <li :class="r.thin.area > 0 ? 'warn' : 'ok'">
          <i :class="r.thin.area > 0 ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'" />
          <div>
            <strong>{{ r.thin.area > 0 ? `Wände dünner als ${s.minWall} mm` : `Alle Wände ab ${s.minWall} mm` }}</strong>
            <span v-if="r.thin.thinnest !== undefined">dünnste Stelle {{ fmt(r.thin.thinnest, 2) }} mm · {{ area(r.thin.area) }}</span>
          </div>
          <ToggleSwitch v-if="r.thin.area > 0" :model-value="marks.value.thin" @update:model-value="setMark('thin', $event)" v-tooltip.left="'Im Ansichtsfenster orange markieren'" />
        </li>

        <li class="info">
          <i class="pi pi-info-circle" />
          <div>
            <strong>Auflagefläche {{ area(r.contact) }}</strong>
            <span v-if="r.contact < 50">klein – Brim oder Raft gegen Ablösen erwägen</span>
            <span v-if="r.bodies > 1">{{ r.bodies }} Körper – sie werden als getrennte Objekte exportiert</span>
          </div>
        </li>
      </ul>

      <div class="ribo-print-export">
        <Button label="3MF" icon="pi pi-download" size="small" @click="exportAs('3mf')" />
        <Button label="STL" icon="pi pi-download" size="small" severity="secondary" @click="exportAs('stl')" />
      </div>
    </template>

    <button class="ribo-print-settings-toggle" type="button" @click="showSettings = !showSettings">
      <i :class="showSettings ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" /> Drucker &amp; Material
    </button>
    <div v-if="showSettings" class="ribo-print-settings">
      <label>
        <span>Drucker</span>
        <Select :model-value="s.printer" :options="printerOptions" option-label="label" option-value="value" size="small" fluid @update:model-value="setPrinter" />
      </label>
      <div class="ribo-print-bed">
        <label v-for="(axis, i) in ['X', 'Y', 'Z']" :key="axis">
          <span>Bett {{ axis }}</span>
          <InputNumber :model-value="s.bed[i]" :min="10" :max="2000" suffix=" mm" size="small" fluid @update:model-value="setBed(i as 0 | 1 | 2, $event)" />
        </label>
      </div>
      <label>
        <span>Material</span>
        <Select :model-value="s.material" :options="materialOptions" option-label="label" option-value="value" size="small" fluid @update:model-value="set('material', $event)" />
      </label>
      <div class="ribo-print-bed">
        <label>
          <span>Düse</span>
          <InputNumber :model-value="s.nozzle" :min="0.1" :max="2" :step="0.1" :min-fraction-digits="1" suffix=" mm" size="small" fluid @update:model-value="set('nozzle', $event)" />
        </label>
        <label>
          <span>Min. Wand</span>
          <InputNumber :model-value="s.minWall" :min="0.1" :max="10" :step="0.1" :min-fraction-digits="1" suffix=" mm" size="small" fluid @update:model-value="set('minWall', $event)" />
        </label>
        <label>
          <span>Überhang</span>
          <InputNumber :model-value="s.overhangAngle" :min="10" :max="89" suffix="°" size="small" fluid @update:model-value="set('overhangAngle', $event)" />
        </label>
      </div>
      <small class="ribo-print-note">Faustregel: Mindestwand = 2 × Düse. Die Einstellungen gelten für diesen Browser.</small>
    </div>
  </div>
</template>

<style scoped>
.ribo-print {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.ribo-print-empty,
.ribo-print-note {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
}

.ribo-print-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.ribo-print-summary div {
  display: flex;
  flex-direction: column;
}

.ribo-print-summary .value {
  font-size: 1.05rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ribo-print-summary .label {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.ribo-print-checks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ribo-print-checks li {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 0.85rem;
}

.ribo-print-checks li > div {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.ribo-print-checks li span {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.ribo-print-checks li i {
  margin-top: 0.15rem;
}

.ok i {
  color: var(--p-green-500);
}
.warn i {
  color: var(--p-orange-500);
}
.bad i {
  color: var(--p-red-500);
}
.info i {
  color: var(--p-text-muted-color);
}

.ribo-print-export {
  display: flex;
  gap: 0.375rem;
}

.ribo-print-settings-toggle {
  all: unset;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.ribo-print-settings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ribo-print-settings label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.ribo-print-bed {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.375rem;
}
</style>
