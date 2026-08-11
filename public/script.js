'use strict';

// SP Demo Builder SPA — vanilla JS. Screens: sign-in gate, connect SDO,
// new demo, manage demos, connected orgs. State is minimal and re-fetched.

const state = {
  me: null, // {id, email, name}
  connections: [], // sf_connections
  activeConnectionId: null,
  deployments: [],
  route: 'newDemo', // newDemo | manageDemos | connectedOrgs
};

// --- tiny helpers ---
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function clearQuery() {
  history.replaceState({}, '', location.pathname);
}

// --- boot ---
async function boot() {
  try {
    state.me = await api('GET', '/api/me');
  } catch {
    state.me = null;
  }
  if (!state.me) return renderSignIn();

  try {
    state.connections = await api('GET', '/api/sf/connections');
  } catch {
    state.connections = [];
  }
  if (state.connections.length) {
    state.activeConnectionId = state.connections[0].id;
  }

  // Surface any OAuth redirect messages.
  const sfErr = qs('sf_error');
  const authErr = qs('auth_error');
  if (sfErr || authErr) clearQuery();

  renderApp({ banner: sfErr ? { type: 'error', msg: 'Salesforce: ' + sfErr } : null });
}

// --- sign-in gate ---
function renderSignIn() {
  $('#headerControls').innerHTML = '';
  $('#navControls').innerHTML = '';
  const authErr = qs('auth_error');
  const app = $('#app');
  app.innerHTML = '';
  const arrivedDirect = !qs('config');
  app.appendChild(
    el('div', { class: 'centered-gate' }, [
      arrivedDirect
        ? el('div', { class: 'banner info' }, [
            el('strong', {}, 'Start in the Experience Generator. '),
            el('span', {}, 'This tool takes a demo you designed there and makes it live in an SDO. '),
            el('a', { href: EXPERIENCE_GENERATOR_URL, target: '_blank' }, 'Open the Experience Generator →'),
          ])
        : null,
      el('div', { class: 'card' }, [
        el('h2', {}, 'Sign in'),
        el('p', { class: 'muted' }, 'Internal tool for Salesforce SEs. Sign in with your @salesforce.com Google account.'),
        authErr === 'domain_not_allowed'
          ? el('div', { class: 'banner error' }, 'That email domain is not allowed. Use your @salesforce.com account.')
          : null,
        // Carry the current URL (incl. ?config= from the Experience Generator
        // handoff) through the OAuth round-trip so the prefill survives sign-in.
        el('a', { class: 'btn google', href: '/auth/google?returnTo=' + encodeURIComponent(location.pathname + location.search) }, 'Sign in with Google'),
      ]),
    ])
  );
  if (authErr) clearQuery();
}

// Right side of the control bar: signed-in email + sign out.
function renderHeaderControls() {
  const controls = $('#headerControls');
  controls.innerHTML = '';
  if (!state.me) return;
  controls.appendChild(el('span', { class: 'user-email' }, state.me.email));
  controls.appendChild(
    el('button', { class: 'btn secondary', onclick: logout }, 'Sign out')
  );
}

// Left side of the control bar: primary nav tabs (only once an org is connected).
function renderNavControls() {
  const nav = $('#navControls');
  nav.innerHTML = '';
  if (!state.me || !state.connections.length) return;
  const items = [
    ['newDemo', 'New Demo'],
    ['manageDemos', 'Manage Demos'],
    ['connectedOrgs', 'Connected Orgs'],
  ];
  items.forEach(([route, label]) => {
    nav.appendChild(
      el('button', {
        class: 'nav-tab' + (state.route === route ? ' active' : ''),
        onclick: () => { state.route = route; renderApp(); },
      }, label)
    );
  });
}

async function logout() {
  try { await api('POST', '/auth/logout'); } catch {}
  location.href = '/';
}

// --- main app shell ---
function renderApp({ banner } = {}) {
  renderHeaderControls();
  renderNavControls();
  const app = $('#app');
  app.innerHTML = '';

  // No connected org yet -> force Connect SDO screen.
  if (!state.connections.length) {
    app.appendChild(renderConnectSdo());
    return;
  }

  if (banner) app.appendChild(el('div', { class: 'banner ' + banner.type }, banner.msg));

  if (state.route === 'newDemo') app.appendChild(renderNewDemo());
  else if (state.route === 'manageDemos') app.appendChild(renderManageDemos());
  else if (state.route === 'connectedOrgs') app.appendChild(renderConnectedOrgs());
}

// --- Connect SDO ---
const EXPERIENCE_GENERATOR_URL = 'https://whispering-coast-03303-5bb1f6fb1c95.herokuapp.com';

function renderConnectSdo() {
  const wrap = el('div', { class: 'centered-gate' });

  // Callout: this app is meant to be reached from the Experience Generator,
  // where the SE first designs the experience. Direct visitors get pointed back.
  const arrivedDirect = !qs('config');
  if (arrivedDirect) {
    wrap.appendChild(
      el('div', { class: 'banner info' }, [
        el('strong', {}, 'Start in the Experience Generator. '),
        el('span', {}, 'Design your experience there first, then use “Connect to SDO for Live Demo” to bring it here with everything pre-filled. '),
        el('a', { href: EXPERIENCE_GENERATOR_URL, target: '_blank' }, 'Open the Experience Generator →'),
      ])
    );
  }

  const card = el('div', { class: 'card' }, [
    el('h2', {}, 'Connect Your SDO'),
    el('p', { class: 'muted' }, 'Connect a Salesforce SDO with Data Cloud + Personalization enabled. The app deploys the demo objects into this org.'),
  ]);
  card.appendChild(
    el('div', { style: 'margin-top:1rem' }, [
      el('a', {
        class: 'btn',
        href: '#',
        onclick: (e) => { e.preventDefault(); location.href = '/auth/salesforce'; },
      }, 'Connect to Salesforce'),
    ])
  );
  card.appendChild(
    el('ul', { class: 'check-list small', style: 'margin-top:1.25rem' }, [
      el('li', {}, [el('span', { class: 'status-dot unknown' }), 'Data Cloud enabled']),
      el('li', {}, [el('span', { class: 'status-dot unknown' }), 'Personalization enabled']),
      el('li', {}, [el('span', { class: 'status-dot unknown' }), 'Profile Data Graph exists']),
      el('li', {}, [el('span', { class: 'status-dot unknown' }), 'Permission set: Personalization Admin']),
    ])
  );
  card.appendChild(el('p', { class: 'muted small' }, 'Prerequisites are verified after connecting.'));
  wrap.appendChild(card);
  return wrap;
}

// --- New Demo ---
let _catalog = null;
async function loadCatalog() {
  if (!_catalog) _catalog = await api('GET', '/api/sf/catalog');
  return _catalog;
}

// Holds an uploaded HTML file's contents when the SE brings their own export.
let _uploadedHtml = null;

// New Demo guided-journey state. The card is BUILT ONCE and cached so every
// input keeps its identity + typed value across step navigation — steps are
// shown/hidden, never re-rendered. runDeploy()/the file handler therefore read
// the exact same live elements as before (deploy contract unchanged).
let _newDemoCard = null;
let _newDemoStep = 1;
let _newDemoSource = null; // 'form' | 'upload'
let _newDemoReady = null; // null=unknown, true/false from prereq check
// ADDITIONAL named variations the SE types in the app (beyond the base
// uploaded experience). GUIDED: each variation targets ONE surface, chosen from
// a type dropdown first, then only that surface's fields show:
//   type 'hero'     → a Hero swap → named Decision on the Homepage Hero PP only
//   type 'articles' → Personalized articles → named Decisions on the 3 card PPs only
// A variation carries BOTH sub-objects but only the one matching its type is
// sent at deploy (see runDeploy). Shape:
//   { name, type:'hero'|'articles',
//     hero:{eyebrow,header,subheader,cta,image}, cards:[{category,title,body,image} x3] }
function blankVariation() {
  return {
    name: '',
    type: 'hero',
    _expanded: true, // UI-only collapse state (stripped before deploy)
    hero: { eyebrow: '', header: '', subheader: '', cta: '', image: '' },
    cards: [0, 1, 2].map(() => ({ category: '', title: '', body: '', image: '' })),
  };
}
let _newDemoVariations = []; // starts empty; base upload is the first decision
// The base experience (uploaded file) is decision 1 / "Variation 1". Its content
// is hard-coded from the file (read-only); only its WPM label is editable here.
let _baseVariationName = 'Personalized';
let _baseExpanded = true; // collapse state for the base card

// A single text field bound to obj[key]. onInput (optional) fires after each
// keystroke so the caller can refresh a live preview in place.
function vField(labelText, obj, key, placeholder, onInput) {
  const input = el('input', { type: 'text', value: obj[key] || '', placeholder: placeholder || '',
    oninput: (e) => { obj[key] = e.target.value; onInput && onInput(); } });
  return el('div', { style: 'margin-bottom:8px' }, [
    el('label', { style: 'margin:6px 0 3px; font-size:13px' }, labelText), input,
  ]);
}

// An image field: paste a URL OR pick a file (read as data URI). Stores into
// obj.image; the server hosts it on Cloudinary at deploy (handles URL or data URI).
function vImageField(labelText, obj, onInput) {
  const urlInput = el('input', { type: 'text', value: /^data:/.test(obj.image || '') ? '' : (obj.image || ''),
    placeholder: 'Paste an image URL, or choose a file →',
    oninput: (e) => { obj.image = e.target.value.trim(); refresh(); onInput && onInput(); } });
  const fileIn = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const pick = el('button', { type: 'button', class: 'btn secondary small', onclick: () => fileIn.click() }, 'Choose image…');
  const note = el('span', { class: 'small muted', style: 'margin-left:8px' });
  function refresh() {
    if (/^data:/.test(obj.image || '')) { note.textContent = '✓ image selected'; urlInput.value = ''; }
    else if (obj.image) note.textContent = '✓ URL set';
    else note.textContent = '';
  }
  fileIn.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { obj.image = String(r.result || ''); refresh(); onInput && onInput(); };
    r.readAsDataURL(f);
  });
  refresh();
  return el('div', { style: 'margin-bottom:8px' }, [
    el('label', { style: 'margin:6px 0 3px; font-size:13px' }, labelText),
    el('div', { style: 'display:flex;gap:8px;align-items:center' }, [el('div', { style: 'flex:1' }, urlInput), pick, fileIn, note]),
  ]);
}

// A collapsible card shell: a header row (chevron + title + optional badge/
// controls) and a body that shows/hides on toggle. The toggle flips the DOM in
// place (no re-render, so preview iframes are not reloaded) and persists the
// state via setOpen. `titleNode` (a DOM node, e.g. an editable input) takes
// precedence over the `title` string.
function collapsibleCard(opts) {
  const { title, titleNode, subtitle, badge, controls, body, isOpen, setOpen } = opts;
  const chevron = el('span', { style: 'display:inline-block;width:14px;flex:none;transition:transform .15s;transform:rotate(' + (isOpen() ? 90 : 0) + 'deg);color:#8a94a6' }, '▶');
  const titleWrap = el('div', { style: 'flex:1;min-width:0' }, [
    el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
      titleNode || el('span', { style: 'font-weight:700;color:#2b3a4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, title),
      badge || null,
    ]),
    subtitle ? el('div', { class: 'small muted', style: 'margin-top:2px' }, subtitle) : null,
  ]);
  const bodyWrap = el('div', { style: 'padding:0 14px 14px;' + (isOpen() ? '' : 'display:none') }, body);
  const header = el('div', {
    style: 'display:flex;align-items:center;gap:10px;cursor:pointer;padding:12px 14px',
    onclick: () => {
      const open = !isOpen();
      setOpen(open);
      bodyWrap.style.display = open ? '' : 'none';
      chevron.style.transform = 'rotate(' + (open ? 90 : 0) + 'deg)';
    },
  }, [chevron, titleWrap, controls || null]);
  return el('div', { style: 'border:1px solid #e8eaed;border-radius:10px;margin-bottom:12px;background:#fff' }, [header, bodyWrap]);
}

// The "Additional variations" section. Leads with the read-only BASE variation
// (decision 1, from the uploaded file — only its name is editable), then the
// SE's typed variations (fully editable). Each card collapses to reduce clutter.
function buildVariationsSection(onChange) {
  const host = el('div');
  const render = () => {
    host.innerHTML = '';
    host.appendChild(baseVariationCard(onChange));
    _newDemoVariations.forEach((v, idx) => host.appendChild(variationCard(v, idx, render, onChange)));
    host.appendChild(el('button', { type: 'button', class: 'btn secondary small', style: 'margin-top:4px',
      onclick: () => { _newDemoVariations.push(blankVariation()); render(); onChange && onChange(); } },
      '+ Add another variation'));
  };
  const section = el('div', { style: 'margin-top:16px; padding-top:14px; border-top:1px solid #e8eaed' }, [
    el('strong', {}, 'Variations'),
    el('p', { class: 'small muted', style: 'margin:0.35rem 0 0.75rem' },
      'These become the options in WPM’s decision dropdown. Variation 1 is your uploaded experience (the default). Add more named versions — a Hero swap (homepage banner) or Personalized articles (the 3 insight cards) — then name each (e.g. Mortgage, Auto Loan) and fill its fields. Blanks can be finished later in WPM.'),
    host,
  ]);
  render();
  return section;
}

// Variation 1: the uploaded file. Read-only content (hard-coded from the file);
// only the WPM label (_baseVariationName) is editable. Collapsible.
function baseVariationCard(onChange) {
  const nameInput = el('input', { type: 'text', value: _baseVariationName,
    placeholder: 'Default variation name (shows in WPM)',
    onclick: (e) => e.stopPropagation(), // don't toggle the card when editing the name
    oninput: (e) => { _baseVariationName = e.target.value; onChange && onChange(); } });
  const lock = el('span', { class: 'small', style: 'background:#eef1f5;color:#5f6b7a;border-radius:20px;padding:2px 9px;font-weight:600;white-space:nowrap' }, '🔒 from your file');
  return collapsibleCard({
    title: 'Variation 1 · Default',
    subtitle: 'Your uploaded experience — shown by default in WPM. Content comes from the file; only the name is editable.',
    badge: lock,
    isOpen: () => _baseExpanded,
    setOpen: (v) => { _baseExpanded = v; },
    body: [
      el('div', { style: 'margin-bottom:8px' }, [
        el('label', { style: 'margin:6px 0 3px; font-size:13px' }, 'Variation name (WPM label)'),
        nameInput,
      ]),
      basePreviewNode(),
    ],
  });
}

// --- Live preview backed by the REAL uploaded markup -----------------------
// The Adaptive Web export always follows a fixed format (Tailwind CDN + one
// inline <style> with brand CSS vars; hero = #warm-homepage-section's first
// <section>; cards = #warm-insights-grid of <article class="home-insight-card">).
// To show the SE exactly what WPM will render, we reuse that real markup inside
// an iframe (Tailwind + the file's own <style>) and swap the variation's fields
// into the mapped sub-elements. Cached once per upload from _uploadedHtml.
let _baseTemplate = null; // { style, heroHTML, gridHTML } | null

function cacheBaseTemplate(html) {
  _baseTemplate = null;
  if (!html || typeof html !== 'string') return;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const style = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    const warm = doc.getElementById('warm-homepage-section');
    // Hero banner = the first <section> inside the warm block (the second
    // section is the Market Insights grid).
    const heroSection = warm && warm.querySelector('section');
    const grid = doc.getElementById('warm-insights-grid');
    _baseTemplate = {
      style,
      heroHTML: heroSection ? heroSection.outerHTML : null,
      gridHTML: grid ? grid.outerHTML : null,
    };
  } catch (_) { _baseTemplate = null; }
}

// Wrap a real markup fragment in a minimal doc that carries Tailwind + the
// file's own styles, so the fragment renders exactly as in the experience.
function previewSrcdoc(fragmentHTML) {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<script src="https://cdn.tailwindcss.com"><\/script>'
    + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">'
    + '<style>' + (_baseTemplate ? _baseTemplate.style : '') + '</style>'
    + '<style>body{margin:0;background:#fff;overflow-x:hidden}</style></head>'
    + '<body>' + fragmentHTML + '</body></html>';
}

// Apply the hero variation fields onto the real hero markup inside the iframe
// doc. Only non-empty fields override; blanks keep the base creative so the
// preview always looks like a complete experience (mirrors WPM element swaps).
function applyHeroOverrides(doc, hero) {
  const root = doc.body.firstElementChild;
  if (!root) return;
  const set = (elm, val) => { if (elm && val) elm.textContent = val; };
  const ps = root.querySelectorAll('p');
  set(ps[0], hero.eyebrow);            // eyebrow ("Welcome back, …")
  set(root.querySelector('h1'), hero.header);
  set(ps[1], hero.subheader);          // subtext paragraph
  const cta = root.querySelector('a, button');
  if (cta && hero.cta) {
    // Keep any leading icon; replace the trailing label text node.
    const lastText = Array.from(cta.childNodes).reverse().find((n) => n.nodeType === 3 && n.textContent.trim());
    if (lastText) lastText.textContent = ' ' + hero.cta; else cta.textContent = hero.cta;
  }
  const img = root.querySelector('img');
  if (img && hero.image) img.setAttribute('src', hero.image);
}

// Apply the 3 card variations onto the real #warm-insights-grid markup.
function applyCardOverrides(doc, cards) {
  const arts = doc.querySelectorAll('article');
  cards.forEach((c, i) => {
    const art = arts[i];
    if (!art) return;
    const catAndTitle = art.querySelector('div > div, .uppercase');
    // Category is the small uppercase div sitting just before the <h3>.
    const h3 = art.querySelector('h3');
    let cat = h3 && h3.previousElementSibling;
    if (cat && cat.tagName === 'DIV' && c.category) cat.textContent = c.category;
    if (h3 && c.title) h3.textContent = c.title;
    const p = art.querySelector('p');
    if (p && c.body) p.textContent = c.body;
    const img = art.querySelector('img');
    if (img && c.image) img.setAttribute('src', c.image);
  });
}

// Build a preview iframe for a real markup fragment. applyFn(doc) applies the
// variation overrides (or null for a read-only base preview). Returns { frame,
// refresh }: the iframe loads async (Tailwind + the file's styles), then un-hides
// the warm block, runs applyFn, and auto-sizes to content. refresh() re-runs
// applyFn on the already-loaded frame (no reload → no Tailwind flicker).
function makePreviewFrame(fragmentHTML, applyFn) {
  const frame = el('iframe', {
    style: 'width:100%;border:1px solid #e8eaed;border-radius:10px;background:#fff;height:220px',
    scrolling: 'no', sandbox: 'allow-scripts allow-same-origin',
    srcdoc: previewSrcdoc(fragmentHTML),
  });
  let loaded = false;
  const size = () => { try { frame.style.height = Math.max(120, frame.contentDocument.body.scrollHeight) + 'px'; } catch (_) {} };
  const apply = () => {
    if (!loaded) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    if (applyFn) applyFn(doc);
    size(); setTimeout(size, 150);
  };
  frame.addEventListener('load', () => {
    loaded = true;
    const doc = frame.contentDocument;
    if (!doc) return;
    // Un-hide the warm block (it ships hidden until personalization fires).
    doc.querySelectorAll('[hidden],.hidden,[aria-hidden="true"]').forEach((n) => {
      n.removeAttribute('hidden'); n.removeAttribute('aria-hidden'); n.classList.remove('hidden');
    });
    apply();
    setTimeout(size, 250); setTimeout(size, 700); // Tailwind applies async
  });
  return { frame, refresh: apply };
}

const previewLabel = (t) => el('div', { class: 'small', style: 'font-weight:700;color:#5f6b7a;margin:0 0 6px' }, t);

// Read-only preview of the BASE experience (decision 1) straight from the
// uploaded file — no overrides. Shows both surfaces (hero + the 3 cards) since
// the base decision targets every PP. This is what "Personalized" renders in WPM.
function basePreviewNode() {
  const wrap = el('div');
  if (!_baseTemplate || (!_baseTemplate.heroHTML && !_baseTemplate.gridHTML)) {
    wrap.appendChild(el('div', { class: 'small muted', style: 'padding:10px;border:1px dashed #e0e3e7;border-radius:8px' },
      'Upload your Adaptive Web file above — it becomes your first variation (the default WPM decision).'));
    return wrap;
  }
  if (_baseTemplate.heroHTML) {
    wrap.appendChild(el('div', { style: 'margin-bottom:12px' }, [previewLabel('Homepage hero'), makePreviewFrame(_baseTemplate.heroHTML, null).frame]));
  }
  if (_baseTemplate.gridHTML) {
    wrap.appendChild(el('div', {}, [previewLabel('Market Insights'), makePreviewFrame(_baseTemplate.gridHTML, null).frame]));
  }
  return wrap;
}

// Live preview of a typed variation, rendered from the REAL uploaded markup so
// it matches the experience exactly. Overrides only the fields the SE filled;
// blanks keep the base creative (mirrors WPM element swaps). wrap.refresh()
// re-applies field values in place for live keystroke updates.
function variationPreviewNode(v) {
  const wrap = el('div', { style: 'margin-top:12px;padding-top:10px;border-top:1px dashed #e0e3e7' }, [
    previewLabel('Live preview — what WPM will show'),
  ]);
  const fragment = v.type === 'articles' ? (_baseTemplate && _baseTemplate.gridHTML) : (_baseTemplate && _baseTemplate.heroHTML);
  if (!fragment) {
    wrap.appendChild(el('div', { class: 'small muted', style: 'padding:10px;border:1px dashed #e0e3e7;border-radius:8px' },
      'Upload your Adaptive Web file above to preview this variation in the real layout.'));
    return wrap;
  }
  const built = makePreviewFrame(fragment, (doc) => {
    if (v.type === 'articles') applyCardOverrides(doc, v.cards); else applyHeroOverrides(doc, v.hero);
  });
  wrap.appendChild(built.frame);
  wrap.refresh = built.refresh;
  return wrap;
}

// One guided variation card (an EDITABLE extra). Collapsible: the name stays
// visible in the header; the body leads with the type dropdown (edit B), then
// ONLY that surface's fields, then a live preview that refreshes in place on
// every keystroke. Changing the type re-renders the card (irrelevant fields go).
function variationCard(v, idx, rerender, onChange) {
  // Preview built ONCE (iframe with the real markup); keystrokes call its
  // in-place refresh so Tailwind isn't reloaded and inputs keep focus.
  const previewNode = variationPreviewNode(v);
  const updatePreview = () => { if (previewNode.refresh) previewNode.refresh(); };

  const typeSelect = el('select', {
    onchange: (e) => { v.type = e.target.value; rerender(); onChange && onChange(); },
  }, [
    el('option', { value: 'hero', selected: v.type === 'hero' ? 'selected' : null }, 'Hero swap — homepage banner'),
    el('option', { value: 'articles', selected: v.type === 'articles' ? 'selected' : null }, 'Personalized articles — the 3 insight cards'),
  ]);
  const typeRow = el('div', { style: 'margin-bottom:8px' }, [
    el('label', { style: 'margin:0 0 3px; font-size:13px' }, 'What are you personalizing?'),
    typeSelect,
  ]);

  // Name lives in the collapsible header so it stays visible when collapsed.
  const nameInput = el('input', { type: 'text', value: v.name || '',
    placeholder: 'Variation name (e.g. Mortgage) — shows in WPM',
    style: 'margin:0',
    onclick: (e) => e.stopPropagation(), // editing the name shouldn't toggle
    oninput: (e) => { v.name = e.target.value; onChange && onChange(); } });
  const removeBtn = el('button', { type: 'button', class: 'btn ghost small',
    onclick: (e) => { e.stopPropagation(); _newDemoVariations.splice(idx, 1); rerender(); onChange && onChange(); } }, 'Remove');

  // Only the surface matching the chosen type is shown (and later sent). Each
  // field passes updatePreview so the live preview refreshes as they type.
  const surface = v.type === 'articles'
    ? v.cards.map((c, i) => el('div', { style: 'margin-top:8px' }, [
        el('div', { class: 'small', style: 'font-weight:700;color:#2b3a4a;margin-bottom:4px' }, `Market Insights — Card ${i + 1}`),
        vField('Category', c, 'category', 'e.g. MORTGAGE', updatePreview),
        vField('Title', c, 'title', '', updatePreview),
        vField('Body', c, 'body', '', updatePreview),
        vImageField('Card image', c, updatePreview),
      ]))
    : [el('div', { style: 'margin-top:8px' }, [
        el('div', { class: 'small', style: 'font-weight:700;color:#2b3a4a;margin-bottom:4px' }, 'Homepage Hero'),
        vField('Eyebrow', v.hero, 'eyebrow', 'e.g. WELCOME BACK', updatePreview),
        vField('Header', v.hero, 'header', 'e.g. Mortgage rates just dropped', updatePreview),
        vField('Subheader', v.hero, 'subheader', '', updatePreview),
        vField('CTA text', v.hero, 'cta', 'e.g. See your rate', updatePreview),
        vImageField('Hero image', v.hero, updatePreview),
      ])];

  const badge = el('span', { class: 'small', style: 'background:#eef1f5;color:#5f6b7a;border-radius:20px;padding:2px 9px;font-weight:600;white-space:nowrap' },
    v.type === 'articles' ? 'Articles' : 'Hero');
  return collapsibleCard({
    titleNode: el('div', { style: 'flex:1;min-width:0' }, nameInput),
    badge,
    controls: removeBtn,
    isOpen: () => v._expanded !== false,
    setOpen: (open) => { v._expanded = open; },
    body: [typeRow, ...surface, previewNode],
  });
}

// Drop the cached New Demo card so the next render rebuilds a clean journey.
// Called after a successful deploy and when the connected org changes.
function resetNewDemo() {
  _newDemoCard = null;
  _newDemoStep = 1;
  _newDemoSource = null;
  _newDemoReady = null;
  _uploadedHtml = null;
  cacheBaseTemplate(null);
  _newDemoVariations = [];
  _baseVariationName = 'Personalized';
  _baseExpanded = true;
}

// Stepper header (1 Ready · 2 Bring experience · 3 Target & deploy).
function buildStepper(current) {
  const steps = [['Ready', 1], ['Bring experience', 2], ['Review & deploy', 3]];
  const wrap = el('div', { class: 'stepper' });
  steps.forEach(([label, n], i) => {
    const cls = n < current ? 'done' : n === current ? 'active' : '';
    wrap.appendChild(el('div', { class: 'step-node ' + cls }, [
      el('div', { class: 'step-dot' }, n < current ? '✓' : String(n)),
      el('div', { class: 'step-label' }, label),
    ]));
    if (i < steps.length - 1) wrap.appendChild(el('div', { class: 'step-line' }));
  });
  return wrap;
}

function activeConnection() {
  return state.connections.find((c) => c.id === state.activeConnectionId) || state.connections[0];
}

function renderNewDemo() {
  // Build once; thereafter just re-show the cached card so inputs keep their
  // typed values and identities across step navigation.
  if (_newDemoCard) return _newDemoCard;

  const conn = activeConnection();
  const card = el('div', { class: 'card' });
  _newDemoCard = card;
  card.appendChild(el('h2', {}, 'New Demo'));
  card.appendChild(el('p', { class: 'step-hint' },
    'Take an experience you designed and stand up a real Salesforce Personalization setup for it in your SDO — in minutes, not a week.'));

  // Prefill from handoff (?config=...) if present.
  let prefill = {};
  const cfg = qs('config');
  const fromHandoff = !!cfg;
  if (cfg) {
    try { prefill = JSON.parse(decodeURIComponent(cfg)); } catch {}
  }
  // Arriving from the Experience Generator defaults the source to upload.
  if (fromHandoff && _newDemoSource === null) _newDemoSource = 'upload';

  // Handoff banner.
  if (fromHandoff) {
    card.appendChild(el('div', { class: 'banner info callout-flex' }, [
      el('div', { class: 'callout-icon' }, '↪'),
      el('div', {}, [
        el('div', { html: '<strong>Brought over from the Experience Generator.</strong> Your brand, colors, and use case are pre-filled in Step 2.' }),
        el('div', { class: 'small', style: 'margin-top:4px' },
          'In Step 2 you’ll upload the Adaptive Web file you downloaded there, so the live demo shows your exact creative.'),
      ]),
    ]));
  }

  const stepperHost = el('div');
  card.appendChild(stepperHost);
  const refreshStepper = () => { stepperHost.innerHTML = ''; stepperHost.appendChild(buildStepper(_newDemoStep)); };

  const form = el('div');
  const nameInput = el('input', { type: 'text', id: 'demoName', placeholder: 'e.g. Cumulus Warm Homepage v1', value: prefill.demoName || '' });
  const brandInput = el('input', { type: 'text', id: 'brandName', value: prefill.adaptiveBrandName || 'Cumulus Bank' });
  const industrySel = el('select', { id: 'industrySel' });
  const useCaseSel = el('select', { id: 'useCaseSel' });
  const primaryInput = el('input', { type: 'color', id: 'primaryColor', value: prefill.adaptivePrimaryColor || '#2a94d6' });
  const accentInput = el('input', { type: 'color', id: 'accentColor', value: prefill.adaptiveAccentColor || '#0176d3' });
  // Profile Data Graph to bind Personalization Points to. Auto-discovery via API
  // is unreliable (graphs aren't queryable as SOQL objects), so this is an
  // editable field pre-filled with the org's known graph.
  const dataGraphInput = el('input', {
    type: 'text', id: 'dataGraphName',
    // Default to the Real-Time profile graph — WPM's Embedded-Content picker only
    // lists PPs bound to a real-time profile data graph (batch/marketing graphs
    // are ignored). Editable for other orgs.
    value: prefill.profileDataGraphName || 'Real_Time_Personalization',
    placeholder: 'e.g. Real_Time_Personalization',
  });
  // Website connector id (UUID) or the full beacon <script src> from the org's
  // Web SDK install snippet. This drives the live beacon that makes WPM attach.
  // Data Cloud Setup → Websites & Mobile Apps → your connector → install code.
  const connectorInput = el('input', {
    type: 'text', id: 'connectorId',
    // Pre-fill the known meshmesh Website connector so the live beacon is wired
    // by default — leaving it blank injects a commented-out beacon and WPM can't
    // attach. Editable for other orgs/connectors.
    value: prefill.connector || 'cec9b1f4-0e16-4c62-923d-afd61d237da0',
    placeholder: 'connector id (UUID) or full https://cdn.c360a.salesforce.com/beacon/... URL',
  });

  // Generator-only fields (form path). Shown when the "Design it here" source is
  // chosen. Same inputs/IDs as before — just grouped under a source panel.
  const configFields = el('div', { class: 'config-fields' }, [
    el('label', {}, 'Industry template'), industrySel,
    el('label', {}, 'Use case / vignette'), useCaseSel,
    el('label', {}, 'Brand name'), brandInput,
    el('div', { class: 'field-row' }, [
      el('div', {}, [el('label', {}, 'Primary color'), primaryInput]),
      el('div', {}, [el('label', {}, 'Accent color'), accentInput]),
    ]),
  ]);

  // --- Base experience: the ONE simulator file (as before). Its extracted
  //     content is the first WPM decision ("Personalized").
  _uploadedHtml = null;
  const HAS_ZONES = (h) => /warm-homepage-section|warm-insights-grid|floating-cards-container|cat-hero/.test(h || '');
  const uploadStatus = el('div', { class: 'small muted', style: 'margin-top:0.75rem' });
  const fileInput = el('input', { type: 'file', accept: '.html,text/html', id: 'uploadFile', style: 'display:none' });
  const chooseBtn = el('button', { type: 'button', class: 'btn secondary upload-btn', onclick: () => fileInput.click() }, 'Choose downloaded HTML file…');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { _uploadedHtml = null; uploadStatus.textContent = ''; applySource(); return; }
    const reader = new FileReader();
    reader.onload = () => {
      _uploadedHtml = String(reader.result || '');
      cacheBaseTemplate(_uploadedHtml); // parse hero/cards markup + styles for live preview
      const ok = HAS_ZONES(_uploadedHtml);
      uploadStatus.className = ok ? 'banner success small' : 'banner error small';
      uploadStatus.style.marginTop = '0.75rem';
      chooseBtn.textContent = ok ? `✓ ${file.name}` : 'Choose downloaded HTML file…';
      uploadStatus.textContent = ok
        ? `Hosting “${file.name}” (${Math.round(_uploadedHtml.length / 1024)} KB) as-is — this is your base experience (the first WPM decision).`
        : `“${file.name}” doesn’t look like an Adaptive Web export (content zones not found). It won’t work as a live demo.`;
      if (!ok) { _uploadedHtml = null; cacheBaseTemplate(null); }
      applySource();
    };
    reader.readAsText(file);
  });

  const uploadCard = el('div', { class: 'card upload-card', style: 'margin-top:1rem' }, [
    el('strong', {}, 'Upload your downloaded experience'),
    el('p', { class: 'small muted', style: 'margin:0.35rem 0 0.75rem' },
      'Host the Adaptive Web HTML you downloaded from the Experience Generator. This is your base personalized experience. You can add more named variations below (optional) — each becomes a swappable option in WPM.'),
    chooseBtn, fileInput, uploadStatus,
  ]);

  // --- Additional variations (OPTIONAL): typed content, one named Decision each.
  //     Rendered by buildVariationsSection() (defined below), appended to step2.
  const variationsSection = buildVariationsSection(() => applySource());
  // ---- Assemble the three step sections (inputs above are reused as-is). ----

  // STEP 1 — org readiness + org-side prework (Profile Data Graph is placed
  // inline in the readiness host; the Website connector block is below it).
  const step1 = el('div', { class: 'step-section' });
  const readinessHost = el('div');
  step1.appendChild(el('h3', {}, 'First — is your org ready?'));
  step1.appendChild(el('p', { class: 'step-hint' },
    'A live Personalization demo needs a bit of one-time setup in the SDO. Confirm each item below, then re-check.'));
  step1.appendChild(readinessHost);

  // Website connector — org prework (configured once in the SDO). Lives in
  // Step 1 with a how-to card; connectorInput is the same element the deploy
  // reads. Placed outside readinessHost so a re-check doesn't wipe it.
  const connectorBlock = el('div', { style: 'margin-top:20px; padding-top:18px; border-top:1px solid #e8eaed' }, [
    el('h3', { style: 'font-size:15px' }, 'Website connector (one-time SDO setup)'),
    el('div', { class: 'banner info small callout-flex', style: 'margin-top:8px' }, [
      el('div', { class: 'callout-icon' }, 'i'),
      el('div', {}, [
        el('div', { html: '<strong>New to this? Set up a Website connector once per org.</strong>' }),
        el('ol', { class: 'small', style: 'margin:6px 0 0 1.1rem; line-height:1.6' }, [
          el('li', { html: 'In the SDO: <code>Data Cloud Setup → Websites &amp; Mobile Apps → New</code>, create a <strong>Website</strong> connector.' }),
          el('li', { html: 'Open the connector and copy its <strong>connector id</strong> (a UUID) — or the whole <code>&lt;script src&gt;</code> from its Web SDK install snippet.' }),
          el('li', 'Paste it below. This drives the live beacon that makes WPM attach to your hosted page.'),
        ]),
        el('div', { class: 'small', style: 'margin-top:8px' },
          'After your first deploy on this connector you’ll upload a sitemap once (we give you the file + steps). It’s the same for every demo, so later demos on this SDO skip it.'),
      ]),
    ]),
    el('label', {}, 'Website connector id'),
    connectorInput,
    el('p', { class: 'small muted', style: 'margin-top:0.25rem' },
      'Leave blank to host the page without a live beacon (WPM won’t attach — fine for a preview, not for a live demo).'),
  ]);
  step1.appendChild(connectorBlock);

  // STEP 2 — bring your experience (name + source choice: form OR upload).
  const step2 = el('div', { class: 'step-section hidden' });
  step2.appendChild(el('h3', {}, 'Bring your experience'));
  step2.appendChild(el('p', { class: 'step-hint' },
    'Start from an Adaptive Web file you downloaded in the Experience Generator, or build one here. Pick one — they don’t mix.'));
  step2.appendChild(el('label', {}, 'Demo name'));
  step2.appendChild(nameInput);
  const nameHint = el('p', { class: 'small muted', style: 'margin-top:0.25rem' },
    'Name your demo first — then choose how to bring in your experience below.');
  step2.appendChild(nameHint);

  const uploadPanel = el('div', { class: 'source-panel' }, [
    el('div', { class: 'banner warn callout-flex' }, [
      el('div', { class: 'callout-icon' }, '⬇'),
      el('div', {}, [
        el('div', { html: '<strong>Download your Adaptive Web file first.</strong> In the Experience Generator, use <strong>Download</strong> to save the HTML, then upload that file here.' }),
        el('div', { class: 'small', style: 'margin-top:4px' },
          'The downloaded file carries your real hero image and copy, so the live demo shows the exact creative you designed.'),
        el('a', { href: EXPERIENCE_GENERATOR_URL, target: '_blank', class: 'small' }, 'Open the Experience Generator →'),
      ]),
    ]),
    uploadCard,
    variationsSection,
  ]);
  const formPanel = el('div', { class: 'source-panel' }, [configFields]);

  const sourceChoice = el('div', { class: 'source-choice' });
  // The demo name gates the source choice: no name -> the cards + panels are
  // dimmed/disabled so an SE can't pick a file before naming the demo (and then
  // miss the name entirely). Enabled live as they type.
  const hasName = () => nameInput.value.trim().length > 0;
  // Upload path is ready when the BASE file is uploaded and every ADDED
  // variation (optional) has a name. Variations with no name block Next.
  const uploadReady = () => !!_uploadedHtml && _newDemoVariations.every((v) => (v.name || '').trim());
  const applySource = () => {
    const locked = !hasName();
    sourceChoice.classList.toggle('gated', locked);
    if (locked) _newDemoSource = null; // clear any prior pick while unnamed
    sourceChoice.querySelectorAll('.source-opt').forEach((o) => o.classList.toggle('selected', o.dataset.src === _newDemoSource));
    uploadPanel.classList.toggle('hidden', locked || _newDemoSource !== 'upload');
    formPanel.classList.toggle('hidden', locked || _newDemoSource !== 'form');
    nameHint.classList.toggle('hidden', !locked);
    // Gate Next: form path just needs the source picked; upload path needs the
    // base file + every added variation named.
    const uploadOk = _newDemoSource === 'upload' ? uploadReady() : true;
    step2next.disabled = locked || !_newDemoSource || !uploadOk;
  };
  const sourceOpt = (key, title, desc) => el('div', {
    class: 'source-opt', 'data-src': key,
    onclick: () => { if (!hasName()) { nameInput.focus(); return; } _newDemoSource = key; applySource(); },
  }, [
    el('div', { class: 'so-title' }, [el('span', { class: 'so-radio' }), title]),
    el('div', { class: 'so-desc' }, desc),
  ]);
  nameInput.addEventListener('input', applySource);
  sourceChoice.appendChild(sourceOpt('upload', 'Upload a downloaded file', 'Host the Adaptive Web HTML you exported from the Experience Generator. Optionally add named variations (e.g. Mortgage, Auto Loan) for a WPM decision dropdown. Recommended.'));
  sourceChoice.appendChild(sourceOpt('form', 'Design it here', 'Pick an industry + use case and set brand colors. Good for a quick generic demo.'));
  step2.appendChild(sourceChoice);
  step2.appendChild(uploadPanel);
  step2.appendChild(formPanel);

  const step2back = el('button', { class: 'btn secondary', onclick: () => goStep(1) }, '← Back');
  const step2next = el('button', { class: 'btn', onclick: () => goStep(3) }, 'Next: review & deploy →');
  step2.appendChild(el('div', { class: 'step-actions' }, [step2back, step2next]));

  // STEP 3 — review + deploy. The Profile Data Graph and Website connector are
  // both org prework set in Step 1; this step is the final review + launch.
  const step3 = el('div', { class: 'step-section hidden' });
  step3.appendChild(el('h3', {}, 'Review & deploy'));
  step3.appendChild(el('p', { class: 'step-hint' },
    'Everything’s set: your org checks passed, your experience is chosen, and the connector + Profile Data Graph were confirmed in Step 1. Launch when ready.'));

  const statusArea = el('div', { id: 'deployStatus', style: 'margin-top:1.25rem' });
  const deployBtn = el('button', { class: 'btn', onclick: () => runDeploy() },
    'Deploy to ' + (conn ? (conn.org_alias || conn.org_id) : 'org'));
  step3.appendChild(el('div', { class: 'step-actions' }, [
    el('button', { class: 'btn secondary', onclick: () => goStep(2) }, '← Back'),
    deployBtn,
  ]));
  step3.appendChild(statusArea);

  form.appendChild(step1);
  form.appendChild(step2);
  form.appendChild(step3);
  card.appendChild(form);

  // Step navigation: toggle section visibility (never re-render).
  const sections = { 1: step1, 2: step2, 3: step3 };
  function goStep(n) {
    _newDemoStep = n;
    Object.entries(sections).forEach(([k, sec]) => sec.classList.toggle('hidden', Number(k) !== n));
    refreshStepper();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  card._goStep = goStep; // exposed for runDeploy success handling

  refreshStepper();
  applySource();

  // Populate dropdowns.
  loadCatalog().then((cat) => {
    cat.industries.forEach((ind) => {
      industrySel.appendChild(el('option', { value: ind.key }, ind.label));
    });
    const fillUseCases = () => {
      useCaseSel.innerHTML = '';
      const ind = cat.industries.find((i) => i.key === industrySel.value) || cat.industries[0];
      (ind.useCases || []).forEach((uc) => useCaseSel.appendChild(el('option', { value: uc.key }, uc.name)));
    };
    industrySel.addEventListener('change', fillUseCases);
    if (prefill.adaptiveWebSubIndustry) industrySel.value = prefill.adaptiveWebSubIndustry;
    fillUseCases();
    if (prefill.adaptiveWebSubUseCase) useCaseSel.value = prefill.adaptiveWebSubUseCase;
  });

  // Step 1 readiness check on load; controls the gate into step 2. The graph
  // field is placed inline at the Profile Data Graph check.
  runReadinessCheck(readinessHost, conn, () => goStep(2), dataGraphInput);

  goStep(_newDemoStep);
  return card;
}

// Step 1: check org prerequisites, render them as the readiness gate, and
// enable "Next" only when ready. Same API call + graph-stashing as before.
async function runReadinessCheck(host, conn, onNext, dataGraphInput) {
  host.innerHTML = '';
  if (!conn) { host.appendChild(el('div', { class: 'banner error small' }, 'No connected org.')); return; }
  host.appendChild(el('div', { class: 'banner info small' }, 'Checking org prerequisites…'));

  // Fix hints keyed by check, shown when a check fails.
  const FIX = {
    profileDataGraph: 'WPM only lists Personalization Points bound to a real-time profile data graph. In Data Cloud Setup → Data Graphs, create a Real-Time graph on your Unified Individual, then re-check.',
    personalization: 'Personalization may not be fully enabled in this org. Enable Data 360 Personalization, then re-check.',
    personalizationSchema: 'The app could not confirm schema access. Ensure the Personalization Admin permission set is assigned, then re-check.',
  };

  try {
    const pre = await api('GET', `/api/sf/${conn.id}/prerequisites`);
    // Stash discovered Profile Data Graphs so deploy can bind PPs to one.
    const pdg = pre.checks.profileDataGraph || {};
    state.profileDataGraphs = Array.isArray(pdg.graphs) ? pdg.graphs : [];

    const row = (key, title, chk, extra) => {
      const ok = !!(chk && chk.ok);
      return el('li', {}, [
        el('div', { class: 'rd-icon ' + (ok ? 'ok' : 'err') }, ok ? '✓' : '!'),
        el('div', { class: 'rd-body' }, [
          el('div', { class: 'rd-title' }, title),
          chk && chk.detail ? el('div', { class: 'rd-detail' }, chk.detail) : null,
          !ok && FIX[key] ? el('div', { class: 'rd-fix' }, FIX[key]) : null,
          extra || null,
        ]),
      ]);
    };

    // Profile Data Graph: the deploy ALWAYS needs its API name, and the API
    // often can't LIST graphs even when the org has one (they aren't reliably
    // queryable). So the #dataGraphName field is ALWAYS shown right here, and
    // the icon reflects detection rather than gating:
    //  - found graphs via API -> green (auto-confirmed)
    //  - didn't/couldn't list  -> blue info: confirm the API name in the field
    // We never show this as a hard red error — an empty API listing is expected,
    // and the field lets the SE proceed with the known graph name.
    const graphs = state.profileDataGraphs || [];
    const foundGraph = graphs.length > 0;

    const graphField = el('div', { class: 'rd-graph-field' }, [
      el('label', { style: 'margin-top:2px' }, 'Profile Data Graph (API name)'),
      dataGraphInput,
      el('div', { class: 'rd-detail', style: 'margin-top:4px' },
        'The real-time Data Cloud graph your Personalization Points bind to. Confirm the exact API name — find it in Data Cloud Setup → Data Graphs.'),
    ]);

    const pdgRow = el('li', {}, [
      el('div', { class: 'rd-icon ' + (foundGraph ? 'ok' : 'info') }, foundGraph ? '✓' : 'i'),
      el('div', { class: 'rd-body' }, [
        el('div', { class: 'rd-title' }, 'Real-time Profile Data Graph'),
        el('div', { class: 'rd-detail' }, foundGraph
          ? `Found ${graphs.length} data graph${graphs.length === 1 ? '' : 's'} via API. Confirm the one to bind to below.`
          : 'Couldn’t auto-list Data Graphs via API (common — they’re not always queryable). That’s fine: confirm your real-time graph’s API name below. If it doesn’t exist yet, create one in Data Cloud Setup → Data Graphs (Real-Time type on your Unified Individual), then re-check.'),
        graphField,
      ]),
    ]);

    host.innerHTML = '';
    host.appendChild(el('ul', { class: 'readiness-list' }, [
      row('personalization', 'Personalization enabled', pre.checks.personalization),
      row('personalizationSchema', 'Personalization schema access', pre.checks.personalizationSchema),
      pdgRow,
    ]));

    const ready = !!pre.ready;
    _newDemoReady = ready;
    host.appendChild(el('div', { class: 'rd-summary ' + (ready ? 'ready' : 'notready') }, [
      el('div', { class: 'rd-icon ' + (ready ? 'ok' : 'err') }, ready ? '✓' : '!'),
      el('div', {}, ready
        ? 'Your org is ready. On to bringing your experience in.'
        : 'A couple of things are missing. Fix them above, then re-check — this saves you from a dead-end deploy.'),
    ]));

    host.appendChild(el('div', { class: 'step-actions' }, [
      el('button', { class: 'btn secondary', onclick: () => runReadinessCheck(host, conn, onNext, dataGraphInput) }, 'Re-check org'),
      el('button', { class: 'btn', disabled: ready ? null : 'true', onclick: () => { if (_newDemoReady) onNext(); } },
        'Next: bring your experience →'),
    ]));
  } catch (e) {
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'banner error small' }, 'Prerequisite check failed: ' + e.message));
    host.appendChild(el('div', { class: 'step-actions' }, [
      el('button', { class: 'btn secondary', onclick: () => runReadinessCheck(host, conn, onNext, dataGraphInput) }, 'Re-check org'),
      el('span', {}),
    ]));
  }
}

async function runDeploy() {
  const conn = activeConnection();
  const name = $('#demoName').value.trim();
  const statusArea = $('#deployStatus');
  if (!name) {
    statusArea.innerHTML = '';
    statusArea.appendChild(el('div', { class: 'banner error' }, 'Demo name is required.'));
    return;
  }
  // Upload path when the source is 'upload' and the base file is present. The
  // base file is the first decision; typed variations (named) are the extras.
  const usingUpload = _newDemoSource === 'upload' && !!_uploadedHtml;
  // Each variation targets ONE surface (its type). Send only that surface's
  // content so a hero variation never lands empty card decisions and vice versa.
  const extraVariations = usingUpload
    ? (_newDemoVariations || [])
        .filter((v) => (v.name || '').trim())
        .map((v) => ({
          name: v.name.trim(),
          type: v.type === 'articles' ? 'articles' : 'hero',
          content: v.type === 'articles' ? { cards: v.cards } : { hero: v.hero },
        }))
    : [];
  const formData = {
    adaptiveBrandName: $('#brandName').value,
    adaptiveWebSubIndustry: $('#industrySel').value,
    adaptiveWebSubUseCase: $('#useCaseSel').value,
    adaptivePrimaryColor: $('#primaryColor').value,
    adaptiveAccentColor: $('#accentColor').value,
  };

  const steps = ['Creating Content Schemas', 'Creating Experience Template', 'Creating Personalization Points + Decisions', 'Generating hosted URL', 'Done'];
  const stepList = el('ul', { class: 'steps' }, steps.map((s) => el('li', {}, s)));
  statusArea.innerHTML = '';
  statusArea.appendChild(el('div', { class: 'banner info small' },
    'Deploying to your SDO — this can take up to a minute or two while Salesforce creates each object. Please keep this tab open until it finishes.'));
  statusArea.appendChild(stepList);
  const setStep = (i, cls) => { if (stepList.children[i]) stepList.children[i].className = cls; };
  setStep(0, 'active');

  // Bind PPs to a Profile Data Graph. Prefer the explicit field; fall back to a
  // graph the prerequisites check discovered (when API discovery worked).
  const graphs = state.profileDataGraphs || [];
  const profileDataGraphName =
    ($('#dataGraphName') && $('#dataGraphName').value.trim()) ||
    (graphs[0] && (graphs[0].name || graphs[0].id)) ||
    undefined;
  if (!profileDataGraphName) {
    setStep(0, 'error');
    statusArea.appendChild(el('div', { class: 'banner error' },
      'A Profile Data Graph name is required to create Personalization Points. Enter one in the Profile Data Graph field.'));
    return;
  }

  // Warn (don't block) if the connector is blank — the demo will host but WPM
  // won't attach without a live beacon. This has bitten us repeatedly.
  const connectorVal = ($('#connectorId') && $('#connectorId').value.trim()) || '';
  if (!connectorVal && !confirm('No Website connector is set, so WPM will NOT attach to this page (the beacon will be inactive). Deploy anyway?')) {
    return;
  }

  try {
    const result = await api('POST', '/api/deployments', {
      name,
      connectionId: conn.id,
      industry: formData.adaptiveWebSubIndustry,
      formData,
      profileDataGraphName,
      connector: ($('#connectorId') && $('#connectorId').value.trim()) || undefined,
      // Base experience file (upload path). Form path omits it and deploy
      // renders from formData.
      uploadedHtml: usingUpload ? _uploadedHtml : undefined,
      // Editable WPM label for the base (decision 1). Only sent on the upload
      // path (the base decision is the uploaded file); ignored otherwise.
      baseName: usingUpload ? (_baseVariationName || '').trim() || undefined : undefined,
      // Optional typed variations → an extra named Decision each per experience.
      variations: extraVariations.length ? extraVariations : undefined,
      expiry: 'never',
    });
    steps.forEach((_, i) => setStep(i, 'done'));
    statusArea.appendChild(renderPostDeploy(result, conn));
    // Result + guide are now on screen. Drop the cached journey so navigating
    // back to New Demo starts a clean one (this card stays until they leave).
    resetNewDemo();
  } catch (e) {
    setStep(0, 'error');
    statusArea.appendChild(el('div', { class: 'banner error' }, 'Deploy failed: ' + e.message));
  }
}

// Turn a raw P13N/Connect error message into an SE-actionable troubleshooting
// hint. Returns null when we have nothing specific to add.
function troubleshootHint(errMsg) {
  const m = String(errMsg || '').toLowerCase();
  if (/data ?graph|profiledatagraph|profile data graph/.test(m)) {
    return 'The Profile Data Graph name may be wrong or missing in this org. Check the exact API name in Data Cloud Setup → Data Graphs and re-enter it in the Profile Data Graph field. A Profile Data Graph requires a configured Data Cloud data model.';
  }
  if (/not.*enabled|not.*support|does not exist.*personalization/.test(m)) {
    return 'Personalization may not be fully enabled in this org. Confirm the prerequisites above are green before deploying.';
  }
  if (/duplicate|already exists/.test(m)) {
    return 'An object with this name already exists — a demo with the same name may have been deployed before. Use a different demo name, or delete the earlier demo from Manage Demos first.';
  }
  if (/criteria/.test(m)) {
    return 'Decision criteria cannot be set via API — this should not happen from the app; report it.';
  }
  return null;
}

function renderPostDeploy(result, conn) {
  const d = result.deploy || {};
  const failed = d.mode === 'error';
  const box = el('div', { class: 'card', style: 'margin-top:1rem' });
  box.appendChild(el('h3', {}, failed ? 'Deploy incomplete' : 'Deployed'));

  if (failed) {
    // Object creation failed. The hosted page may still exist, but WPM won't
    // work without the objects, so lead with the error + how to fix it.
    box.appendChild(el('div', { class: 'banner error small' }, 'Personalization object creation failed: ' + (d.error || 'unknown error')));
    const hint = troubleshootHint(d.error);
    if (hint) box.appendChild(el('div', { class: 'banner info small', style: 'margin-top:0.5rem' }, hint));
    box.appendChild(el('p', { class: 'small muted', style: 'margin-top:0.5rem' },
      'Fix the issue above and deploy again. No partial demo was left usable; remove any leftover objects from Manage Demos if needed.'));
    return box;
  }

  box.appendChild(el('div', { class: 'hosted-url' }, [el('span', {}, result.hostedUrl)]));
  box.appendChild(
    el('div', { style: 'margin-top:0.75rem; display:flex; gap:0.5rem' }, [
      el('button', { class: 'btn secondary', onclick: () => navigator.clipboard.writeText(result.hostedUrl) }, 'Copy Link'),
      el('a', { class: 'btn secondary', href: result.hostedUrl, target: '_blank' }, 'Open in New Tab'),
      // Real WPM: open the hosted page with the activation param. The Web SDK
      // prompts SF login and overlays the Web Personalization Manager.
      el('a', { class: 'btn', href: result.hostedUrl + '?sf_personalization_wpm', target: '_blank' }, 'Open in WPM'),
      el('a', { class: 'btn secondary', href: '/api/deployments/' + result.id + '/sitemap' }, 'Download Sitemap'),
    ])
  );
  // One-time-per-CONNECTOR step so WPM sees the content zones + PPs. The sitemap
  // content is the same for every demo (fixed content zones), so it only needs
  // uploading the first time you use a given connector/SDO — not per demo.
  box.appendChild(el('div', { class: 'banner info small', style: 'margin-top:0.75rem' },
    'First time using this connector? Download the sitemap above and upload it once in Data Cloud Setup → Websites & Mobile Apps → your connector → Replace Sitemap. It registers the content zones WPM reads. You only do this once per connector — future demos on the same SDO don’t need it (a net-new SDO/connector does).'));

  const a = d.artifacts || {};
  const nSchemas = (a.schemas || []).length;
  const nPps = (a.pps || []).length;
  const beaconLive = !!d.connector;
  box.appendChild(el('div', { class: 'banner success small', style: 'margin-top:1rem' },
    `Created ${nSchemas} Content Schemas + ${nPps} Personalization Points in data space “${a.dataSpaceName || 'default'}”.`));
  box.appendChild(el('div', { class: beaconLive ? 'banner info small' : 'banner warn small', style: 'margin-top:0.5rem' },
    beaconLive
      ? 'Web SDK beacon is live. Click “Open in WPM” to author experiences on the hosted page.'
      : 'Beacon could not be wired (tenant endpoint not found) — the page renders but WPM will not attach. Re-check org prerequisites, then redeploy.'));

  box.appendChild(buildWpmGuide());
  return box;
}

// The "now make it real in WPM" guide — the value payoff. Static instructional
// content (verified WPM/Data Cloud facts); safe to show after every success.
function buildWpmGuide() {
  const guide = el('div', { class: 'card', style: 'margin-top:1rem' });
  guide.appendChild(el('h3', {}, 'Make it real in WPM — do this once'));
  guide.appendChild(el('p', { class: 'step-hint' },
    'Follow these in order. Skip step 1 and your Personalization Points won’t show up in WPM — the #1 gotcha.'));
  const steps = [
    { n: '1', tip: false, title: 'Upload the sitemap to your connector',
      html: 'Click <strong>Download Sitemap</strong> above, then in <code>Setup → Data Cloud → Websites &amp; Mobile Apps → your connector → Replace Sitemap</code>, upload it. This registers the content zones WPM reads (Homepage Hero + Market Insights). <strong>Once per connector</strong> — the sitemap is the same for every demo, so future demos on this SDO skip it. Re-upload only for a net-new SDO/connector, or after a SP Demo Builder update that changes the content zones.' },
    { n: '2', tip: false, title: 'Open the page in WPM',
      html: 'Click <strong>Open in WPM</strong>. Sign into Salesforce when prompted — the Web Personalization Manager overlays the live page.' },
    { n: '3', tip: false, title: 'Why your points appear (the unlock)',
      html: 'WPM’s picker only lists Personalization Points bound to a <strong>real-time profile data graph</strong>. Yours are (Step 1 checked for it). If the picker is ever empty, that binding is the first thing to check.' },
    { n: '★', tip: true, title: 'Add & edit Personalization Decisions',
      html: 'The decisions we created are <strong>always-on</strong> (the API can’t set targeting rules). In WPM, open a Personalization Point and add more <strong>Decisions</strong> with audience criteria — one hero for mortgage intent, one for auto, etc. The target look is one Point with several Decisions in a dropdown, swapping the creative live.' },
    { n: '★', tip: true, title: 'Rename & customize',
      html: 'Rename Points, Decisions, and the Experience Template in WPM to match your customer’s brand. Edit the hero copy, image, and CTA right in the decision — the swap updates on the hosted page.' },
  ];
  steps.forEach((s) => {
    guide.appendChild(el('div', { class: 'guide-step' }, [
      el('div', { class: 'guide-num' + (s.tip ? ' tip' : '') }, s.n),
      el('div', { class: 'guide-body' }, [
        el('div', { class: 'gb-title' }, [s.title, s.tip ? el('span', { class: 'pill-note' }, 'tip') : null]),
        el('div', { class: 'gb-text', html: s.html }),
      ]),
    ]));
  });
  return guide;
}

// --- Manage Demos ---
let _managePollTimer = null;

function renderManageDemos() {
  const card = el('div', { class: 'card' }, [el('h2', {}, 'Manage Demos')]);
  card.appendChild(el('p', { class: 'step-hint' },
    'Deleting a demo can take a few minutes. Keep this page open until it finishes — you’ll see live progress and anything that needs manual cleanup.'));
  const body = el('div', {}, el('p', { class: 'muted' }, 'Loading…'));
  card.appendChild(body);

  // Clear any prior poll loop when re-rendering the screen.
  if (_managePollTimer) { clearInterval(_managePollTimer); _managePollTimer = null; }

  const paint = (rows) => {
    state.deployments = rows;
    body.innerHTML = '';
    if (!rows.length) {
      body.appendChild(el('p', { class: 'muted' }, 'No demos yet. Create one in New Demo.'));
      return;
    }
    const table = el('table', { class: 'demos' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Name'), el('th', {}, 'Org'), el('th', {}, 'Status'),
      el('th', {}, 'Created'), el('th', {}, 'Actions'),
    ])));
    const tbody = el('tbody');
    rows.forEach((r) => {
      const deleting = r.status === 'deleting';
      tbody.appendChild(el('tr', {}, [
        el('td', {}, r.name),
        el('td', {}, r.orgAlias || r.orgId || ''),
        el('td', {}, el('span', { class: 'badge ' + r.status }, deleting ? 'deleting' : r.status)),
        el('td', {}, new Date(r.createdAt).toLocaleString()),
        el('td', {}, el('div', { style: 'display:flex;gap:0.4rem' }, [
          el('a', { class: 'btn secondary small', href: r.hostedUrl, target: '_blank' }, 'Open'),
          el('button', {
            class: 'btn danger small', disabled: deleting ? 'true' : null,
            onclick: () => confirmDelete(r),
          }, deleting ? 'Deleting…' : 'Delete'),
        ])),
      ]));
      // Progress row: show while deleting, or when the last attempt left orphans.
      const prog = r.deleteProgress;
      if (deleting || (prog && prog.state === 'incomplete')) {
        tbody.appendChild(el('tr', {}, [
          el('td', { colspan: '5', style: 'background:#f8fafc' }, renderDeleteProgress(r, prog)),
        ]));
      }
    });
    table.appendChild(tbody);
    body.appendChild(table);
  };

  // One tick: reload the list, then ADVANCE any in-progress delete by one step.
  // The step call is what actually does the teardown work — driven by this poll
  // so it survives dyno sleep (no fragile background process).
  const tick = () =>
    api('GET', '/api/deployments').then(async (rows) => {
      // Preserve optimistic "deleting" state the server hasn't caught up to yet.
      (state.deployments || []).forEach((prev) => {
        if (prev.status === 'deleting') {
          const fresh = rows.find((r) => r.id === prev.id);
          if (fresh && fresh.status === 'active' && !fresh.deleteProgress) {
            fresh.status = 'deleting';
            fresh.deleteProgress = prev.deleteProgress;
          }
        }
      });

      // Advance each deleting demo by one step, folding the returned progress
      // back into the row so the bar reflects real work this tick.
      const deleting = rows.filter((r) => r.status === 'deleting');
      await Promise.all(deleting.map((r) =>
        api('POST', '/api/deployments/' + r.id + '/delete-step')
          .then((res) => {
            r.deleteProgress = res.deleteProgress || r.deleteProgress;
            if (res.done) r.status = res.status; // 'deleted' (drops next reload) or 'active' (orphans)
          })
          .catch(() => { /* transient; next tick retries */ })
      ));

      paint(rows);
      const stillDeleting = rows.some((r) => r.status === 'deleting');
      if (stillDeleting && !_managePollTimer) {
        _managePollTimer = setInterval(tick, 3000);
      } else if (!stillDeleting && _managePollTimer) {
        clearInterval(_managePollTimer); _managePollTimer = null;
      }
    }).catch((e) => {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'banner error' }, 'Failed to load demos: ' + e.message));
    });

  // Paint immediately from cached state (shows optimistic "deleting" at once),
  // then refresh + step from the server.
  if (state.deployments && state.deployments.length) paint(state.deployments);
  tick();
  return card;
}

// Live delete progress: a bar + the current message, and (when finished with
// leftovers) the honest "verify manually" report + a Retry button.
function renderDeleteProgress(row, prog) {
  const wrap = el('div', { style: 'padding:4px 2px' });
  const running = !prog || prog.state === 'running' || prog.state === undefined;
  const total = (prog && prog.total) || 0;
  const done = prog ? ((prog.removed || []).length + (prog.orphans || []).length) : 0;

  // Message: always present so the row never looks idle.
  wrap.appendChild(el('div', { class: 'small', style: 'font-weight:600;color:#17618e' },
    (prog && prog.message) || 'Starting delete… this can take a moment while Salesforce releases each object.'));

  // Bar: INDETERMINATE (animated stripe) while running so the SE always sees
  // motion — even when a step is waiting on the org's dependency lag. Switches
  // to a real filled bar only once we have counted progress or it's finished.
  const hasCount = total > 0 && done > 0;
  const track = el('div', { class: 'progress-track' + (running && !hasCount ? ' indeterminate' : '') },
    el('div', { class: 'progress-fill', style: running && !hasCount ? '' : ('width:' + (total ? Math.round((done / total) * 100) : 100) + '%') }));
  wrap.appendChild(track);
  if (hasCount) {
    wrap.appendChild(el('div', { class: 'small muted', style: 'margin-top:4px' }, `${done} of ${total} removed…`));
  }

  // While running, set the expectation clearly: the org releases each object on
  // its own schedule (up to ~10 min), and this tab drives the teardown, so the
  // SE must not leave or refresh until it finishes.
  if (running) {
    wrap.appendChild(el('div', { class: 'banner warn small', style: 'margin-top:8px' },
      'This can take up to 10 minutes — Salesforce releases each object on its own schedule. Please do not leave or refresh this page until it finishes.'));
  }

  if (prog && prog.state === 'incomplete' && (prog.orphans || []).length) {
    wrap.appendChild(el('div', { class: 'banner warn small', style: 'margin-top:10px' },
      (prog.orphans.length) + ' object(s) could not be removed and were left in the org. Verify/remove manually in Salesforce: ' +
      prog.orphans.map((o) => `${o.type} ${o.ref}`).join(', ')));
    const retryBtn = el('button', { class: 'btn danger small' }, 'Retry delete');
    retryBtn.addEventListener('click', () => {
      if (retryBtn.disabled) return;
      retryBtn.disabled = true;
      retryBtn.classList.add('is-busy');
      doDelete(row.id);
    });
    wrap.appendChild(el('div', { style: 'margin-top:8px' }, [retryBtn]));
  }
  return wrap;
}

// Delete confirmation modal — lists the exact SF object identifiers that will be
// removed (feedback_ask_before_delete: require explicit confirmation).
function confirmDelete(row) {
  const art = row.artifacts || {};
  const ids = [];
  (art.schemas || []).forEach((s) => ids.push('Content Schema: ' + (s.name || s.fullName || s.id || JSON.stringify(s))));
  (art.transformers || []).forEach((t) => ids.push('Experience Template: ' + (t.name || t.id || JSON.stringify(t))));
  (art.pps || []).forEach((p) => ids.push('Personalization Point: ' + (p.name || p.fullName || p.id || JSON.stringify(p))));

  const modalRoot = $('#modalRoot');
  modalRoot.innerHTML = '';
  const close = () => { modalRoot.innerHTML = ''; };
  const cancelBtn = el('button', { class: 'btn secondary', onclick: close }, 'Cancel');
  const deleteBtn = el('button', { class: 'btn danger' }, 'Delete');
  // Instant feedback: disable both + relabel the moment it's clicked, so there's
  // no dead gap while the async delete kicks off (prevents double-clicks).
  deleteBtn.addEventListener('click', async () => {
    if (deleteBtn.disabled) return;
    deleteBtn.disabled = true;
    cancelBtn.disabled = true;
    deleteBtn.classList.add('is-busy'); // spinner overlay; text hidden
    deleteBtn.textContent = 'Starting delete…';
    // Keep the modal open (with the spinner) until the first delete step
    // returns, so there's NO blank gap that tempts a re-click. doDelete closes
    // it and renders the row's live progress once the server has responded.
    await doDelete(row.id, close);
  });
  const modal = el('div', { class: 'modal' }, [
    el('h3', {}, 'Delete “' + row.name + '”?'),
    el('p', { class: 'small' }, 'This removes the hosted URL and attempts to delete the following objects from ' + (row.orgAlias || 'the org') + ':'),
    el('div', { class: 'id-list' }, ids.length ? ids.join('\n') : 'No org objects were recorded for this demo.'),
    el('div', { class: 'modal-actions' }, [cancelBtn, deleteBtn]),
  ]);
  modalRoot.appendChild(el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target.className === 'modal-backdrop') close(); } }, modal));
}

// Kick off the async delete (202) and let Manage Demos poll for progress. The
// schema dependency-index lag means teardown can take minutes; the background
// runner handles the retries and the row shows a live progress bar.
async function doDelete(id, close) {
  // Optimistically flip the row to "deleting" so the list reflects it the moment
  // the modal closes (no blank gap → no re-click).
  const rowRef = (state.deployments || []).find((r) => r.id === id);
  if (rowRef) {
    rowRef.status = 'deleting';
    rowRef.deleteProgress = { state: 'running', message: 'Starting delete…', total: 0, removed: [], orphans: [] };
  }

  try {
    // Keep the modal open (its button is already showing a spinner) UNTIL the
    // first step returns, so the SE sees continuous "working" feedback rather
    // than a dead gap. Then close the modal and render the row's live state.
    const res = await api('DELETE', '/api/deployments/' + id);
    if (typeof close === 'function') close();
    state.route = 'manageDemos';
    // The DELETE runs the first step synchronously. When every object is
    // already-gone (e.g. a retry after a prior manual cleanup), that single
    // step finishes the whole teardown and the demo is already 'deleted' —
    // there's no 'deleting' row for the poll to latch onto, so it would never
    // refresh. Reconcile from the response: if it's done, re-render Manage
    // Demos (which re-fetches and drops the now-deleted row). If still
    // deleting, fold the fresh progress in so the bar reflects real state.
    const done = res && (res.status === 'deleted' || (res.deleteProgress && res.deleteProgress.state === 'complete'));
    if (rowRef) {
      if (done) { rowRef.status = 'deleted'; }
      else if (res && res.deleteProgress) { rowRef.deleteProgress = res.deleteProgress; }
    }
    if (state.route === 'manageDemos') renderApp();
  } catch (e) {
    // Roll back the optimistic state and tell the SE it didn't start.
    if (rowRef) { rowRef.status = 'active'; rowRef.deleteProgress = null; }
    if (typeof close === 'function') close();
    alert('Could not start delete: ' + e.message);
    renderApp();
  }
}

// --- Connected Orgs ---
function renderConnectedOrgs() {
  const card = el('div', { class: 'card' }, [el('h2', {}, 'Connected Orgs')]);
  state.connections.forEach((c) => {
    card.appendChild(
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--border)' }, [
        el('div', {}, [
          el('strong', {}, c.org_alias || c.org_id),
          el('div', { class: 'muted small' }, c.instance_url + (c.is_sandbox ? ' (sandbox)' : '')),
        ]),
        el('button', { class: 'btn danger small', onclick: () => disconnectOrg(c.id) }, 'Disconnect'),
      ])
    );
  });
  card.appendChild(
    el('div', { style: 'margin-top:1rem' }, [
      el('a', { class: 'btn', href: '/auth/salesforce?sandbox=false' }, 'Connect another org'),
    ])
  );
  return card;
}

async function disconnectOrg(id) {
  if (!confirm('Disconnect this org? Demos deployed to it will remain but cannot be managed until reconnected.')) return;
  try { await api('DELETE', '/api/sf/connections/' + id); } catch (e) { alert(e.message); }
  state.connections = await api('GET', '/api/sf/connections');
  state.activeConnectionId = state.connections[0] && state.connections[0].id;
  resetNewDemo(); // org changed — rebuild the journey against the new org
  renderApp();
}

document.addEventListener('DOMContentLoaded', boot);
