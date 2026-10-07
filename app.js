// Todo – ajout de tâches depuis le téléphone.
// Les tâches sont déposées dans la boîte de réception Supabase ;
// l'application de l'ordinateur les relève toutes les minutes.

const PRIORITIES = [
  { value: 1, label: 'P1', hint: '24/48 h', days: 2 },
  { value: 2, label: 'P2', hint: '1 semaine', days: 7 },
  { value: 3, label: 'P3', hint: '1 mois', days: 30 },
  { value: 4, label: 'P4', hint: 'sans délai', days: null }
];
// Utilisées tant que l'ordinateur n'a pas encore envoyé sa liste.
const DEFAULT_CATEGORIES = ['CNRACL', 'Cabinet', 'PSSM', 'Compta', 'PDC', 'Coll', 'Autres']
  .map((name, i) => ({ id: `cat-${i + 1}`, name }));

const KEYS = { code: 'todo.code', categories: 'todo.categories', queue: 'todo.queue' };
const cfg = window.TODO_CONFIG;
const $ = (sel) => document.querySelector(sel);

const state = { priority: 2, categoryId: null, categories: DEFAULT_CATEGORIES };

// ---------- Stockage local (protégé contre les erreurs) ----------

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function remove(key) {
  try { localStorage.removeItem(key); } catch {}
}

// ---------- Supabase ----------

async function rpc(name, body) {
  const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseKey };
  if (cfg.supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${cfg.supabaseKey}`;
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text);
    err.badCode = text.includes('code invalide');
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// ---------- Dates ----------

function pad(n) { return String(n).padStart(2, '0'); }
function isoInDays(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- Affichage ----------

function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

function renderPriorities() {
  const box = $('#priorities');
  box.replaceChildren(...PRIORITIES.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `prio prio-${p.value}` + (p.value === state.priority ? ' selected' : '');
    b.innerHTML = `<strong>${p.label}</strong><small>${p.hint}</small>`;
    b.addEventListener('click', () => setPriority(p.value));
    return b;
  }));
}

function setPriority(value) {
  state.priority = value;
  const p = PRIORITIES.find((x) => x.value === value);
  const input = $('#deadline');
  input.hidden = p.days === null;
  $('#no-deadline').hidden = p.days !== null;
  if (p.days !== null) input.value = isoInDays(p.days);
  renderPriorities();
}

function renderCategories() {
  if (!state.categories.some((c) => c.id === state.categoryId)) state.categoryId = state.categories[0]?.id;
  const box = $('#categories');
  box.replaceChildren(...state.categories.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.id === state.categoryId ? ' selected' : '');
    b.textContent = c.name;
    b.addEventListener('click', () => { state.categoryId = c.id; renderCategories(); });
    return b;
  }));
}

function renderQueue() {
  const n = read(KEYS.queue, []).length;
  const q = $('#queue');
  q.hidden = n === 0;
  q.textContent = `${n} tâche${n > 1 ? 's' : ''} en attente d'envoi (pas de réseau). Envoi automatique dès le retour du réseau.`;
}

function showScreen(name) {
  $('#setup').hidden = name !== 'setup';
  $('#add-form').hidden = name !== 'add';
  $('#change-code').hidden = name !== 'add';
}

// ---------- Envoi ----------

async function send(task) {
  return rpc('todo_add', {
    p_code: read(KEYS.code, ''),
    p_priority: task.priority,
    p_deadline: task.deadline,
    p_text: task.text,
    p_category_id: task.categoryId,
    p_comment: task.comment
  });
}

// Renvoie les tâches restées en attente (envoyées sans réseau).
async function flushQueue() {
  const queue = read(KEYS.queue, []);
  if (!queue.length) return;
  const left = [];
  for (const task of queue) {
    try { await send(task); } catch (err) { if (!err.badCode) left.push(task); }
  }
  write(KEYS.queue, left);
  renderQueue();
  if (left.length < queue.length) toast('Tâches en attente envoyées ✓');
}

async function loadCategories() {
  state.categories = read(KEYS.categories, DEFAULT_CATEGORIES);
  renderCategories();
  try {
    const cats = await rpc('todo_categories', { p_code: read(KEYS.code, '') });
    if (cats && cats.length) {
      state.categories = cats;
      write(KEYS.categories, cats);
      renderCategories();
    }
  } catch (err) {
    if (err.badCode) { remove(KEYS.code); showScreen('setup'); }
  }
}

// ---------- Démarrage ----------

function setupScreens() {
  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#setup-code').value.trim();
    const error = $('#setup-error');
    error.textContent = 'Vérification…';
    try {
      await rpc('todo_categories', { p_code: code });
      write(KEYS.code, code);
      $('#setup-code').value = '';
      error.textContent = '';
      start();
    } catch (err) {
      error.textContent = err.badCode ? 'Code secret incorrect.' : 'Pas de connexion internet. Réessayez.';
    }
  });

  $('#change-code').addEventListener('click', () => {
    if (confirm('Saisir un autre code secret ?')) { remove(KEYS.code); showScreen('setup'); }
  });

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text) { $('#text').focus(); return; }
    const task = {
      priority: state.priority,
      deadline: state.priority === 4 ? null : ($('#deadline').value || null),
      text,
      categoryId: state.categoryId,
      comment: $('#comment').value.trim()
    };
    const btn = $('#submit');
    btn.disabled = true;
    try {
      await send(task);
      toast('Tâche envoyée ✓');
    } catch (err) {
      if (err.badCode) { toast('Code secret refusé.', true); remove(KEYS.code); showScreen('setup'); btn.disabled = false; return; }
      write(KEYS.queue, [...read(KEYS.queue, []), task]);
      renderQueue();
      toast('Pas de réseau : la tâche sera envoyée plus tard.', true);
    }
    btn.disabled = false;
    $('#text').value = '';
    $('#comment').value = '';
    setPriority(2);
  });

  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
}

function start() {
  if (!read(KEYS.code, '')) { showScreen('setup'); return; }
  showScreen('add');
  setPriority(2);
  renderQueue();
  loadCategories();
  flushQueue();
}

setupScreens();
start();
