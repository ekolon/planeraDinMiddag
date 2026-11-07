const SUPABASE_URL = 'https://kflpiicfuinnuzbmmhqw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Gc6nUf19x_ZWgUCP2RJbJQ_QOfRuRL5';

const { createClient } = supabase;

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const kr = n => Math.round(n).toLocaleString('sv-SE') + ' kr';
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); // å/ä/ö -> a/a/o
const words = s => fold(s).replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
const recipeKey = r => (r.url && r.url !== '#') ? r.url : r.name;
// ---------- Inställningar ----------
// Ingredienser som alltid räknas som "finns hemma" (salt, peppar, vatten och kryddor).
// Lägg till fler ord här, helt utan å/ä/ö (t.ex. 'olja' om du alltid har det).
const STAPLE_ENDS   = ['salt', 'peppar', 'pepparkorn', 'pulver', 'vatten', 'chiliflakes'];
const STAPLE_STARTS = ['kanel', 'kardemumma', 'spiskummin', 'oregano', 'timjan', 'gurkmeja', 'lagerblad', 'muskot', 'curry', 'kryddor', 'kryddmix', 'malen'];
const STOP = new Set(['och', 'eller', 'med', 'till', 'per', 'att', 'ska', 'fin', 'god']);
const UNIT = {kg:['kg',1], hg:['kg',.1], g:['kg',.001], l:['l',1], dl:['l',.1], cl:['l',.01], ml:['l',.001], msk:['l',.015], tsk:['l',.005], krm:['l',.001]};
const PAGE = 5;

// ---------- Lagring i webbläsaren (localStorage) ----------
const STORE = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

let recipes = [], prices = {};
let pantry = STORE.get('mp_pantry', []);
let favs = STORE.get('mp_favs', []);
let pantryF = pantry.map(p => fold(p));
let current = [], shown = PAGE;

// ---------- Hjälpfunktioner ----------


function isStaple(name) {
  return words(name).some(w => STAPLE_ENDS.some(e => w.endsWith(e)) || STAPLE_STARTS.some(s => w.startsWith(s)));
}

function inPantry(name) {
  if (!pantryF.length) return false;
  const nf = fold(name).replace(/\(.*?\)/g, ' ');
  const ws = nf.split(/[^a-z0-9]+/).filter(Boolean);
  return pantryF.some(p => p.includes(' ')
    ? nf.includes(p)
    : ws.some(w => w.startsWith(p) || w.endsWith(p) || (w.length >= 3 && !STOP.has(w) && p.startsWith(w))));
}

// ---------- Priser ----------
function findPrice(name) {
  let best = null;
  for (const k in prices) if (name.includes(k) && (!best || k.length > best.length)) best = k;
  return best && prices[best];
}

$('sort').addEventListener('change', run);

// Kostnad i kr, 0 om mängd saknas, null om pris saknas.
function ingCost(ing) {
  if (ing.amount == null) return 0;
  const p = findPrice(ing.name);
  if (!p) return null;
  const u = UNIT[ing.unit];
  if (u) return p.per === 'st' ? null : ing.amount * u[1] * p.price;
  if (p.per === 'st') return ing.amount * p.price;
  if (p.stKg) return ing.amount * p.stKg * p.price;
  return null;
}

// ---------- Analys av ett recept ----------
function analyse(r, portions) {
  const f = portions / (r.servings || 4);
  const missing = [];
  let cost = 0, unknown = 0;
  for (const ing of (r.ingredients || [])) {
    if (isStaple(ing.name) || inPantry(ing.name)) continue;
    missing.push({name: ing.name, amount: ing.amount == null ? null : ing.amount * f, unit: ing.unit});
    const c = ingCost(ing);
    if (c === null) unknown++; else cost += c * f;
  }
  return {r, portions, missing, cost, unknown};
}

function fmtMissing(m) {
  if (m.amount == null) return esc(m.name);
  const n = +m.amount.toFixed(m.amount < 10 ? 1 : 0);
  return `${esc(m.name)} (${n}${m.unit ? ' ' + esc(m.unit) : ''})`;
}

// ---------- Förslag ----------

function run() {
    if (!recipes.length) return;

    const protein = $('protein').value;
    const quick = $('quick').checked;
    const budget = +$('budget').value || 0;
    const portions = +$('total').value || 8;
    const sort = $('sort').value;

    current = recipes
        .filter(r => !protein || (r.tags || []).includes(protein))
        .filter(r => !quick || (r.tags || []).includes('under-30') || (r.minutes && r.minutes <= 30))
        .map(r => analyse(r, portions))
        .filter(a => !budget || a.cost <= budget);

    if (sort === 'pantry') {
        current.sort((a, b) =>
            a.missing.length - b.missing.length
        );
    }

    shown = PAGE;
    renderResults();
}


function favBtn(key) {
  const on = favs.includes(key);
  return `<button type="button" class="fav" data-key="${esc(key)}" aria-pressed="${on}" aria-label="${on ? 'Ta bort från favoriter' : 'Spara som favorit'}" title="${on ? 'Ta bort från favoriter' : 'Spara som favorit'}">${on ? '♥' : '♡'}</button>`;
}

function card(a) {
  const r = a.r;
  const missing = a.missing.length
    ? `<div class="missing"><span class="warn">Saknas:</span> ${a.missing.map(fmtMissing).join(', ')}</div>`
    : `<div class="missing have">Du har allt hemma</div>`;
  const buy = a.missing.length
    ? `<strong>${kr(a.cost)}</strong> <span class="meta">att köpa${a.unknown ? ` (+${a.unknown} utan pris)` : ''}</span>`
    : '';
  return `<div class="recipe"><div>
      <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
      <div class="meta">${a.portions} portioner${r.minutes ? ' · ' + r.minutes + ' min' : ''}</div>
      ${missing}
    </div><div>${buy} ${favBtn(recipeKey(r))}</div></div>`;
}

function renderResults() {
  const out = $('out');
  if (!current.length) {
    out.innerHTML = '<p class="warn">Inga recept matchade. Prova en högre budget, 0 för ingen gräns, eller ta bort filtren.</p>';
    return;
  }
  const list = current.slice(0, shown);
  out.innerHTML = `<h2>Förslag</h2>
    <p class="meta">Visar ${list.length} av ${current.length} recept</p>`
    + list.map(card).join('')
    + (shown < current.length ? `<button type="button" id="more">Visa ${PAGE} till</button>` : '');
}

// ---------- Skafferi ----------
async function savePantry() {
  STORE.set('mp_pantry', pantry);

  pantryF = pantry.map(p => fold(p));

  renderPantry();
  run();

  await saveUserData();
}

function addPantry(text) {
  let changed = false;
  for (const it of text.split(/[,\n]/).map(s => s.trim()).filter(Boolean)) {
    if (!pantry.some(p => fold(p) === fold(it))) { pantry.push(it); changed = true; }
  }
  if (changed) savePantry();
}

function renderPantry() {
  $('pantryList').innerHTML = pantry.map((p, i) =>
    `<span class="chip">${esc(p)}<button type="button" data-rm="${i}" aria-label="Ta bort ${esc(p)}">×</button></span>`).join('')
    + (pantry.length ? `<button type="button" class="linkbtn" id="clearPantry">Töm skafferiet</button>` : '');
}

function buildDatalist() {
  const count = new Map();
  for (const r of recipes) for (const i of (r.ingredients || [])) {
    if (isStaple(i.name)) continue;
    const w = i.name.replace(/\(.*?\)/g, ' ').toLowerCase().split(/[^a-zåäöé]+/).filter(x => x.length >= 3).pop();
    if (w) count.set(w, (count.get(w) || 0) + 1);
  }
  $('ingredientNames').innerHTML = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300)
    .map(([w]) => `<option value="${esc(w)}">`).join('');
}

// ---------- Favoriter ----------
function renderFavs() {
  const items = recipes.filter(r => favs.includes(recipeKey(r)));
  $('favSection').hidden = !items.length;
  $('favs').innerHTML = items.map(r => `<div class="recipe"><div>
      <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
      <div class="meta">${r.minutes ? r.minutes + ' min · ' : ''}${r.servings || 4} portioner</div>
    </div><div>${favBtn(recipeKey(r))}</div></div>`).join('');
}

async function toggleFav(key) {
  favs = favs.includes(key)
    ? favs.filter(k => k !== key)
    : [...favs, key];

  STORE.set('mp_favs', favs);

  renderFavs();

  if (current.length) renderResults();

  await saveUserData();
}

// ---------- Händelser ----------
$('f').addEventListener('submit', e => { e.preventDefault(); run(); });
$('pantryAdd').addEventListener('click', () => { addPantry($('pantryInput').value); $('pantryInput').value = ''; $('pantryInput').focus(); });
$('pantryInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addPantry($('pantryInput').value); $('pantryInput').value = ''; }
});
$('pantryList').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { pantry.splice(+rm.dataset.rm, 1); savePantry(); }
  if (e.target.id === 'clearPantry') { pantry = []; savePantry(); }
});
document.addEventListener('click', e => {
  const fav = e.target.closest('.fav');
  if (fav) toggleFav(fav.dataset.key);
  if (e.target.id === 'more') { shown += PAGE; renderResults(); }
});

// ---------- Starta: läs in data ----------
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

(async () => {
  try {
    recipes = await loadJSON('data/dataRecipies.json');
    prices = await loadJSON('data/dataPrice.json').catch(() => ({}));

    buildDatalist();
    renderPantry();
    renderFavs();
    run();

    // Check whether a user is already logged in
    const { data: { session } } = await db.auth.getSession();

    if (session) {
      $('authStatus').textContent = 'Inloggad!';
      $('logoutBtn').hidden = false;

      await loadUserData();
    }

  } catch (e) {
    $('out').innerHTML = `<p class="warn">Kunde inte läsa recepten: ${esc(e.message)}.</p>`;
  }
})();

async function register(email, password) {
  const { data, error } = await db.auth.signUp({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  alert('Kontot har skapats! Kontrollera din e-post om bekräftelse krävs.');
}

async function login(email, password) {
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  await loadUserData();
}

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) {
    alert(error.message);
    return;
  }

  location.reload();
}

async function loadUserData() {
  const { data: { user }, error: authError } = await db.auth.getUser();

  if (authError || !user) return;

  const { data, error } = await db
    .from('user_data')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Could not load user data:', error);
    return;
  }

  if (data) {
    favs = data.favorites || [];
    pantry = data.pantry || [];
  } else {
    // Create a database entry for this user
    await saveUserData();
  }

  // Update local storage as well
  STORE.set('mp_favs', favs);
  STORE.set('mp_pantry', pantry);

  pantryF = pantry.map(p => fold(p));

  renderPantry();
  renderFavs();
  run();
}


async function saveUserData() {
  const { data: { user }, error: authError } = await db.auth.getUser();

  if (authError || !user) return;

  const { error } = await db
    .from('user_data')
    .upsert({
      user_id: user.id,
      favorites: favs,
      pantry: pantry,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('Could not save user data:', error);
  }
}

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();

  await login(
    $('email').value,
    $('password').value
  );
});

$('registerBtn').addEventListener('click', async () => {
  await register(
    $('email').value,
    $('password').value
  );
});

$('logoutBtn').addEventListener('click', logout);