<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PanelContribution } from 'ribo-contracts'
import PanelHeader from './PanelHeader.vue'
import type { FloatBox, Layout } from './layout'

const props = defineProps<{ panel: PanelContribution; layout: Layout; bounds: () => DOMRect | undefined }>()

const box = computed<FloatBox>(() => props.layout.placementOf(props.panel).float ?? { x: 120, y: 80, w: 320, h: 360 })
const live = ref<FloatBox>()
const shown = computed(() => live.value ?? box.value)

/** Moves (from the header) or resizes (from the corner) with the pointer */
function track(event: PointerEvent, mode: 'move' | 'resize') {
  const start = { x: event.clientX, y: event.clientY, box: { ...box.value } }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    live.value =
      mode === 'move'
        ? { ...start.box, x: start.box.x + dx, y: Math.max(0, start.box.y + dy) }
        : { ...start.box, w: Math.max(220, start.box.w + dx), h: Math.max(140, start.box.h + dy) }
  }
  const up = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    const final = live.value
    live.value = undefined
    if (!final) return
    props.layout.setFloat(props.panel, final)
    const bounds = props.bounds()
    if (mode === 'move' && bounds) props.layout.snap(props.panel, final, bounds)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="ribo-float" :style="{ left: `${shown.x}px`, top: `${shown.y}px`, width: `${shown.w}px`, height: `${shown.h}px` }">
    <PanelHeader :panel="panel" :layout="layout" floating @grab="track($event, 'move')" />
    <div class="ribo-float-body"><component :is="panel.component" /></div>
    <div class="ribo-float-resize" @pointerdown="track($event, 'resize')" />
  </div>
</template>

<style scoped>
.ribo-float {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
  overflow: hidden;
}

.ribo-float :deep(.ribo-panel-header) {
  cursor: move;
  border-bottom: 1px solid var(--p-content-border-color);
}

.ribo-float-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.5rem 0.75rem;
}

.ribo-float-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--p-content-border-color) 50%);
}
</style>
