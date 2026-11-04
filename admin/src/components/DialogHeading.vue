<template>
  <div class="dialog-heading">
    <h2 :id="titleId">{{ title }}</h2>
    <button type="button" aria-label="Close dialog" @click="$emit('close')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
</template>

<script setup>
defineProps({
  titleId: { type: String, required: true },
  title: { type: String, required: true },
});
defineEmits(['close']);
</script>

<style scoped>
.dialog-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  min-width: 0;
  margin: 8px 0 0;
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
button {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  background: transparent;
  cursor: pointer;
}
button:hover { background: var(--bg-subtle); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; }
</style>
