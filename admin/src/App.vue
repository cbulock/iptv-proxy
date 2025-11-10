<template>
  <div>
    <h1>IPTV Proxy Admin</h1>
    <p v-if="status" :style="{ color: statusOk ? '#10b981' : '#f87171' }">
      {{ status }}
    </p>
    <div class="flex">
      <button @click="addSource">Add Source</button>
      <button @click="saveConfig" :disabled="saving">
        {{ saving ? "Saving..." : "Save Config" }}
      </button>
      <button @click="reloadChannels" :disabled="reloading">
        {{ reloading ? "Reloading..." : "Reload Channels" }}
      </button>
    </div>
    <table v-if="sources?.length" style="margin-top: 1rem">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>URL</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in sources" :key="i">
          <td><input type="text" v-model="s.name" /></td>
          <td>
            <input type="text" v-model="s.type" placeholder="(optional)" />
          </td>
          <td><input type="text" v-model="s.url" /></td>
          <td class="row-actions">
            <button class="danger" @click="removeSource(i)">✕</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else style="margin-top: 1rem; opacity: 0.7">
      No sources configured yet.
    </div>
    <footer>
      Editing <code>config/m3u.yaml</code>. Changes require channel reload.
    </footer>
  </div>
</template>

<script setup>
import { reactive, toRefs } from "vue";

const state = reactive({
  sources: [],
  status: "",
  statusOk: true,
  saving: false,
  reloading: false,
});

function setStatus(msg, ok = true) {
  state.status = msg;
  state.statusOk = ok;
}

async function load() {
  try {
    const r = await fetch("/api/config/m3u");
    const cfg = await r.json();
    state.sources.splice(
      0,
      state.sources.length,
      ...(cfg.urls && Array.isArray(cfg.urls) ? cfg.urls : [])
    );
    setStatus("Loaded config");
  } catch (e) {
    setStatus("Failed to load config: " + e.message, false);
  }
}

async function saveConfig() {
  try {
    state.saving = true;
    const cleaned = state.sources.filter((u) => u.name && u.url);
    const body = { urls: cleaned };
    const r = await fetch("/api/config/m3u", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Save failed");
    setStatus("Config saved. Reload channels to apply.");
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.saving = false;
  }
}

async function reloadChannels() {
  try {
    state.reloading = true;
    setStatus("Reloading channels...");
    const r = await fetch("/api/reload/channels", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Reload failed");
    setStatus(`Reloaded ${j.channels} channels.`);
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloading = false;
  }
}

function addSource() {
  state.sources.push({ name: "", type: "", url: "" });
}
function removeSource(i) {
  state.sources.splice(i, 1);
}

load();

// Expose reactive fields directly in template
const { sources, status, statusOk, saving, reloading } = toRefs(state);
</script>

<style>
body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
  background: #111;
  color: #eee;
}
h1 {
  margin-top: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
}
th,
td {
  border: 1px solid #333;
  padding: 0.5rem;
}
input[type="text"] {
  width: 100%;
  box-sizing: border-box;
  background: #222;
  border: 1px solid #444;
  color: #eee;
}
button {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  border-radius: 4px;
}
button.danger {
  background: #dc2626;
}
footer {
  margin-top: 2rem;
  font-size: 0.75rem;
  opacity: 0.6;
}
.row-actions {
  white-space: nowrap;
}
.flex {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
</style>
