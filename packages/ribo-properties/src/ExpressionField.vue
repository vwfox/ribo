<script setup lang="ts">
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import type { DocumentService } from 'ribo-contracts'

const props = defineProps<{
  label: string
  modelValue: string | undefined
  document: DocumentService
  /** Unit shown after the evaluated value */
  unit?: string
  /** May stay empty; then this is shown instead of an error */
  emptyHint?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const evaluated = computed(() => {
  void props.document.revision.value
  if (props.emptyHint !== undefined && !(props.modelValue ?? '').trim()) return { empty: true as const }
  try {
    return { value: props.document.evaluate(props.modelValue ?? '') }
  } catch (error) {
    return { error: (error as Error).message }
  }
})

const isLiteral = computed(() => /^\s*-?\d+(\.\d+)?\s*(mm|deg|°)?\s*$/.test(props.modelValue ?? ''))
</script>

<template>
  <label class="ribo-field">
    <span class="ribo-field-label">{{ label }}</span>
    <InputText
      :model-value="modelValue"
      :invalid="'error' in evaluated"
      size="small"
      fluid
      spellcheck="false"
      @update:model-value="emit('update:modelValue', $event ?? '')"
    />
    <small v-if="'empty' in evaluated" class="ribo-field-hint">{{ emptyHint }}</small>
    <small v-else-if="'error' in evaluated" class="ribo-field-error">{{ evaluated.error }}</small>
    <small v-else-if="!isLiteral" class="ribo-field-hint">= {{ Number(evaluated.value.toFixed(3)) }} {{ unit }}</small>
  </label>
</template>
