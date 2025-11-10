<template>
  <div>
    <h1>IPTV Proxy Admin</h1>
    <nav class="tabs">
      <button :class="{active: tab==='app'}" @click="tab='app'">App</button>
      <button :class="{active: tab==='channels'}" @click="tab='channels'">Channels</button>
      <button :class="{active: tab==='epg'}" @click="tab='epg'">EPG</button>
    </nav>
    <p v-if="status" :style="{ color: statusOk ? '#10b981' : '#f87171' }">{{ status }}</p>

    <section v-show="tab==='app'">
      <div class="flex">
        <button @click="saveApp" :disabled="savingApp">{{ savingApp ? 'Saving...' : 'Save App' }}</button>
      </div>
      <table style="margin-top:1rem">
        <tbody>
          <tr>
            <td style="width:200px">Base URL</td>
            <td><input type="text" v-model="app.base_url" placeholder="https://example.com" /></td>
          </tr>
        </tbody>
      </table>
      <footer>Editing <code>config/app.yaml</code>. Used for absolute URL generation behind proxies.</footer>
    </section>

    <section v-show="tab==='channels'">
      <div class="flex">
        <button @click="addSource">Add Source</button>
        <button @click="saveChannels" :disabled="savingChannels">{{ savingChannels ? 'Saving...' : 'Save Channels' }}</button>
        <button @click="reloadChannels" :disabled="reloadingChannels">{{ reloadingChannels ? 'Reloading...' : 'Reload Channels' }}</button>
      </div>
      <table v-if="channelSources.length" style="margin-top:1rem">
        <thead>
          <tr><th>Name</th><th>Type</th><th>URL</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="(s,i) in channelSources" :key="'c'+i">
            <td><input type="text" v-model="s.name" /></td>
            <td>
              <select v-model="s.type">
                <option value="m3u">M3U</option>
                <option value="hdhomerun">HDHomeRun</option>
              </select>
            </td>
            <td><input type="text" v-model="s.url" /></td>
            <td class="row-actions"><button class="danger" @click="removeChannelSource(i)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else style="margin-top:1rem; opacity:.7">No channel sources configured yet.</div>
      <footer>Editing <code>config/m3u.yaml</code>. Changes require channel reload.</footer>
    </section>

    <section v-show="tab==='epg'">
      <div class="flex">
        <button @click="addEPGSource">Add EPG Source</button>
        <button @click="saveEPG" :disabled="savingEPG">{{ savingEPG ? 'Saving...' : 'Save EPG' }}</button>
        <button @click="reloadEPG" :disabled="reloadingEPG">{{ reloadingEPG ? 'Reloading...' : 'Reload EPG' }}</button>
      </div>
      <table v-if="epgSources.length" style="margin-top:1rem">
        <thead>
          <tr><th>Name</th><th>URL</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="(s,i) in epgSources" :key="'e'+i">
            <td><input type="text" v-model="s.name" /></td>
            <td><input type="text" v-model="s.url" /></td>
            <td class="row-actions"><button class="danger" @click="removeEPGSource(i)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else style="margin-top:1rem; opacity:.7">No EPG sources configured yet.</div>
      <footer>Editing <code>config/epg.yaml</code>. Changes require EPG reload.</footer>
    </section>
  </div>
</template>

<script setup>
import { reactive, toRefs } from "vue";

const state = reactive({
  tab: 'app',
  app: { base_url: '' },
  channelSources: [],
  epgSources: [],
  status: '',
  statusOk: true,
  savingChannels: false,
  reloadingChannels: false,
  savingEPG: false,
  reloadingEPG: false
});

function setStatus(msg, ok = true) {
  state.status = msg;
  state.statusOk = ok;
}

async function loadChannels() {
  try {
    const r = await fetch("/api/config/m3u");
    const cfg = await r.json();
    state.channelSources.splice(
      0,
      state.channelSources.length,
      ...(cfg.urls && Array.isArray(cfg.urls) ? cfg.urls : [])
    );
    state.channelSources.forEach(s => { s.type = s.type ? String(s.type).toLowerCase() : 'm3u'; });
    setStatus('Loaded channel config');
  } catch (e) {
    setStatus("Failed to load config: " + e.message, false);
  }
}

async function loadEPG() {
  try {
    const r = await fetch('/api/config/epg');
    const cfg = await r.json();
    state.epgSources.splice(0, state.epgSources.length, ...(cfg.urls && Array.isArray(cfg.urls) ? cfg.urls : []));
    setStatus('Loaded EPG config');
  } catch (e) {
    setStatus('Failed to load EPG config: ' + e.message, false);
  }
}

async function loadApp() {
  try {
    const r = await fetch('/api/config/app');
    const cfg = await r.json();
    state.app = { base_url: cfg.base_url || '' };
  } catch (e) {
    setStatus('Failed to load app config: ' + e.message, false);
  }
}

async function saveChannels() {
  try {
  state.savingChannels = true;
  const cleaned = state.channelSources
      .filter((u) => u.name && u.url)
      .map(u => ({ ...u, type: u.type ? String(u.type).toLowerCase() : 'm3u' }));
    const body = { urls: cleaned };
    const r = await fetch("/api/config/m3u", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Save channels failed");
  setStatus("Channels saved. Reload channels to apply.");
  } catch (e) {
    setStatus(e.message, false);
  } finally {
  state.savingChannels = false;
  }
}

async function reloadChannels() {
  try {
    state.reloadingChannels = true;
    setStatus("Reloading channels...");
    const r = await fetch("/api/reload/channels", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Reload failed");
    setStatus(`Reloaded ${j.channels} channels.`);
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloadingChannels = false;
  }
}

async function saveEPG() {
  try {
    state.savingEPG = true;
    const cleaned = state.epgSources.filter(u => u.name && u.url);
    const body = { urls: cleaned };
    const r = await fetch('/api/config/epg', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save EPG failed');
    setStatus('EPG saved. Reload EPG to apply.');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.savingEPG = false;
  }
}

async function reloadEPG() {
  try {
    state.reloadingEPG = true;
    setStatus('Reloading EPG...');
    const r = await fetch('/api/reload/epg', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reload EPG failed');
    setStatus('EPG reloaded.');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.reloadingEPG = false;
  }
}

async function saveApp() {
  try {
    state.savingApp = true;
    const body = { base_url: state.app.base_url || '' };
    const r = await fetch('/api/config/app', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save app failed');
    setStatus('App settings saved.');
  } catch (e) {
    setStatus(e.message, false);
  } finally {
    state.savingApp = false;
  }
}

function addSource() { addChannelSource(); }
function addChannelSource() {
  state.channelSources.push({ name: '', type: 'm3u', url: '' });
}
function removeChannelSource(i) { state.channelSources.splice(i,1); }

function addEPGSource() { state.epgSources.push({ name: '', url: '' }); }
function removeEPGSource(i) { state.epgSources.splice(i,1); }

// Initial loads
loadChannels();
loadEPG();
loadApp();

// Expose reactive fields directly in template
const { tab, app, channelSources, epgSources, status, statusOk, savingChannels, reloadingChannels, savingEPG, reloadingEPG, savingApp } = toRefs(state);
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
.tabs { display:flex; gap:.5rem; margin-bottom:1rem; }
.tabs button { background:#222; border:1px solid #444; color:#eee; padding:.4rem .8rem; }
.tabs button.active { background:#2563eb; border-color:#2563eb; }
</style>
