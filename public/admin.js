const statusEl = document.getElementById('status');
const tbody = document.querySelector('#sourcesTbl tbody');
const addBtn = document.getElementById('addBtn');
const saveBtn = document.getElementById('saveBtn');
const reloadBtn = document.getElementById('reloadBtn');

let config = { urls: [] };

function setStatus(msg, ok=true) {
  statusEl.textContent = msg;
  statusEl.style.color = ok ? '#10b981' : '#f87171';
}

function rowTemplate(source, idx) {
  return `<tr data-idx="${idx}">
    <td><input type="text" value="${source.name||''}" data-field="name" /></td>
    <td><input type="text" value="${source.type||''}" data-field="type" placeholder="(optional)" /></td>
    <td><input type="text" value="${source.url||''}" data-field="url" /></td>
    <td class="row-actions"><button class="danger" data-action="del">✕</button></td>
  </tr>`;
}

function render() {
  tbody.innerHTML = config.urls.map((s,i)=>rowTemplate(s,i)).join('');
}

async function load() {
  try {
    const r = await fetch('/api/config/m3u');
    config = await r.json();
    if (!Array.isArray(config.urls)) config.urls = [];
    render();
    setStatus('Loaded config');
  } catch (e) {
    setStatus('Failed to load config: '+e.message,false);
  }
}

addBtn.addEventListener('click', () => {
  config.urls.push({ name:'', type:'', url:'' });
  render();
});

tbody.addEventListener('input', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const idx = parseInt(tr.dataset.idx,10);
  const field = e.target.dataset.field;
  config.urls[idx][field] = e.target.value;
});

tbody.addEventListener('click', (e) => {
  if (e.target.dataset.action === 'del') {
    const tr = e.target.closest('tr');
    const idx = parseInt(tr.dataset.idx,10);
    config.urls.splice(idx,1);
    render();
  }
});

saveBtn.addEventListener('click', async () => {
  try {
    // basic cleanup: remove blank rows
    config.urls = config.urls.filter(u => u.name && u.url);
    const r = await fetch('/api/config/m3u', {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(config)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Save failed');
    setStatus('Config saved. Reload channels to apply.');
  } catch (e) {
    setStatus(e.message,false);
  }
});

reloadBtn.addEventListener('click', async () => {
  try {
    setStatus('Reloading channels...');
    const r = await fetch('/api/reload/channels', { method:'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Reload failed');
    setStatus(`Reloaded ${j.channels} channels.`);
  } catch (e) {
    setStatus(e.message,false);
  }
});

load();
