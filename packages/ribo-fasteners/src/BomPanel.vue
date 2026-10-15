<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import type { DocumentService } from 'ribo-contracts'
import { isFastening, type Fastening } from 'ribo-model'
import { billOfMaterials, reportFastening, viewOf } from 'ribo-parts'

const props = defineProps<{ document: DocumentService }>()

const model = computed(() => {
  void props.document.revision.value
  void props.document.result.value
  const fastenings = props.document.design.value.features.toArray().filter(isFastening)
  const view = viewOf(props.document)
  const faults = fastenings.filter((f) => !f.suppressed && reportFastening(f, view).some((r) => r.problems.length))
  return { fastenings, lines: billOfMaterials(fastenings, view), faults }
})

const total = computed(() => model.value.lines.reduce((sum, line) => sum + line.count, 0))

function exportCsv() {
  const rows = [['Anzahl', 'Teil', 'Bezeichnung'], ...model.value.lines.map((l) => [String(l.count), l.part, l.name])]
  const text = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = `${(props.document.design.value.name || 'design').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'design'}-stueckliste.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const select = (fastening: Fastening) => props.document.select(fastening)
</script>

<template>
  <div class="ribo-bom" :data-revision="document.revision.value">
    <p v-if="!model.fastenings.length" class="ribo-bom-empty">
      Noch keine Verschraubung. „Verschrauben“ (B) anlegen, dann im Ansichtsfenster je Schraube die Bohrungskanten an den Berührflächen anklicken – erst im Bauteil auf der Kopfseite, dann auf der Mutterseite.
    </p>
    <template v-else>
      <table>
        <thead>
          <tr>
            <th class="count">Anzahl</th>
            <th>Teil</th>
            <th>Bezeichnung</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in model.lines" :key="line.part">
            <td class="count">{{ line.count }}</td>
            <td class="part">{{ line.part }}</td>
            <td>{{ line.name }}</td>
          </tr>
        </tbody>
      </table>
      <div class="ribo-bom-footer">
        <span>{{ total }} Normteile</span>
        <span v-for="fastening in model.faults" :key="fastening.name" class="fault" @click="select(fastening)">
          <i class="pi pi-exclamation-triangle" /> {{ fastening.name }}
        </span>
        <Button label="CSV" icon="pi pi-download" size="small" text :disabled="!model.lines.length" @click="exportCsv" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.ribo-bom-empty {
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  margin: 0.25rem 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

th {
  text-align: left;
  font-weight: 600;
  color: var(--p-text-muted-color);
  border-bottom: 1px solid var(--p-content-border-color);
  padding: 0.2rem 0.5rem;
}

td {
  padding: 0.2rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--p-content-border-color) 50%, transparent);
}

.count {
  width: 4rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.part {
  font-weight: 600;
  white-space: nowrap;
}

.ribo-bom-footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.3rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.ribo-bom-footer > span:first-child {
  flex: 1;
}

.fault {
  color: var(--p-red-500);
  cursor: pointer;
}
</style>
