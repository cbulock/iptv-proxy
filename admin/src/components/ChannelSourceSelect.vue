<template>
  <div class="source-choice">
    <label :for="`${id}-search`" class="choice-label">{{ label }}</label>
    <input
      :id="`${id}-search`"
      v-model="search"
      type="search"
      :aria-label="`Search ${label.toLowerCase()} choices`"
      :placeholder="`Search ${options.length} choices`"
      :disabled="disabled"
      autocomplete="off"
    />
    <label :for="id" class="sr-only">Choose {{ label.toLowerCase() }}</label>
    <select
      :id="id"
      :value="modelValue"
      :disabled="disabled || !options.length"
      :aria-describedby="`${id}-help`"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option value="" disabled>
        {{ options.length ? `Choose ${label.toLowerCase()}` : 'No choices available' }}
      </option>
      <optgroup v-for="group in groups" :key="group.label" :label="group.label">
        <option v-for="option in group.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </optgroup>
    </select>
    <p :id="`${id}-help`" class="choice-help" role="status">
      <template v-if="!groups.length && search">
        No matching choices. Clear the search to see all choices.
      </template>
      <template v-else-if="search">
        {{ visibleCount }} choices shown. Your selected choice stays visible.
      </template>
      <template v-else>Current channel matches are grouped first.</template>
    </p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { groupChannelSourceOptions } from '../utils/channel-source-options.js';

const props = defineProps({
  id: { type: String, required: true },
  label: { type: String, required: true },
  modelValue: { type: String, default: '' },
  options: { type: Array, required: true },
  matchedValues: { type: Array, default: () => [] },
  disabled: Boolean,
});
defineEmits(['update:modelValue']);
const search = ref('');
const groups = computed(() =>
  groupChannelSourceOptions(props.options, props.matchedValues, search.value, props.modelValue)
);
const visibleCount = computed(() =>
  groups.value.reduce((count, group) => count + group.options.length, 0)
);
</script>

<style scoped>
.source-choice {
  display: grid;
  gap: 6px;
  min-width: 0;
  margin-top: 14px;
}
.choice-label {
  font-weight: 600;
}
input,
select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  background: var(--bg);
  font: inherit;
  color-scheme: dark;
}
select {
  text-overflow: ellipsis;
}
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
input:disabled,
select:disabled {
  opacity: 0.6;
}
.choice-help {
  margin: 0;
  color: var(--fg-subtle);
  font-size: 0.875rem;
  line-height: 1.45;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
