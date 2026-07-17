/* ============================================================
   MisGatos — app.js
   Control Veterinario Personal
   ============================================================ */

// ──────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────
const SUPABASE_URL  = 'https://ryjmssfihczyooumwdxs.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_PlQBi5aOpgoLnfYXBN5--g_opxu-7yz';
const BUILD         = 'g';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ──────────────────────────────────────────────
// ESTADO GLOBAL
// ──────────────────────────────────────────────
const state = {
  user: null,
  cats: [],
  vets: [],
  appointments: [],
  consultations: [],
  vaccines: [],
  dewormings: [],
  documents: [],
  currentSection: 'dashboard'
};

// ──────────────────────────────────────────────
// INICIALIZACIÓN
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      state.user = session.user;
      const meta = session.user?.user_metadata || {};
      const displayName = meta.first_name || session.user.email;
      document.getElementById('user-email-display').textContent = displayName;
      showApp();
      await loadAllData();
      navigate('dashboard');
      checkReminders();
      requestNotifPermission();
    } else {
      state.user = null;
      showAuth();
    }
  });

  // Focus trap y Escape en modal
  document.addEventListener('keydown', _trapModalFocus);

  // Navegación sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.section);
      if (window.innerWidth <= 768) toggleSidebar(false);
    });
  });
});

// ──────────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) showAuthError(error.message);
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('reg-email').value;
  const p1    = document.getElementById('reg-password').value;
  const p2    = document.getElementById('reg-password2').value;
  if (p1 !== p2) return showAuthError('Las contraseñas no coinciden.');
  const { error } = await sb.auth.signUp({ email, password: p1 });
  if (error) showAuthError(error.message);
  else showAuthError('Revisa tu correo para confirmar tu cuenta.', false);
}

async function handleLogout() {
  await sb.auth.signOut();
}

// ──────────────────────────────────────────────
// PERFIL DE USUARIO
// ──────────────────────────────────────────────
function switchProfileTab(tab) {
  document.querySelectorAll('.profile-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('aria-controls') === `profile-tab-${tab}`);
    btn.setAttribute('aria-selected', btn.classList.contains('active'));
  });
  document.querySelectorAll('.profile-tab-pane').forEach(pane => {
    pane.classList.toggle('hidden', pane.id !== `profile-tab-${tab}`);
  });
  if (tab === 'acceso') renderLinkedAccounts();
}

async function renderProfile() {
  // Obtener datos frescos del servidor para evitar caché local de Supabase
  const { data } = await sb.auth.getUser();
  if (data?.user) state.user = data.user;
  const meta = state.user?.user_metadata || {};
  const emailEl = document.getElementById('prof-email');
  const nameEl  = document.getElementById('prof-name');
  const lastEl  = document.getElementById('prof-lastname');
  const phoneEl = document.getElementById('prof-phone');
  if (emailEl) emailEl.value = state.user?.email || '';
  if (nameEl)  nameEl.value  = meta.first_name || '';
  if (lastEl)  lastEl.value  = meta.last_name  || '';
  if (phoneEl) phoneEl.value = meta.phone       || '';
}

async function renderLinkedAccounts() {
  const el = document.getElementById('linked-accounts-list');
  if (!el) return;
  el.innerHTML = '<div class="empty-state" style="padding:8px 0">Cargando&hellip;</div>';
  const { data, error } = await sb.rpc('get_linked_accounts');
  if (error || !data?.length) {
    el.innerHTML = '<div class="linked-empty">Sin cuentas vinculadas.</div>';
    return;
  }
  el.innerHTML = data.map(row => `
    <div class="linked-account-row">
      <i class="fa-solid fa-user-check linked-account-icon" aria-hidden="true"></i>
      <span class="linked-account-email">${row.email}</span>
      <button class="linked-account-remove" onclick="unlinkAccount('${row.linked_id}')" aria-label="Desvincular ${row.email}">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
  `).join('');
}

async function createLinkedUser(e) {
  e.preventDefault();
  const email      = document.getElementById('link-email-input')?.value?.trim();
  const password   = document.getElementById('link-pass-input')?.value;
  const first_name = document.getElementById('link-name-input')?.value?.trim();
  const phone      = document.getElementById('link-phone-input')?.value?.trim();
  if (!email || !password) return;

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }

  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-linked-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ email, password, first_name, phone }),
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Crear y vincular cuenta'; }

  const result = await res.json();
  if (!res.ok || result.error) {
    const msgs = {
      email_taken:   'Ese correo ya tiene una cuenta',
      missing_fields: 'Correo y contraseña son obligatorios',
      create_error:  'Error al crear la cuenta',
      unauthorized:  'Sesión expirada, recarga la página',
    };
    showToast(msgs[result.error] || 'Error desconocido', 'error');
    return;
  }

  showToast(`Cuenta creada y vinculada: ${result.email}`, 'success');
  e.target.reset();
  await renderLinkedAccounts();
}

async function unlinkAccount(linkedId) {
  const { error } = await sb.rpc('unlink_account', { p_linked_id: linkedId });
  if (error) { showToast('Error al desvincular', 'error'); return; }
  showToast('Cuenta desvinculada', 'success');
  await renderLinkedAccounts();
}

async function saveProfile(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { error } = await sb.auth.updateUser({
    data: {
      first_name: fd.get('first_name') || '',
      last_name:  fd.get('last_name')  || '',
      phone:      fd.get('phone')      || '',
    }
  });
  if (error) return showToast('Error: ' + error.message, 'error');
  // Actualizar estado local y sidebar
  const { data } = await sb.auth.getUser();
  if (data?.user) state.user = data.user;
  const meta2 = state.user?.user_metadata || {};
  const displayName = meta2.first_name || state.user?.email;
  const el = document.getElementById('user-email-display');
  if (el) el.textContent = displayName;
  showToast('Datos guardados', 'success');
}

async function savePassword(e) {
  e.preventDefault();
  const form    = e.target;
  const newPass = form.querySelector('[name="new_password"]').value;
  const confirm = form.querySelector('[name="confirm_password"]').value;
  if (newPass !== confirm) return showToast('Las contraseñas no coinciden', 'error');
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) return showToast('Error: ' + error.message, 'error');
  showToast('Contraseña actualizada', 'success');
  form.reset();
}

function showAuthError(msg, isError = true) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (!isError) { el.style.background = '#D1FAE5'; el.style.color = '#065F46'; }
  else { el.style.background = ''; el.style.color = ''; }
}

function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-btn')[tab === 'login' ? 0 : 1].classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('auth-error').classList.add('hidden');
}

function showApp()  {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const bl = document.getElementById('build-label');
  if (bl) bl.textContent = `build ${BUILD}`;
}
function showAuth() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

// ──────────────────────────────────────────────
// NAVEGACIÓN
// ──────────────────────────────────────────────
function navigate(section) {
  state.currentSection = section;
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`s-${section}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === section);
  });

  // FAB: en desktop solo cats; en mobile uno por sección
  const isMobile = window.innerWidth <= 768;
  const fabMap = {
    cats:          'fab-add-cat',
    vets:          'fab-add-vet',
    appointments:  'fab-add-appointment',
    consultations: 'fab-add-consultation',
    vaccines:      'fab-add-vaccine',
    dewormings:    'fab-add-deworming',
    documents:     'fab-add-document',
  };
  Object.entries(fabMap).forEach(([sec, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const show = sec === section && (sec === 'cats' || isMobile);
    el.classList.toggle('hidden', !show);
  });

  // Renderizar sección correspondiente
  const renders = {
    dashboard:     loadDashboard,
    cats:          renderCats,
    vets:          renderVets,
    appointments:  renderAppointments,
    consultations: renderConsultations,
    vaccines:      renderVaccines,
    dewormings:    renderDewormings,
    documents:     renderDocuments,
    profile:       renderProfile,
  };
  if (renders[section]) renders[section]();
}

function toggleSidebar(open) {
  const sb    = document.getElementById('sidebar');
  const ov    = document.getElementById('sidebar-overlay');
  const isOpen = typeof open === 'boolean' ? open : !sb.classList.contains('open');
  sb.classList.toggle('open', isOpen);
  ov.classList.toggle('hidden', !isOpen);
}

// ──────────────────────────────────────────────
// CARGA DE DATOS
// ──────────────────────────────────────────────
async function loadAllData() {
  const uid = state.user.id;

  const [cats, vets, apts, cons, vacs, dews, docs] = await Promise.all([
    sb.from('cats').select('*').order('name'),
    sb.from('veterinarians').select('*').order('name'),
    sb.from('appointments').select('*, cats(name, photo_url), veterinarians(name, clinic_name, address, phone, email)').order('appointment_date'),
    sb.from('consultations').select('*, cats(name, photo_url), veterinarians(name, clinic_name)').order('visit_date', { ascending: false }),
    sb.from('vaccines').select('*, cats(name, photo_url), veterinarians(name)').order('date_applied', { ascending: false }),
    sb.from('dewormings').select('*, cats(name, photo_url), veterinarians(name)').order('date_applied', { ascending: false }),
    sb.from('documents').select('*, cats(name, photo_url), consultations(visit_date, reason)').order('created_at', { ascending: false }),
  ]);

  state.cats          = cats.data  || [];
  state.vets          = vets.data  || [];
  state.appointments  = apts.data  || [];
  state.consultations = cons.data  || [];
  state.vaccines      = vacs.data  || [];
  state.dewormings    = dews.data  || [];
  state.documents     = docs.data  || [];

  populateCatFilters();
}

function populateCatFilters() {
  const selects = ['apt-filter-cat', 'cons-filter-cat', 'vac-filter-cat', 'dew-filter-cat', 'doc-filter-cat'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.value;
    el.innerHTML = '<option value="">Todos los gatos</option>';
    state.cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      el.appendChild(opt);
    });
    el.value = val;
  });
}

// ──────────────────────────────────────────────
// DASHBOARD
// ──────────────────────────────────────────────
function catBubblesHtml(cats, fallbackIcon = 'fa-cat') {
  if (!cats.length) {
    return `<div class="stat-bubble-empty"><i class="fa-solid ${fallbackIcon}" aria-hidden="true"></i></div>`;
  }
  const shown = cats.slice(0, 4);
  const extra = cats.length - shown.length;
  return shown.map((c, i) => c?.photo_url
    ? `<img src="${c.photo_url}" alt="${c?.name || ''}" class="stat-bubble" style="animation-delay:${(i * 0.28).toFixed(2)}s" loading="lazy">`
    : `<div class="stat-bubble stat-bubble-fallback" style="animation-delay:${(i * 0.28).toFixed(2)}s"><i class="fa-solid fa-cat" aria-hidden="true"></i></div>`
  ).join('') + (extra > 0 ? `<div class="stat-bubble stat-bubble-more" style="animation-delay:${(shown.length * 0.28).toFixed(2)}s">+${extra}</div>` : '');
}

async function loadDashboard() {
  const today = todayStr();
  const in30  = daysFromNow(30);
  const in7   = daysFromNow(7);

  // Welcome section
  const welcomeEl = document.getElementById('dash-welcome');
  if (welcomeEl) {
    const meta  = state.user?.user_metadata || {};
    const name  = meta.first_name || state.user?.email?.split('@')[0] || '';
    const dateStr = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    welcomeEl.innerHTML = `
      <div>
        <h1>Hola, ${name} 👋</h1>
        <p>Resumen del bienestar de tus gatos.</p>
      </div>
      <div class="date-chip">
        <i aria-hidden="true" class="fa-regular fa-calendar"></i>
        ${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}
      </div>`;
  }

  // Stats
  const upcoming = state.appointments.filter(a => a.appointment_date >= today && a.status === 'pendiente');
  const vacsDue  = state.vaccines.filter(v => v.next_due_date && v.next_due_date <= in30);
  const dewsDue  = state.dewormings.filter(d => d.next_due_date && d.next_due_date <= in30);

  document.getElementById('stat-cats').textContent         = state.cats.length;
  document.getElementById('stat-upcoming').textContent     = upcoming.length;
  document.getElementById('stat-vaccines-due').textContent = vacsDue.length;
  document.getElementById('stat-deworm-due').textContent   = dewsDue.length;

  // Burbujas de fotos en cada stat card
  const upcomingCats = [...new Map(upcoming.map(a => [a.cat_id, a.cats])).values()];
  const vacCats      = [...new Map(vacsDue.map(v => [v.cat_id, v.cats])).values()];
  const dewCats      = [...new Map(dewsDue.map(d => [d.cat_id, d.cats])).values()];
  const iconCats     = document.getElementById('stat-icon-cats');
  const iconApt      = document.getElementById('stat-icon-upcoming');
  const iconVac      = document.getElementById('stat-icon-vaccines');
  const iconDew      = document.getElementById('stat-icon-deworm');
  if (iconCats) iconCats.innerHTML = catBubblesHtml(state.cats, 'fa-cat');
  if (iconApt)  iconApt.innerHTML  = catBubblesHtml(upcomingCats, 'fa-calendar-check');
  if (iconVac)  iconVac.innerHTML  = catBubblesHtml(vacCats, 'fa-syringe');
  if (iconDew)  iconDew.innerHTML  = catBubblesHtml(dewCats, 'fa-tablets');

  // Alert stat cards
  const statVacs = document.getElementById('stat-vaccines-due')?.closest('.stat-card');
  const statDews = document.getElementById('stat-deworm-due')?.closest('.stat-card');
  if (statVacs) statVacs.classList.toggle('stat-alert', vacsDue.length > 0);
  if (statDews) statDews.classList.toggle('stat-alert', dewsDue.length > 0);

  // Proximas citas — timeline
  const nearApts   = upcoming.filter(a => a.appointment_date <= in7).slice(0, 5);
  const upcomingEl = document.getElementById('upcoming-appointments');
  upcomingEl.innerHTML = nearApts.length
    ? `<div class="apt-timeline">${nearApts.map(a => {
        const diff  = daysDiff(today, a.appointment_date);
        const label = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : `En ${diff}d`;
        const cls   = diff === 0 ? 'badge-red' : diff === 1 ? 'badge-yellow' : 'badge-green';
        const vet   = a.veterinarians?.clinic_name || a.veterinarians?.name || 'Sin clinica';
        return `<div class="apt-timeline-item">
          <div class="apt-timeline-dot"><i aria-hidden="true" class="fa-solid fa-stethoscope"></i></div>
          <div class="apt-timeline-info">
            <strong>${a.cats?.name} &mdash; ${vet}</strong>
            <span>${formatDate(a.appointment_date)}${a.appointment_time ? ' · ' + formatTime(a.appointment_time) : ''}${a.reason ? ' · ' + a.reason : ''}</span>
          </div>
          <span class="badge ${cls}">${label}</span>
        </div>`;
      }).join('')}</div>`
    : '<div class="empty-state">Sin citas proximas</div>';

  // Alertas de salud
  const alerts = [
    ...vacsDue.map(v => ({
      icon: '<i aria-hidden="true" class="fa-solid fa-syringe"></i>',
      title: `Vacuna: ${v.vaccine_name}`,
      sub:   `${v.cats?.name} — vence ${formatDate(v.next_due_date)}`
    })),
    ...dewsDue.map(d => ({
      icon: '<i aria-hidden="true" class="fa-solid fa-tablets"></i>',
      title: `Desparasitacion: ${d.product_name}`,
      sub:   `${d.cats?.name} — vence ${formatDate(d.next_due_date)}`
    })),
  ].slice(0, 8);

  document.getElementById('health-alerts').innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert-item">
        <span class="alert-icon">${a.icon}</span>
        <div class="alert-text"><strong>${a.title}</strong><span>${a.sub}</span></div>
      </div>`).join('')
    : '<div class="empty-state">Todo al dia</div>';
}

// ──────────────────────────────────────────────
// GATOS
// ──────────────────────────────────────────────
function getCatStatus(catId) {
  const today = todayStr();
  const in30  = daysFromNow(30);
  const hasOverdueVac = state.vaccines.some(v => v.cat_id === catId && v.next_due_date && v.next_due_date < today);
  const hasOverdueDew = state.dewormings.some(d => d.cat_id === catId && d.next_due_date && d.next_due_date < today);
  if (hasOverdueVac || hasOverdueDew) return { cls: 'bad', label: 'Alerta' };
  const hasDueSoon = state.vaccines.some(v => v.cat_id === catId && v.next_due_date && v.next_due_date >= today && v.next_due_date <= in30)
    || state.dewormings.some(d => d.cat_id === catId && d.next_due_date && d.next_due_date >= today && d.next_due_date <= in30);
  if (hasDueSoon) return { cls: 'warn', label: 'Revision' };
  return { cls: 'ok', label: 'Optimo' };
}

let _catStatusFilter = 'all';
let _consDocCounter = 0;

function filterCatsByStatus(filter, btn) {
  _catStatusFilter = filter;
  document.querySelectorAll('#cats-chip-bar .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderCats();
}

function renderCats() {
  const grid = document.getElementById('cats-grid');
  if (!state.cats.length) {
    grid.innerHTML = '<div class="empty-state">No tienes gatos registrados aun.</div>';
    return;
  }
  const filtered = (_catStatusFilter === 'all'
    ? [...state.cats]
    : state.cats.filter(c => getCatStatus(c.id).cls === _catStatusFilter))
    .sort((a, b) => {
      if (!a.birthdate && !b.birthdate) return 0;
      if (!a.birthdate) return 1;
      if (!b.birthdate) return -1;
      return new Date(a.birthdate) - new Date(b.birthdate); // oldest first
    });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">Ningún gato con ese estado.</div>';
    return;
  }

  grid.innerHTML = filtered.map(c => {
    const age    = c.birthdate ? calcAge(c.birthdate) : '';
    const status = getCatStatus(c.id);
    const info   = [c.gender, age].filter(Boolean).join(' · ');
    const menuId = `cat-menu-${c.id}`;
    return `<div class="cat-card">
      <div class="cat-card-photo" onclick="showCatDetail('${c.id}')">
        ${c.photo_url
          ? `<img src="${c.photo_url}" alt="${c.name}" loading="lazy">`
          : '<div class="cat-no-photo"><i aria-hidden="true" class="fa-solid fa-cat"></i></div>'}
      </div>
      <div class="cat-card-body">
        <div class="cat-card-name-row">
          <div>
            <div class="cat-card-name">${c.name}</div>
            <div class="cat-card-info">${info}</div>
            <div class="cat-status-pill">
              <span class="status-dot status-${status.cls}"></span>${status.label}
            </div>
          </div>
          <div class="apt-menu-wrap">
            <button class="apt-menu-btn" onclick="toggleCardMenu(event,'${menuId}')" aria-label="Opciones de ${c.name}">
              <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <div id="${menuId}" class="apt-menu-dropdown">
              <button onclick="closeAptMenus();showCatDetail('${c.id}')">
                <i class="fa-solid fa-eye"></i> Ver detalle
              </button>
              <button onclick="closeAptMenus();showCatForm('${c.id}')">
                <i class="fa-solid fa-pen-to-square"></i> Editar
              </button>
              <button class="apt-menu-danger" onclick="closeAptMenus();confirmDelete('cat','${c.id}','${c.name}')">
                <i class="fa-solid fa-trash-can"></i> Eliminar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function showCatForm(catId = null) {
  const cat = catId ? state.cats.find(c => c.id === catId) : null;
  const title = cat ? `Editar: ${cat.name}` : 'Agregar Gato';
  openModal(title, `
    <form id="cat-form" onsubmit="saveCat(event,'${catId || ''}')">

      <!-- Foto -->
      <div class="cat-photo-picker" onclick="document.getElementById('cat-photo-file').click()" role="button" tabindex="0" aria-label="Cambiar foto del gato">
        <div id="cat-photo-preview" class="cat-photo-circle ${cat?.photo_url ? '' : 'cat-photo-empty'}">
          ${cat?.photo_url
            ? `<img id="cat-img-preview" src="${cat.photo_url}" alt="${cat.name}">`
            : `<i aria-hidden="true" class="fa-solid fa-camera"></i>`}
        </div>
        <span class="cat-photo-hint">${cat?.photo_url ? 'Cambiar foto' : 'Agregar foto'}</span>
        <input type="file" id="cat-photo-file" accept="image/*" onchange="previewCatPhoto(this)" style="display:none">
      </div>

      <div class="field-row">
        <div class="pfield">
          <label class="pfield-label" for="f-cat-name">Nombre *</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-cat"></i>
            <input type="text" id="f-cat-name" name="name" autocomplete="off" value="${cat?.name || ''}" placeholder="Ej. Mily" required>
          </div>
        </div>
        <div class="pfield">
          <label class="pfield-label" for="f-cat-breed">Raza</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-paw"></i>
            <input type="text" id="f-cat-breed" name="breed" autocomplete="off" value="${cat?.breed || ''}" placeholder="Ej. Siamés">
          </div>
        </div>
      </div>

      <div class="field-row">
        <div class="pfield">
          <label class="pfield-label" for="f-cat-gender">Género</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-venus-mars"></i>
            <select id="f-cat-gender" name="gender">
              <option value="">-- Seleccionar --</option>
              <option value="macho"  ${cat?.gender==='macho' ?'selected':''}>Macho</option>
              <option value="hembra" ${cat?.gender==='hembra'?'selected':''}>Hembra</option>
            </select>
          </div>
        </div>
        <div class="pfield">
          <label class="pfield-label" for="f-cat-birth">Fecha de nacimiento</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-calendar-days"></i>
            <input type="date" id="f-cat-birth" name="birthdate" value="${cat?.birthdate || ''}">
          </div>
        </div>
      </div>

      <div class="field-row">
        <div class="pfield">
          <label class="pfield-label" for="f-cat-color">Color</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-palette"></i>
            <input type="text" id="f-cat-color" name="color" autocomplete="off" value="${cat?.color || ''}" placeholder="Ej. Naranja atigrado">
          </div>
        </div>
        <div class="pfield">
          <label class="pfield-label" for="f-cat-weight">Peso (kg)</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-weight-scale"></i>
            <input type="number" id="f-cat-weight" name="weight" step="any" min="0" max="30" inputmode="decimal" autocomplete="off" value="${cat?.weight || ''}" placeholder="3.5">
          </div>
        </div>
      </div>

      <div class="field-row">
        <div class="pfield">
          <label class="pfield-label" for="f-cat-chip">Microchip</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-microchip"></i>
            <input type="text" id="f-cat-chip" name="microchip" autocomplete="off" value="${cat?.microchip || ''}" placeholder="Número de chip">
          </div>
        </div>
        <div class="pfield">
          <label class="pfield-label" for="f-cat-blood">Tipo de sangre</label>
          <div class="pfield-wrap">
            <i aria-hidden="true" class="fa-solid fa-droplet"></i>
            <input type="text" id="f-cat-blood" name="blood_type" autocomplete="off" value="${cat?.blood_type || ''}" placeholder="Ej. A, B, AB">
          </div>
        </div>
      </div>

      <div class="pfield">
        <label class="pfield-label" for="f-cat-allergies">Alergias</label>
        <div class="pfield-wrap">
          <i aria-hidden="true" class="fa-solid fa-triangle-exclamation"></i>
          <input type="text" id="f-cat-allergies" name="allergies" autocomplete="off" value="${cat?.allergies || ''}" placeholder="Ej. Pollo, antibióticos…">
        </div>
      </div>

      <div class="cat-sterilized-row">
        <input type="checkbox" name="is_sterilized" id="cb-sterilized" ${cat?.is_sterilized ? 'checked' : ''}>
        <label for="cb-sterilized">Está esterilizado/a</label>
      </div>

      <div class="pfield">
        <label class="pfield-label" for="f-cat-notes">Notas</label>
        <textarea id="f-cat-notes" name="notes" class="pfield-textarea" placeholder="Observaciones, comportamiento, condiciones especiales…">${cat?.notes || ''}</textarea>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

function previewCatPhoto(input) {
  if (!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('cat-photo-preview');
    preview.className = '';
    preview.innerHTML = `<img class="photo-preview" id="cat-img-preview" src="${e.target.result}">`;
  };
  reader.readAsDataURL(input.files[0]);
}

async function saveCat(e, catId) {
  e.preventDefault();
  const form = e.target;
  const fd   = new FormData(form);
  let photoUrl = catId ? state.cats.find(c => c.id === catId)?.photo_url : null;

  // Subir foto si hay una nueva
  const photoFile = document.getElementById('cat-photo-file')?.files[0];
  if (photoFile) {
    const ext  = photoFile.name.split('.').pop().toLowerCase();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('cat-photos').upload(path, photoFile, {
      contentType: photoFile.type,
    });
    if (upErr) {
      console.error('Error subiendo foto:', upErr);
      showToast('No se pudo subir la foto: ' + upErr.message, 'error');
      return;
    }
    const { data } = sb.storage.from('cat-photos').getPublicUrl(path);
    photoUrl = data.publicUrl;
  }

  const payload = {
    user_id:       state.user.id,
    name:          fd.get('name'),
    breed:         fd.get('breed') || null,
    birthdate:     fd.get('birthdate') || null,
    gender:        fd.get('gender') || null,
    color:         fd.get('color') || null,
    weight:        fd.get('weight') ? parseFloat(fd.get('weight')) : null,
    microchip:     fd.get('microchip') || null,
    blood_type:    fd.get('blood_type') || null,
    allergies:     fd.get('allergies') || null,
    is_sterilized: fd.get('is_sterilized') === 'on',
    notes:         fd.get('notes') || null,
    photo_url:     photoUrl,
  };

  let err;
  if (catId) {
    ({ error: err } = await sb.from('cats').update(payload).eq('id', catId));
  } else {
    ({ error: err } = await sb.from('cats').insert(payload));
  }
  if (err) return showToast('Error al guardar: ' + err.message, 'error');
  showToast(catId ? 'Gato actualizado' : 'Gato registrado', 'success');
  closeModalDirect();
  await loadAllData();
  renderCats();
}

async function showCatDetail(catId) {
  const cat  = state.cats.find(c => c.id === catId);
  if (!cat) return;
  const apts  = state.appointments.filter(a => a.cat_id === catId).slice(0, 3);
  const vacs  = state.vaccines.filter(v => v.cat_id === catId).slice(0, 3);
  const dews  = state.dewormings.filter(d => d.cat_id === catId).slice(0, 3);

  openModal(cat.name, `
    <div style="text-align:center;margin-bottom:16px">
      <div style="width:100px;height:100px;border-radius:50%;overflow:hidden;margin:0 auto 10px;background:#EDE9FE;display:flex;align-items:center;justify-content:center;font-size:3rem">
        ${cat.photo_url ? `<img src="${cat.photo_url}" alt="${cat.name}" width="100" height="100" style="width:100%;height:100%;object-fit:cover">` : '[sin foto]'}
      </div>
      <h3>${cat.name}</h3>
      <p class="text-muted">${cat.breed || 'Sin raza'} · ${cat.gender || ''}</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${infoBlock('Edad', cat.birthdate ? calcAge(cat.birthdate) : '—')}
      ${infoBlock('Peso', cat.weight ? cat.weight + ' kg' : '—')}
      ${infoBlock('Microchip', cat.microchip || '—')}
      ${infoBlock('Sangre', cat.blood_type || '—')}
      ${infoBlock('Esterilizado', cat.is_sterilized ? 'Sí' : 'No')}
      ${infoBlock('Alergias', cat.allergies || 'Ninguna')}
    </div>
    ${cat.notes ? `<p style="font-size:.85rem;color:var(--text-muted);margin-bottom:16px">${cat.notes}</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" onclick="closeModalDirect();showCatForm('${catId}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
      <button class="btn-secondary" onclick="closeModalDirect();navigate('appointments')"><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Ver citas</button>
    </div>
  `);
}

function infoBlock(label, val) {
  return `<div style="background:var(--bg);border-radius:8px;padding:8px 12px">
    <div style="font-size:.75rem;color:var(--text-muted)">${label}</div>
    <div style="font-weight:600;font-size:.9rem">${val}</div>
  </div>`;
}

// ──────────────────────────────────────────────
// VETERINARIOS
// ──────────────────────────────────────────────
function renderVets() {
  const grid = document.getElementById('vets-grid');
  if (!state.vets.length) {
    grid.innerHTML = '<div class="empty-state">No tienes veterinarios registrados aun.</div>';
    return;
  }
  grid.innerHTML = state.vets.map(v => `
    <div class="vet-card">
      <div class="vet-card-header">
        <div class="vet-card-header-info">
          <div class="vet-card-name">Dr(a). ${v.name}</div>
          ${v.clinic_name ? `<div class="vet-card-clinic">${v.clinic_name}</div>` : ''}
        </div>
        <div class="apt-menu-wrap">
          <button class="apt-menu-btn" onclick="toggleVetMenu(event,'${v.id}')" aria-label="Opciones" aria-haspopup="true">
            <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="apt-menu-dropdown" id="vet-menu-${v.id}" role="menu">
            <button role="menuitem" onclick="showVetForm('${v.id}');closeVetMenus()">
              <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar
            </button>
            <button role="menuitem" class="apt-menu-danger" onclick="confirmDelete('vet','${v.id}','${v.name}');closeVetMenus()">
              <i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
      <div class="vet-card-info">
        ${v.address ? `<p><i aria-hidden="true" class="fa-solid fa-location-dot"></i> ${v.address}${v.city ? ', ' + v.city : ''}</p>` : ''}
        ${v.schedule ? `<p><i aria-hidden="true" class="fa-solid fa-clock"></i> ${v.schedule}</p>` : ''}
      </div>
      ${(v.phone || v.email || v.address) ? `<div class="vet-card-actions">
        ${v.phone ? `<a class="btn-vet-contact btn-vet-call" href="tel:${v.phone}" aria-label="Llamar a ${v.name}"><i aria-hidden="true" class="fa-solid fa-phone"></i> Llamar</a>` : ''}
        ${v.email ? `<a class="btn-vet-contact btn-vet-email" href="mailto:${v.email}" aria-label="Enviar correo a ${v.name}"><i aria-hidden="true" class="fa-solid fa-envelope"></i> Email</a>` : ''}
        ${v.address ? `<a class="btn-waze" href="${wazeUrl(v.address)}" target="_blank" rel="noopener noreferrer"><i aria-hidden="true" class="fa-solid fa-route"></i> Waze</a>` : ''}
      </div>` : ''}
    </div>
  `).join('');
}

function showVetForm(vetId = null) {
  const v = vetId ? state.vets.find(x => x.id === vetId) : null;
  openModal(v ? `Editar: ${v.name}` : 'Agregar Veterinario', `
    <form id="vet-form" onsubmit="saveVet(event,'${vetId || ''}')">
      <div class="field-row">
        <div class="field">
          <label>Nombre del veterinario *</label>
          <input type="text" name="name" value="${v?.name || ''}" required>
        </div>
        <div class="field">
          <label>Nombre de la clínica</label>
          <input type="text" name="clinic_name" value="${v?.clinic_name || ''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-phone"></i> Telefono</label>
          <input type="tel" name="phone" autocomplete="tel" value="${v?.phone || ''}">
        </div>
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-envelope"></i> Email</label>
          <input type="email" name="email" autocomplete="email" spellcheck="false" value="${v?.email || ''}">
        </div>
      </div>
      <div class="field">
        <label><i aria-hidden="true" class="fa-solid fa-location-dot"></i> Direccion completa</label>
        <input type="text" name="address" value="${v?.address || ''}" placeholder="Calle, Número, Colonia">
      </div>
      <div class="field">
        <label>Ciudad</label>
        <input type="text" name="city" value="${v?.city || ''}">
      </div>
      <div class="field">
        <label><i aria-hidden="true" class="fa-solid fa-clock"></i> Horario de atencion</label>
        <input type="text" name="schedule" value="${v?.schedule || ''}" placeholder="Ej: Lun-Vie 9:00-18:00">
      </div>
      <div class="field">
        <label>Notas</label>
        <textarea name="notes">${v?.notes || ''}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

async function saveVet(e, vetId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    user_id:     state.user.id,
    name:        fd.get('name'),
    clinic_name: fd.get('clinic_name') || null,
    phone:       fd.get('phone') || null,
    email:       fd.get('email') || null,
    address:     fd.get('address') || null,
    city:        fd.get('city') || null,
    schedule:    fd.get('schedule') || null,
    notes:       fd.get('notes') || null,
  };
  let err;
  if (vetId) {
    ({ error: err } = await sb.from('veterinarians').update(payload).eq('id', vetId));
  } else {
    ({ error: err } = await sb.from('veterinarians').insert(payload));
  }
  if (err) return showToast('Error: ' + err.message, 'error');
  showToast(vetId ? 'Veterinario actualizado' : 'Veterinario registrado', 'success');
  closeModalDirect();
  await loadAllData();
  renderVets();
}

// ──────────────────────────────────────────────
// CITAS
// ──────────────────────────────────────────────
function renderAppointments() {
  const catFilter    = document.getElementById('apt-filter-cat')?.value;
  const statusFilter = document.getElementById('apt-filter-status')?.value;
  const today        = todayStr();

  let list = [...state.appointments];
  if (catFilter)    list = list.filter(a => a.cat_id === catFilter);
  if (statusFilter) list = list.filter(a => a.status === statusFilter);
  list.sort((a, b) => a.appointment_date < b.appointment_date ? -1 : 1);

  const container = document.getElementById('appointments-list');
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No hay citas registradas.</div>';
    return;
  }

  container.innerHTML = list.map(a => {
    const d      = new Date(a.appointment_date + 'T00:00:00');
    const day    = d.getDate();
    const mon    = d.toLocaleString('es', { month: 'short' });
    const yr     = d.getFullYear();
    const diff   = daysDiff(today, a.appointment_date);
    const isPast = a.appointment_date < today;

    const statusBadge = {
      pendiente:  '<span class="badge badge-yellow">Pendiente</span>',
      completada: '<span class="badge badge-green">Completada</span>',
      cancelada:  '<span class="badge badge-gray">Cancelada</span>',
    }[a.status] || '';

    const reminderBadge = (!isPast && a.status === 'pendiente' && diff <= 2)
      ? `<span class="badge badge-red">${diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : 'En 2 días'}</span>`
      : '';

    const vetName    = a.veterinarians?.clinic_name || a.veterinarians?.name || 'Sin veterinario';
    const vetAddress = a.veterinarians?.address;

    const catPhotoHtml = a.cats?.photo_url
      ? `<img src="${a.cats.photo_url}" alt="${a.cats.name}" class="apt-date-cat-img">`
      : `<div class="apt-date-cat-img apt-date-cat-icon"><i aria-hidden="true" class="fa-solid fa-cat"></i></div>`;

    return `<div class="apt-item">
      <div class="apt-date-box">
        ${catPhotoHtml}
        <div class="apt-date-day">${day}</div>
        <div class="apt-date-mon">${mon}</div>
        <div class="apt-date-yr">${yr}</div>
      </div>
      <div class="apt-info">
        <h4>${a.cats?.name} — ${vetName}</h4>
        <p class="apt-time"><i aria-hidden="true" class="fa-solid fa-clock"></i> ${formatTime(a.appointment_time)}</p>
        <p>${a.reason || 'Sin motivo especificado'}</p>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          ${statusBadge} ${reminderBadge}
        </div>
      </div>
      <div class="apt-menu-wrap">
        <button class="apt-menu-btn" onclick="toggleAptMenu(event,'${a.id}')" aria-label="Opciones" aria-haspopup="true">
          <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
        </button>
        <div class="apt-menu-dropdown" id="apt-menu-${a.id}" role="menu">
          <button role="menuitem" onclick="showAppointmentForm('${a.id}');closeAptMenus()">
            <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar
          </button>
          <button role="menuitem" class="apt-menu-danger" onclick="confirmDelete('appointment','${a.id}','cita');closeAptMenus()">
            <i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar
          </button>
        </div>
      </div>
      <div class="apt-actions">
        <div class="apt-contact-btns">
          ${a.veterinarians?.phone ? `<a class="btn-vet-contact btn-vet-call" href="tel:${a.veterinarians.phone}" aria-label="Llamar al veterinario"><i aria-hidden="true" class="fa-solid fa-phone"></i> Llamar</a>` : ''}
          ${a.veterinarians?.email ? `<a class="btn-vet-contact btn-vet-email" href="mailto:${a.veterinarians.email}" aria-label="Email al veterinario"><i aria-hidden="true" class="fa-solid fa-envelope"></i> Email</a>` : ''}
          ${vetAddress ? `<a class="btn-waze" href="${wazeUrl(vetAddress)}" target="_blank" rel="noopener noreferrer"><i aria-hidden="true" class="fa-solid fa-route"></i> Waze</a>` : ''}
        </div>
        ${a.status === 'pendiente' ? `<button class="btn-complete" onclick="completeAppointment('${a.id}')"><i aria-hidden="true" class="fa-solid fa-circle-check"></i> Completar</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function showAppointmentForm(aptId = null) {
  const a = aptId ? state.appointments.find(x => x.id === aptId) : null;
  const catOptions = state.cats.map(c =>
    `<option value="${c.id}" ${a?.cat_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  const vetOptions = '<option value="">-- Sin asignar --</option>' + state.vets.map(v =>
    `<option value="${v.id}" ${a?.vet_id === v.id ? 'selected' : ''}>${v.name} — ${v.clinic_name || 'Sin clínica'}</option>`).join('');

  openModal(a ? 'Editar cita' : 'Nueva Cita', `
    <form onsubmit="saveAppointment(event,'${aptId || ''}')">
      <div class="field">
        <label>Gato *</label>
        <select name="cat_id" required>${catOptions}</select>
      </div>
      <div class="field">
        <label>Veterinario</label>
        <select name="vet_id">${vetOptions}</select>
      </div>
      <div class="field-row">
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha *</label>
          <input type="date" name="appointment_date" value="${a?.appointment_date || ''}" required>
        </div>
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-clock"></i> Hora *</label>
          <input type="time" name="appointment_time" value="${a?.appointment_time?.slice(0,5) || ''}" required>
        </div>
      </div>
      <div class="field">
        <label>Motivo de la cita</label>
        <input type="text" name="reason" value="${a?.reason || ''}" placeholder="Ej: Vacuna anual, revisión...">
      </div>
      ${aptId ? `<div class="field">
        <label>Estado</label>
        <select name="status">
          <option value="pendiente"  ${a?.status==='pendiente'?'selected':''}>Pendiente</option>
          <option value="completada" ${a?.status==='completada'?'selected':''}>Completada</option>
          <option value="cancelada"  ${a?.status==='cancelada'?'selected':''}>Cancelada</option>
        </select>
      </div>` : ''}
      <div class="field">
        <label>Notas</label>
        <textarea name="notes">${a?.notes || ''}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

async function saveAppointment(e, aptId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    cat_id:           fd.get('cat_id'),
    vet_id:           fd.get('vet_id') || null,
    appointment_date: fd.get('appointment_date'),
    appointment_time: fd.get('appointment_time'),
    reason:           fd.get('reason') || null,
    status:           fd.get('status') || 'pendiente',
    notes:            fd.get('notes') || null,
  };
  let err;
  if (aptId) {
    ({ error: err } = await sb.from('appointments').update(payload).eq('id', aptId));
  } else {
    ({ error: err } = await sb.from('appointments').insert(payload));
  }
  if (err) return showToast('Error: ' + err.message, 'error');
  showToast('Cita guardada', 'success');
  closeModalDirect();
  await loadAllData();
  renderAppointments();
}

async function completeAppointment(id) {
  const { error } = await sb.from('appointments').update({ status: 'completada' }).eq('id', id);
  if (!error) { await loadAllData(); renderAppointments(); showToast('Cita completada', 'success'); }
}

function toggleAptMenu(e, aptId) {
  e.stopPropagation();
  const menu = document.getElementById(`apt-menu-${aptId}`);
  const isOpen = menu?.classList.contains('open');
  closeAptMenus();
  if (!isOpen) menu?.classList.add('open');
}

function closeAptMenus() {
  document.querySelectorAll('.apt-menu-dropdown.open').forEach(m => m.classList.remove('open'));
}

function toggleVetMenu(e, vetId) {
  toggleCardMenu(e, `vet-menu-${vetId}`);
}

function toggleCardMenu(e, menuId) {
  e.stopPropagation();
  const menu = document.getElementById(menuId);
  const isOpen = menu?.classList.contains('open');
  closeAptMenus();
  if (!isOpen) menu?.classList.add('open');
}

function closeVetMenus() {
  closeAptMenus();
}

document.addEventListener('click', () => closeAptMenus());

// ──────────────────────────────────────────────
// CONSULTAS / HISTORIAL
// ──────────────────────────────────────────────
function renderConsultations() {
  const catFilter = document.getElementById('cons-filter-cat')?.value;
  let list = [...state.consultations];
  if (catFilter) list = list.filter(c => c.cat_id === catFilter);

  const container = document.getElementById('consultations-list');
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Sin consultas registradas.</div>';
    return;
  }
  container.innerHTML = list.map(c => {
    const consDocs   = state.documents.filter(d => d.consultation_id === c.id);
    const visitD     = new Date(c.visit_date + 'T00:00:00');
    const day        = visitD.getDate();
    const mon        = visitD.toLocaleString('es', { month: 'short' });
    const yr         = visitD.getFullYear();
    const today      = todayStr();
    const catPhotoHtml = c.cats?.photo_url
      ? `<img src="${c.cats.photo_url}" alt="${c.cats.name}" class="apt-date-cat-img">`
      : `<div class="apt-date-cat-img apt-date-cat-icon"><i aria-hidden="true" class="fa-solid fa-cat"></i></div>`;

    const followUpClass = c.follow_up_date
      ? (c.follow_up_date < today ? 'cons-followup-past' : c.follow_up_date <= daysFromNow(7) ? 'cons-followup-soon' : '')
      : '';

    const docsChipsHtml = consDocs.map(doc => {
      const icon = { receta: 'fa-file-prescription', analisis: 'fa-flask', rayos_x: 'fa-x-ray', otro: 'fa-file' }[doc.type] || 'fa-file';
      return doc.file_url
        ? `<button type="button" class="cons-doc-chip" onclick="openDocViewer('${doc.file_url}','${doc.title.replace(/'/g,"\\'")}','${doc.file_type||''}')"><i aria-hidden="true" class="fa-solid ${icon}"></i> ${doc.title}</button>`
        : `<span class="cons-doc-chip cons-doc-chip-nofile"><i aria-hidden="true" class="fa-solid ${icon}"></i> ${doc.title}</span>`;
    }).join('');

    return `
    <div class="cons-card">
      <div class="cons-card-header">
        <div class="apt-date-box">
          ${catPhotoHtml}
          <div class="apt-date-day">${day}</div>
          <div class="apt-date-mon">${mon}</div>
          <div class="apt-date-yr">${yr}</div>
        </div>
        <div class="cons-card-info">
          <div class="cons-card-title-row">
            <h4>${c.cats?.name}</h4>
            ${c.weight_at_visit ? `<span class="cons-weight-badge"><i aria-hidden="true" class="fa-solid fa-weight-scale"></i> ${c.weight_at_visit} kg</span>` : ''}
            ${c.follow_up_date ? `<span class="cons-followup-chip ${followUpClass}"><i aria-hidden="true" class="fa-solid fa-calendar-check"></i> Seg: ${formatDate(c.follow_up_date)}</span>` : ''}
          </div>
          <p class="cons-vet-line">${c.veterinarians?.name || 'Sin veterinario'}${c.veterinarians?.clinic_name ? ' · ' + c.veterinarians.clinic_name : ''}</p>
          ${c.reason ? `<p class="cons-reason"><strong>Motivo:</strong> ${c.reason}</p>` : ''}
        </div>
        <div class="apt-menu-wrap">
          <button class="apt-menu-btn" onclick="toggleCardMenu(event,'cons-menu-${c.id}')" aria-label="Opciones" aria-haspopup="true">
            <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="apt-menu-dropdown" id="cons-menu-${c.id}" role="menu">
            <button role="menuitem" onclick="showConsultationForm('${c.id}');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar
            </button>
            <button role="menuitem" class="apt-menu-danger" onclick="confirmDelete('consultation','${c.id}','consulta');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
      ${(c.diagnosis || c.treatment) ? `
        <div class="cons-expandable" id="cons-exp-${c.id}">
          ${c.diagnosis ? `<p><strong>Diagnóstico:</strong> ${c.diagnosis}</p>` : ''}
          ${c.treatment ? `<p><strong>Tratamiento:</strong> ${c.treatment}</p>` : ''}
        </div>
        <button type="button" class="cons-expand-btn" onclick="toggleConsExp('${c.id}',this)" aria-expanded="false">
          <i aria-hidden="true" class="fa-solid fa-chevron-down"></i>
        </button>
      ` : ''}
      <div class="cons-card-footer">
        ${consDocs.length ? `<div class="cons-docs-chips">${docsChipsHtml}</div>` : ''}
        <button type="button" class="btn-secondary cons-add-doc-btn" onclick="showConsDocModal('${c.id}')">
          <i aria-hidden="true" class="fa-solid fa-paperclip"></i> ${consDocs.length ? `Docs (${consDocs.length})` : 'Agregar doc'}
        </button>
      </div>
    </div>`;
  }).join('');
}

function showConsultationForm(consId = null) {
  _consDocCounter = 0;
  const c = consId ? state.consultations.find(x => x.id === consId) : null;
  const catOptions = state.cats.map(x =>
    `<option value="${x.id}" ${c?.cat_id === x.id ? 'selected' : ''}>${x.name}</option>`).join('');
  const vetOptions = '<option value="">-- Sin asignar --</option>' + state.vets.map(v =>
    `<option value="${v.id}" ${c?.vet_id === v.id ? 'selected' : ''}>${v.name}</option>`).join('');

  const typeIcon  = { receta: 'fa-file-prescription', analisis: 'fa-flask', rayos_x: 'fa-x-ray', otro: 'fa-file' };
  const typeLabel = { receta: 'Receta', analisis: 'Analisis', rayos_x: 'Rayos X', otro: 'Otro' };

  const existingDocs = consId
    ? state.documents.filter(d => d.consultation_id === consId)
    : [];

  const existingDocsHtml = existingDocs.length ? `
    <div class="cons-existing-docs">
      ${existingDocs.map(d => `
        <div class="cons-existing-doc-row">
          <i aria-hidden="true" class="fa-solid ${typeIcon[d.type] || 'fa-file'}"></i>
          <span class="cons-existing-doc-title">${d.title}</span>
          <span class="badge badge-gray" style="font-size:.68rem">${typeLabel[d.type] || 'Otro'}</span>
          ${d.file_url ? `<a href="${d.file_url}" target="_blank" rel="noopener noreferrer" class="btn-link-sm">Ver</a>` : ''}
          <button type="button" class="btn-unlink" onclick="unlinkConsDoc('${d.id}')" aria-label="Quitar documento">
            <i aria-hidden="true" class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `).join('')}
    </div>
  ` : '';

  openModal(c ? 'Editar consulta' : 'Nueva Consulta', `
    <form onsubmit="saveConsultation(event,'${consId || ''}')">
      <div class="field-row">
        <div class="field">
          <label>Gato *</label>
          <select name="cat_id" required>${catOptions}</select>
        </div>
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha de visita *</label>
          <input type="date" name="visit_date" value="${c?.visit_date || todayStr()}" required>
        </div>
      </div>
      <div class="field">
        <label>Veterinario</label>
        <select name="vet_id">${vetOptions}</select>
      </div>
      <div class="field">
        <label>Motivo</label>
        <input type="text" name="reason" value="${c?.reason || ''}">
      </div>
      <div class="field">
        <label>Diagnostico</label>
        <textarea name="diagnosis">${c?.diagnosis || ''}</textarea>
      </div>
      <div class="field">
        <label>Tratamiento</label>
        <textarea name="treatment">${c?.treatment || ''}</textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-weight-scale"></i> Peso (kg)</label>
          <input type="number" name="weight_at_visit" step="any" min="0" max="30" inputmode="decimal" autocomplete="off" value="${c?.weight_at_visit || ''}">
        </div>
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-temperature-half"></i> Temperatura (C)</label>
          <input type="number" name="temperature" step="0.1" inputmode="decimal" autocomplete="off" value="${c?.temperature || ''}">
        </div>
      </div>
      <div class="field">
        <label><i aria-hidden="true" class="fa-solid fa-calendar-plus"></i> Fecha de seguimiento</label>
        <input type="date" name="follow_up_date" value="${c?.follow_up_date || ''}">
      </div>
      <div class="field">
        <label>Notas</label>
        <textarea name="notes">${c?.notes || ''}</textarea>
      </div>
      <div class="cons-docs-section">
        <div class="cons-docs-header">
          <span><i aria-hidden="true" class="fa-solid fa-paperclip"></i> Documentos adjuntos</span>
          <button type="button" class="btn-add-doc" onclick="addConsDocRow()">
            <i aria-hidden="true" class="fa-solid fa-plus"></i> Agregar
          </button>
        </div>
        ${existingDocsHtml}
        <div id="cons-doc-rows"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

function addConsDocRow() {
  const container = document.getElementById('cons-doc-rows');
  if (!container) return;
  const idx = _consDocCounter++;
  const row = document.createElement('div');
  row.className = 'cons-doc-row';
  row.id = `cons-doc-row-${idx}`;
  row.innerHTML = `
    <div class="cons-doc-row-fields">
      <select id="cons-doc-type-${idx}" class="cons-doc-type-sel">
        <option value="otro">Otro</option>
        <option value="receta">Receta</option>
        <option value="analisis">Analisis</option>
        <option value="rayos_x">Rayos X</option>
      </select>
      <input type="text" id="cons-doc-title-${idx}" class="cons-doc-title-inp" placeholder="Titulo (opcional)">
      <input type="file" id="cons-doc-file-${idx}" accept="image/*,.pdf">
    </div>
    <button type="button" class="btn-unlink" onclick="document.getElementById('cons-doc-row-${idx}').remove()" aria-label="Quitar fila">
      <i aria-hidden="true" class="fa-solid fa-xmark"></i>
    </button>
  `;
  container.appendChild(row);
}

async function unlinkConsDoc(docId, consId = null) {
  const { error } = await sb.from('documents').update({ consultation_id: null }).eq('id', docId);
  if (error) return showToast('Error: ' + error.message, 'error');
  await loadAllData();
  showToast('Documento desvinculado', 'success');
  if (consId) {
    // Estamos en el modal de documentos — refrescar lista en-sitio
    const listEl = document.getElementById('cons-modal-docs-list');
    if (listEl) listEl.innerHTML = _renderConsDocsList(consId);
    renderConsultations();
  } else {
    // Estamos en el formulario de consulta — quitar sección
    const existingSection = document.querySelector('.cons-existing-docs');
    if (existingSection) existingSection.remove();
  }
}

function toggleConsExp(id, btn) {
  const el = document.getElementById(`cons-exp-${id}`);
  if (!el) return;
  const expanded = el.classList.toggle('expanded');
  btn.setAttribute('aria-expanded', expanded);
  btn.classList.toggle('expanded', expanded);
}

function _renderConsDocsList(consId) {
  const docs = state.documents.filter(d => d.consultation_id === consId);
  const typeIcon  = { receta: 'fa-file-prescription', analisis: 'fa-flask', rayos_x: 'fa-x-ray', otro: 'fa-file' };
  const typeLabel = { receta: 'Receta', analisis: 'Analisis', rayos_x: 'Rayos X', otro: 'Otro' };
  if (!docs.length) return '<p style="font-size:.83rem;color:var(--text-muted);margin-bottom:6px">Sin documentos adjuntos aun.</p>';
  return docs.map(d => `
    <div class="cons-existing-doc-row">
      <i aria-hidden="true" class="fa-solid ${typeIcon[d.type] || 'fa-file'}"></i>
      <span class="cons-existing-doc-title">${d.title}</span>
      <span class="badge badge-gray" style="font-size:.68rem">${typeLabel[d.type] || 'Otro'}</span>
      ${d.file_url ? `<button type="button" class="btn-link-sm" onclick="openDocViewer('${d.file_url}','${d.title.replace(/'/g,"\\'")}','${d.file_type||''}')">Ver</button>` : ''}
      <button type="button" class="btn-unlink" onclick="unlinkConsDoc('${d.id}','${consId}')" aria-label="Quitar">
        <i aria-hidden="true" class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join('');
}

function showConsDocModal(consId) {
  _consDocCounter = 0;
  const cons = state.consultations.find(x => x.id === consId);
  const catId     = cons?.cat_id;
  const visitDate = cons?.visit_date;
  const catName   = cons?.cats?.name || '';

  openModal(`Documentos — ${catName} · ${formatDate(visitDate)}`, `
    <div class="cons-existing-docs" id="cons-modal-docs-list">
      ${_renderConsDocsList(consId)}
    </div>
    <div class="cons-docs-section" style="margin-top:12px">
      <div class="cons-docs-header">
        <span><i aria-hidden="true" class="fa-solid fa-cloud-arrow-up"></i> Subir documentos</span>
        <button type="button" class="btn-add-doc" onclick="addConsDocRow()">
          <i aria-hidden="true" class="fa-solid fa-plus"></i> Agregar
        </button>
      </div>
      <div id="cons-doc-rows"></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick="closeModalDirect()">
        <i aria-hidden="true" class="fa-solid fa-xmark"></i> Cerrar
      </button>
      <button type="button" class="btn-primary" onclick="saveConsDocRows('${consId}','${catId}','${visitDate}')">
        <i aria-hidden="true" class="fa-solid fa-cloud-arrow-up"></i> Subir
      </button>
    </div>
  `);
  addConsDocRow();
}

async function saveConsDocRows(consId, catId, visitDate) {
  const rows = document.querySelectorAll('.cons-doc-row');
  let uploaded = 0;
  let errors   = 0;
  for (const row of rows) {
    const rowId   = row.id.replace('cons-doc-row-', '');
    const fileEl  = document.getElementById(`cons-doc-file-${rowId}`);
    const typeEl  = document.getElementById(`cons-doc-type-${rowId}`);
    const titleEl = document.getElementById(`cons-doc-title-${rowId}`);
    const file    = fileEl?.files[0];
    if (!file) continue;
    const ext  = file.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}_${rowId}.${ext}`;
    const { error: upErr } = await sb.storage.from('medical-docs').upload(path, file, { upsert: true });
    if (upErr) { errors++; continue; }
    const { data: urlData } = await sb.storage.from('medical-docs').createSignedUrl(path, 60 * 60 * 24 * 365);
    const title = titleEl?.value?.trim() || file.name.replace(/\.[^.]+$/, '');
    const { error: dbErr } = await sb.from('documents').insert({
      cat_id: catId, consultation_id: consId,
      type: typeEl?.value || 'otro', title,
      date_issued: visitDate || null,
      file_url: urlData?.signedUrl || null,
      file_type: file.type,
    });
    if (!dbErr) uploaded++; else errors++;
  }

  await loadAllData();

  // Refrescar lista en el modal sin cerrarlo
  const listEl = document.getElementById('cons-modal-docs-list');
  if (listEl) listEl.innerHTML = _renderConsDocsList(consId);

  // Limpiar filas y agregar una nueva lista para seguir subiendo
  const rowsContainer = document.getElementById('cons-doc-rows');
  if (rowsContainer) { rowsContainer.innerHTML = ''; addConsDocRow(); }

  renderConsultations();

  if (!uploaded && !errors) return showToast('Selecciona al menos un archivo', 'error');
  if (errors > 0) showToast(`${errors} archivo(s) no se pudieron subir`, 'error');
  if (uploaded > 0) showToast(`${uploaded} documento(s) subido(s)`, 'success');
}

async function saveConsultation(e, consId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const catId = fd.get('cat_id');
  const visitDate = fd.get('visit_date');
  const payload = {
    cat_id:          catId,
    vet_id:          fd.get('vet_id') || null,
    visit_date:      visitDate,
    reason:          fd.get('reason') || null,
    diagnosis:       fd.get('diagnosis') || null,
    treatment:       fd.get('treatment') || null,
    weight_at_visit: fd.get('weight_at_visit') ? parseFloat(fd.get('weight_at_visit')) : null,
    temperature:     fd.get('temperature') ? parseFloat(fd.get('temperature')) : null,
    follow_up_date:  fd.get('follow_up_date') || null,
    notes:           fd.get('notes') || null,
  };

  let savedId = consId;
  if (consId) {
    const { error: err } = await sb.from('consultations').update(payload).eq('id', consId);
    if (err) return showToast('Error: ' + err.message, 'error');
  } else {
    const { data, error: err } = await sb.from('consultations').insert(payload).select('id').single();
    if (err) return showToast('Error: ' + err.message, 'error');
    savedId = data.id;
  }

  // Upload pending document rows
  const rows = document.querySelectorAll('.cons-doc-row');
  let docErrors = 0;
  for (const row of rows) {
    const rowId = row.id.replace('cons-doc-row-', '');
    const fileEl  = document.getElementById(`cons-doc-file-${rowId}`);
    const typeEl  = document.getElementById(`cons-doc-type-${rowId}`);
    const titleEl = document.getElementById(`cons-doc-title-${rowId}`);
    const file = fileEl?.files[0];
    if (!file) continue;

    const ext  = file.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}_${rowId}.${ext}`;
    const { error: upErr } = await sb.storage.from('medical-docs').upload(path, file, { upsert: true });
    if (upErr) { docErrors++; continue; }
    const { data: urlData } = await sb.storage.from('medical-docs').createSignedUrl(path, 60 * 60 * 24 * 365);

    const title = titleEl?.value?.trim() || file.name.replace(/\.[^.]+$/, '');
    await sb.from('documents').insert({
      cat_id:          catId,
      consultation_id: savedId,
      type:            typeEl?.value || 'otro',
      title,
      date_issued:     visitDate || null,
      file_url:        urlData?.signedUrl || null,
      file_type:       file.type,
    });
  }

  if (docErrors > 0) showToast(`Consulta guardada (${docErrors} archivo(s) fallaron)`, 'error');
  else showToast('Consulta guardada', 'success');
  closeModalDirect();
  await loadAllData();
  navigate('consultations');
}

// ──────────────────────────────────────────────
// VACUNAS
// ──────────────────────────────────────────────
function renderVaccines() {
  const catFilter = document.getElementById('vac-filter-cat')?.value;
  let list = [...state.vaccines];
  if (catFilter) list = list.filter(v => v.cat_id === catFilter);

  const container = document.getElementById('vaccines-list');
  const today = todayStr();
  const in30  = daysFromNow(30);

  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Sin vacunas registradas.</div>';
    return;
  }
  container.innerHTML = list.map(v => {
    const isVencida = v.next_due_date && v.next_due_date < today;
    const isProxima = v.next_due_date && v.next_due_date <= in30 && !isVencida;
    const nextClass = isVencida ? 'dose-value-alert' : isProxima ? 'dose-value-soon' : '';
    const nextLabel = isVencida
      ? `<span class="dose-badge-alert"><i aria-hidden="true" class="fa-solid fa-circle-exclamation"></i> Vencida</span>`
      : isProxima
      ? `<span class="dose-badge-soon"><i aria-hidden="true" class="fa-solid fa-clock"></i> Próximo</span>`
      : '';
    const recurBadge = v.interval_months
      ? `<span class="recur-badge"><i aria-hidden="true" class="fa-solid fa-rotate"></i> Cada ${v.interval_months} mes${v.interval_months > 1 ? 'es' : ''}</span>`
      : '';

    return `<div class="dose-card">
      <div class="dose-card-header">
        <div class="dose-card-title">
          ${catAvatarHtml(v.cats)}
          <div class="dose-card-title-text">
            <h4>${v.vaccine_name} <span class="dose-cat-name">&mdash; ${v.cats?.name}</span></h4>
            <div class="dose-card-meta">
              ${recurBadge}
              ${v.vaccine_brand ? `<span class="dose-meta-text">${v.vaccine_brand}${v.batch_number ? ' · Lote ' + v.batch_number : ''}</span>` : ''}
              ${v.veterinarians?.name ? `<span class="dose-meta-text"><i aria-hidden="true" class="fa-solid fa-user-doctor"></i> ${v.veterinarians.name}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="apt-menu-wrap">
          <button class="apt-menu-btn" onclick="toggleCardMenu(event,'vac-menu-${v.id}')" aria-label="Opciones" aria-haspopup="true">
            <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="apt-menu-dropdown" id="vac-menu-${v.id}" role="menu">
            <button role="menuitem" onclick="showVaccineForm('${v.id}');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar
            </button>
            ${v.interval_months ? `<button role="menuitem" onclick="stopRecurring('vaccines','${v.id}');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-stop"></i> Detener
            </button>` : ''}
            <button role="menuitem" class="apt-menu-danger" onclick="confirmDelete('vaccine','${v.id}','vacuna');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
      <div class="dose-timeline">
        <div class="dose-col">
          <span class="dose-col-label">Aplicada</span>
          <span class="dose-col-value">${formatDate(v.date_applied)}</span>
        </div>
        <div class="dose-arrow"><i aria-hidden="true" class="fa-solid fa-arrow-right"></i></div>
        <div class="dose-col">
          <span class="dose-col-label">Próxima dosis ${nextLabel}</span>
          <span class="dose-col-value ${nextClass}">${v.next_due_date ? formatDate(v.next_due_date) : '&mdash;'}</span>
        </div>
      </div>
      ${v.interval_months ? `<div class="dose-card-footer">
        <button class="btn-primary dose-btn" onclick="registerNewVaccineDose('${v.id}')">
          <i aria-hidden="true" class="fa-solid fa-syringe"></i> Nueva dosis
        </button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function showVaccineForm(vacId = null, prefill = null) {
  const v = vacId ? state.vaccines.find(x => x.id === vacId) : null;
  const data = prefill || v;
  const catOpts = state.cats.map(c => `<option value="${c.id}" ${data?.cat_id===c.id?'selected':''}>${c.name}</option>`).join('');
  const vetOpts = '<option value="">-- Sin asignar --</option>' + state.vets.map(x => `<option value="${x.id}" ${data?.vet_id===x.id?'selected':''}>${x.name}</option>`).join('');

  openModal(vacId && !prefill ? 'Editar vacuna' : 'Registrar Vacuna', `
    <form onsubmit="saveVaccine(event,'${prefill ? '' : (vacId || '')}')">
      <div class="field-row">
        <div class="field"><label>Gato *</label><select name="cat_id" required>${catOpts}</select></div>
        <div class="field"><label>Veterinario</label><select name="vet_id">${vetOpts}</select></div>
      </div>
      <div class="field"><label>Nombre de la vacuna *</label>
        <input type="text" name="vaccine_name" value="${data?.vaccine_name||''}" required placeholder="Ej: Triple felina, Rabia&hellip;">
      </div>
      <div class="field-row">
        <div class="field"><label>Marca</label><input type="text" name="vaccine_brand" value="${data?.vaccine_brand||''}"></div>
        <div class="field"><label>Numero de lote</label><input type="text" name="batch_number" value="${data?.batch_number||''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha aplicacion *</label>
          <input type="date" name="date_applied" id="vac-date-applied" value="${prefill?.date_applied || data?.date_applied || todayStr()}" required
            oninput="autoCalcDue('vac-date-applied','vac-interval','vac-next-due')">
        </div>
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-plus"></i> Proximo refuerzo</label>
          <input type="date" name="next_due_date" id="vac-next-due" value="${data?.next_due_date||''}">
        </div>
      </div>
      <div class="field recurring-field">
        <label><i aria-hidden="true" class="fa-solid fa-rotate"></i> Repetir cada (meses)</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="number" name="interval_months" id="vac-interval" min="1" max="36" step="1"
            value="${data?.interval_months||''}" placeholder="Ej: 3, 6, 12"
            oninput="autoCalcDue('vac-date-applied','vac-interval','vac-next-due')">
          <span class="text-muted" style="font-size:.8rem;white-space:nowrap">meses &mdash; dejar vacio para no repetir</span>
        </div>
      </div>
      <div class="field"><label>Notas</label><textarea name="notes">${data?.notes||''}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

function autoCalcDue(dateId, intervalId, dueId) {
  const dateEl     = document.getElementById(dateId);
  const intervalEl = document.getElementById(intervalId);
  const dueEl      = document.getElementById(dueId);
  if (!dateEl || !intervalEl || !dueEl) return;
  if (dateEl.value && intervalEl.value) {
    dueEl.value = addMonths(dateEl.value, intervalEl.value);
  }
}

function registerNewVaccineDose(vacId) {
  const v = state.vaccines.find(x => x.id === vacId);
  if (!v) return;
  const today = todayStr();
  showVaccineForm(null, {
    cat_id:        v.cat_id,
    vet_id:        v.vet_id,
    vaccine_name:  v.vaccine_name,
    vaccine_brand: v.vaccine_brand,
    interval_months: v.interval_months,
    date_applied:  today,
    next_due_date: v.interval_months ? addMonths(today, v.interval_months) : '',
  });
}

async function saveVaccine(e, vacId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const interval = fd.get('interval_months') ? parseInt(fd.get('interval_months')) : null;
  const dateApplied = fd.get('date_applied');
  const nextDue = interval ? addMonths(dateApplied, interval) : (fd.get('next_due_date') || null);

  const payload = {
    cat_id:          fd.get('cat_id'),
    vet_id:          fd.get('vet_id') || null,
    vaccine_name:    fd.get('vaccine_name'),
    vaccine_brand:   fd.get('vaccine_brand') || null,
    batch_number:    fd.get('batch_number') || null,
    date_applied:    dateApplied,
    next_due_date:   nextDue,
    interval_months: interval,
    notes:           fd.get('notes') || null,
  };
  let err;
  if (vacId) {
    ({ error: err } = await sb.from('vaccines').update(payload).eq('id', vacId));
  } else {
    ({ error: err } = await sb.from('vaccines').insert(payload));
  }
  if (err) return showToast('Error: ' + err.message, 'error');
  showToast('Vacuna guardada', 'success');
  closeModalDirect();
  await loadAllData();
  renderVaccines();
}

// ──────────────────────────────────────────────
// DESPARASITACIONES
// ──────────────────────────────────────────────
function renderDewormings() {
  const catFilter = document.getElementById('dew-filter-cat')?.value;
  let list = [...state.dewormings];
  if (catFilter) list = list.filter(d => d.cat_id === catFilter);

  const container = document.getElementById('dewormings-list');
  const today = todayStr();
  const in30  = daysFromNow(30);

  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Sin desparasitaciones registradas.</div>';
    return;
  }
  container.innerHTML = list.map(d => {
    const typeLabel = { interno: 'Interno', externo: 'Externo', ambos: 'Interno+Externo' }[d.type] || '';
    const isVencida = d.next_due_date && d.next_due_date < today;
    const isProxima = d.next_due_date && d.next_due_date <= in30 && !isVencida;
    const nextClass = isVencida ? 'dose-value-alert' : isProxima ? 'dose-value-soon' : '';
    const nextLabel = isVencida
      ? `<span class="dose-badge-alert"><i aria-hidden="true" class="fa-solid fa-circle-exclamation"></i> Vencida</span>`
      : isProxima
      ? `<span class="dose-badge-soon"><i aria-hidden="true" class="fa-solid fa-clock"></i> Próxima</span>`
      : '';
    const recurBadge = d.interval_months
      ? `<span class="recur-badge"><i aria-hidden="true" class="fa-solid fa-rotate"></i> Cada ${d.interval_months} mes${d.interval_months > 1 ? 'es' : ''}</span>`
      : '';

    return `<div class="dose-card">
      <div class="dose-card-header">
        <div class="dose-card-title">
          ${catAvatarHtml(d.cats)}
          <div class="dose-card-title-text">
            <h4>${d.product_name} <span class="dose-cat-name">&mdash; ${d.cats?.name}</span></h4>
            <div class="dose-card-meta">
              ${recurBadge}
              ${typeLabel ? `<span class="dose-meta-text">${typeLabel}${d.dose ? ' · ' + d.dose : ''}</span>` : ''}
              ${d.veterinarians?.name ? `<span class="dose-meta-text"><i aria-hidden="true" class="fa-solid fa-user-doctor"></i> ${d.veterinarians.name}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="apt-menu-wrap">
          <button class="apt-menu-btn" onclick="toggleCardMenu(event,'dew-menu-${d.id}')" aria-label="Opciones" aria-haspopup="true">
            <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="apt-menu-dropdown" id="dew-menu-${d.id}" role="menu">
            <button role="menuitem" onclick="showDewormingForm('${d.id}');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar
            </button>
            ${d.interval_months ? `<button role="menuitem" onclick="stopRecurring('dewormings','${d.id}');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-stop"></i> Detener
            </button>` : ''}
            <button role="menuitem" class="apt-menu-danger" onclick="confirmDelete('deworming','${d.id}','desparasitacion');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
      <div class="dose-timeline">
        <div class="dose-col">
          <span class="dose-col-label">Aplicada</span>
          <span class="dose-col-value">${formatDate(d.date_applied)}</span>
        </div>
        <div class="dose-arrow"><i aria-hidden="true" class="fa-solid fa-arrow-right"></i></div>
        <div class="dose-col">
          <span class="dose-col-label">Próxima dosis ${nextLabel}</span>
          <span class="dose-col-value ${nextClass}">${d.next_due_date ? formatDate(d.next_due_date) : '&mdash;'}</span>
        </div>
      </div>
      ${d.interval_months ? `<div class="dose-card-footer">
        <button class="btn-primary dose-btn" onclick="registerNewDewormingDose('${d.id}')">
          <i aria-hidden="true" class="fa-solid fa-tablets"></i> Nueva dosis
        </button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function showDewormingForm(dewId = null, prefill = null) {
  const d = dewId ? state.dewormings.find(x => x.id === dewId) : null;
  const data = prefill || d;
  const catOpts = state.cats.map(c => `<option value="${c.id}" ${data?.cat_id===c.id?'selected':''}>${c.name}</option>`).join('');
  const vetOpts = '<option value="">-- Sin asignar --</option>' + state.vets.map(v => `<option value="${v.id}" ${data?.vet_id===v.id?'selected':''}>${v.name}</option>`).join('');

  openModal(dewId && !prefill ? 'Editar desparasitacion' : 'Registrar Desparasitacion', `
    <form onsubmit="saveDeworming(event,'${prefill ? '' : (dewId || '')}')">
      <div class="field-row">
        <div class="field"><label>Gato *</label><select name="cat_id" required>${catOpts}</select></div>
        <div class="field"><label>Veterinario</label><select name="vet_id">${vetOpts}</select></div>
      </div>
      <div class="field"><label>Producto *</label>
        <input type="text" name="product_name" value="${data?.product_name||''}" required placeholder="Ej: Stronghold, Advocate&hellip;">
      </div>
      <div class="field-row">
        <div class="field">
          <label>Tipo</label>
          <select name="type">
            <option value="">-- Seleccionar --</option>
            <option value="interno" ${data?.type==='interno'?'selected':''}>Interno</option>
            <option value="externo" ${data?.type==='externo'?'selected':''}>Externo</option>
            <option value="ambos"   ${data?.type==='ambos'  ?'selected':''}>Interno+Externo</option>
          </select>
        </div>
        <div class="field"><label>Dosis</label><input type="text" name="dose" value="${data?.dose||''}" placeholder="Ej: 0.5 ml"></div>
      </div>
      <div class="field-row">
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha aplicacion *</label>
          <input type="date" name="date_applied" id="dew-date-applied" value="${prefill?.date_applied || data?.date_applied || todayStr()}" required
            oninput="autoCalcDue('dew-date-applied','dew-interval','dew-next-due')">
        </div>
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-plus"></i> Proxima aplicacion</label>
          <input type="date" name="next_due_date" id="dew-next-due" value="${data?.next_due_date||''}">
        </div>
      </div>
      <div class="field recurring-field">
        <label><i aria-hidden="true" class="fa-solid fa-rotate"></i> Repetir cada (meses)</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="number" name="interval_months" id="dew-interval" min="1" max="36" step="1"
            value="${data?.interval_months||''}" placeholder="Ej: 1, 3, 6"
            oninput="autoCalcDue('dew-date-applied','dew-interval','dew-next-due')">
          <span class="text-muted" style="font-size:.8rem;white-space:nowrap">meses &mdash; dejar vacio para no repetir</span>
        </div>
      </div>
      <div class="field"><label>Notas</label><textarea name="notes">${data?.notes||''}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

function registerNewDewormingDose(dewId) {
  const d = state.dewormings.find(x => x.id === dewId);
  if (!d) return;
  const today = todayStr();
  showDewormingForm(null, {
    cat_id:          d.cat_id,
    vet_id:          d.vet_id,
    product_name:    d.product_name,
    type:            d.type,
    dose:            d.dose,
    interval_months: d.interval_months,
    date_applied:    today,
    next_due_date:   d.interval_months ? addMonths(today, d.interval_months) : '',
  });
}

async function stopRecurring(table, id) {
  const { error } = await sb.from(table).update({ interval_months: null }).eq('id', id);
  if (error) return showToast('Error: ' + error.message, 'error');
  showToast('Repeticion detenida', 'success');
  await loadAllData();
  if (table === 'vaccines') renderVaccines();
  else renderDewormings();
}

async function saveDeworming(e, dewId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const interval = fd.get('interval_months') ? parseInt(fd.get('interval_months')) : null;
  const dateApplied = fd.get('date_applied');
  const nextDue = interval ? addMonths(dateApplied, interval) : (fd.get('next_due_date') || null);

  const payload = {
    cat_id:          fd.get('cat_id'),
    vet_id:          fd.get('vet_id') || null,
    product_name:    fd.get('product_name'),
    type:            fd.get('type') || null,
    dose:            fd.get('dose') || null,
    date_applied:    dateApplied,
    next_due_date:   nextDue,
    interval_months: interval,
    notes:           fd.get('notes') || null,
  };
  let err;
  if (dewId) {
    ({ error: err } = await sb.from('dewormings').update(payload).eq('id', dewId));
  } else {
    ({ error: err } = await sb.from('dewormings').insert(payload));
  }
  if (err) return showToast('Error: ' + err.message, 'error');
  showToast('Desparasitacion guardada', 'success');
  closeModalDirect();
  await loadAllData();
  renderDewormings();
}

// ──────────────────────────────────────────────
// DOCUMENTOS
// ──────────────────────────────────────────────
function renderDocuments() {
  const catFilter  = document.getElementById('doc-filter-cat')?.value;
  const typeFilter = document.getElementById('doc-filter-type')?.value;
  let list = [...state.documents];
  if (catFilter)  list = list.filter(d => d.cat_id === catFilter);
  if (typeFilter) list = list.filter(d => d.type === typeFilter);

  const grid = document.getElementById('documents-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">Sin documentos subidos.</div>';
    return;
  }

  const typeIcon  = { receta: 'fa-file-prescription', analisis: 'fa-flask', rayos_x: 'fa-x-ray', otro: 'fa-file' };
  const typeLabel = { receta: 'Receta', analisis: 'Análisis', rayos_x: 'Rayos X', otro: 'Otro' };

  grid.innerHTML = list.map(d => {
    const safeTitle = d.title.replace(/'/g, "\\'");
    const docDate   = d.date_issued ? formatDate(d.date_issued) : formatDate(d.created_at?.split('T')[0]);
    return `
    <div class="doc-row">
      ${catAvatarHtml(d.cats)}
      <div class="doc-row-icon"><i aria-hidden="true" class="fa-solid ${typeIcon[d.type] || 'fa-file'}"></i></div>
      <div class="doc-row-body">
        <span class="doc-row-title">${d.title}</span>
        <span class="doc-row-meta">${d.cats?.name || '&mdash;'} &middot; ${typeLabel[d.type] || 'Documento'} &middot; ${docDate}</span>
      </div>
      <div class="doc-row-actions">
        ${d.file_url ? `<button class="btn-primary doc-ver-btn" onclick="openDocViewer('${d.file_url}','${safeTitle}','${d.file_type||''}')"><i aria-hidden="true" class="fa-solid fa-eye"></i> Ver</button>` : ''}
        <div class="apt-menu-wrap">
          <button class="apt-menu-btn" onclick="toggleCardMenu(event,'doc-menu-${d.id}')" aria-label="Opciones" aria-haspopup="true">
            <i aria-hidden="true" class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="apt-menu-dropdown" id="doc-menu-${d.id}" role="menu">
            <button role="menuitem" onclick="showDocumentForm('${d.id}');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar
            </button>
            <button role="menuitem" class="apt-menu-danger" onclick="confirmDelete('document','${d.id}','documento');closeAptMenus()">
              <i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _renderDocModalList() {
  const typeIcon  = { receta: 'fa-file-prescription', analisis: 'fa-flask', rayos_x: 'fa-x-ray', otro: 'fa-file' };
  const typeLabel = { receta: 'Receta', analisis: 'Analisis', rayos_x: 'Rayos X', otro: 'Otro' };
  const docs = [...state.documents].slice(0, 20);
  if (!docs.length) return '';
  return `
    <div class="doc-modal-list" id="doc-modal-recent">
      <p class="doc-modal-list-title"><i aria-hidden="true" class="fa-solid fa-clock-rotate-left"></i> Documentos subidos</p>
      ${docs.map(d => `
        <div class="cons-existing-doc-row">
          <i aria-hidden="true" class="fa-solid ${typeIcon[d.type] || 'fa-file'}"></i>
          <span class="cons-existing-doc-title">${d.title} <span style="color:var(--text-light);font-size:.7rem">· ${d.cats?.name || ''}</span></span>
          <span class="badge badge-gray" style="font-size:.68rem">${typeLabel[d.type] || 'Otro'}</span>
          ${d.file_url ? `<button type="button" class="btn-link-sm" onclick="openDocViewer('${d.file_url}','${d.title.replace(/'/g,"\\'")}','${d.file_type||''}')">Ver</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function showDocumentForm(docId = null) {
  const d = docId ? state.documents.find(x => x.id === docId) : null;
  const catOpts = state.cats.map(c => `<option value="${c.id}" ${d?.cat_id===c.id?'selected':''}>${c.name}</option>`).join('');

  if (docId) {
    // Editar: comportamiento original, cierra al guardar
    openModal('Editar documento', `
      <form onsubmit="saveDocument(event,'${docId}')">
        <div class="field"><label>Gato *</label><select name="cat_id" required>${catOpts}</select></div>
        <div class="field">
          <label>Tipo de documento *</label>
          <select name="type" required>
            <option value="">-- Seleccionar --</option>
            <option value="receta"   ${d?.type==='receta'  ?'selected':''}>Receta</option>
            <option value="analisis" ${d?.type==='analisis'?'selected':''}>Analisis</option>
            <option value="rayos_x"  ${d?.type==='rayos_x' ?'selected':''}>Rayos X</option>
            <option value="otro"     ${d?.type==='otro'    ?'selected':''}>Otro</option>
          </select>
        </div>
        <div class="field"><label>Titulo *</label><input type="text" name="title" value="${d?.title||''}" required></div>
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha</label><input type="date" name="date_issued" value="${d?.date_issued||todayStr()}"></div>
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-paperclip"></i> Archivo (imagen o PDF)</label>
          <input type="file" id="doc-file" accept="image/*,.pdf">
          ${d?.file_url ? `<p style="font-size:.8rem;color:var(--secondary);margin-top:4px">Ya tiene archivo — sube uno nuevo para reemplazarlo</p>` : ''}
        </div>
        <div class="field"><label>Notas</label><textarea name="notes">${d?.notes||''}</textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
          <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
        </div>
      </form>
    `);
    return;
  }

  // Nuevo: modal persistente que no se cierra al subir
  openModal('Subir Documentos', `
    <form id="doc-upload-form" onsubmit="saveDocument(event,'')">
      <div class="field-row">
        <div class="field"><label>Gato *</label><select name="cat_id" required>${catOpts}</select></div>
        <div class="field">
          <label>Tipo *</label>
          <select name="type" required>
            <option value="">-- Tipo --</option>
            <option value="receta">Receta</option>
            <option value="analisis">Analisis</option>
            <option value="rayos_x">Rayos X</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Titulo *</label><input type="text" name="title" required placeholder="Ej: Receta antibiotico, Rayos X torax..."></div>
      <div class="field-row">
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha</label><input type="date" name="date_issued" value="${todayStr()}"></div>
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-paperclip"></i> Archivo *</label>
          <input type="file" id="doc-file" accept="image/*,.pdf" required>
        </div>
      </div>
      <div class="field"><label>Notas</label><textarea name="notes" rows="2"></textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cerrar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-cloud-arrow-up"></i> Subir</button>
      </div>
    </form>
    <div id="doc-modal-recent">${_renderDocModalList()}</div>
  `);
}

async function saveDocument(e, docId) {
  e.preventDefault();
  const fd  = new FormData(e.target);
  let fileUrl  = docId ? state.documents.find(x => x.id === docId)?.file_url  : null;
  let fileType = docId ? state.documents.find(x => x.id === docId)?.file_type : null;

  const file = document.getElementById('doc-file')?.files[0];
  if (file) {
    const ext  = file.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('medical-docs').upload(path, file, { upsert: true });
    if (upErr) return showToast('Error al subir archivo: ' + upErr.message, 'error');
    const { data: urlData } = await sb.storage.from('medical-docs').createSignedUrl(path, 60 * 60 * 24 * 365);
    fileUrl  = urlData?.signedUrl || null;
    fileType = file.type;
  }

  const payload = {
    cat_id:      fd.get('cat_id'),
    type:        fd.get('type'),
    title:       fd.get('title'),
    date_issued: fd.get('date_issued') || null,
    notes:       fd.get('notes') || null,
    file_url:    fileUrl,
    file_type:   fileType,
  };
  let err;
  if (docId) {
    ({ error: err } = await sb.from('documents').update(payload).eq('id', docId));
    if (err) return showToast('Error: ' + err.message, 'error');
    showToast('Documento guardado', 'success');
    closeModalDirect();
    await loadAllData();
    renderDocuments();
  } else {
    ({ error: err } = await sb.from('documents').insert(payload));
    if (err) return showToast('Error: ' + err.message, 'error');
    showToast('Documento subido', 'success');
    await loadAllData();
    // Refrescar lista en el modal sin cerrarlo
    const recentEl = document.getElementById('doc-modal-recent');
    if (recentEl) recentEl.innerHTML = _renderDocModalList();
    // Resetear form para el siguiente archivo (mantiene gato y fecha)
    const form = document.getElementById('doc-upload-form');
    if (form) {
      form.querySelector('[name="type"]').value = '';
      form.querySelector('[name="title"]').value = '';
      form.querySelector('[name="notes"]').value = '';
      const fileInput = document.getElementById('doc-file');
      if (fileInput) fileInput.value = '';
      form.querySelector('[name="title"]').focus();
    }
    renderDocuments();
  }
}

// ──────────────────────────────────────────────
// ELIMINAR (genérico)
// ──────────────────────────────────────────────
function confirmDelete(table, id, name) {
  openModal('Confirmar eliminación', `
    <div class="confirm-delete">
      <div class="warn-icon"><i aria-hidden="true" class="fa-solid fa-triangle-exclamation"></i></div>
      <p>¿Eliminar <strong>${name}</strong>? Esta acción no se puede deshacer.</p>
      <div class="btn-row">
        <button class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button class="btn-danger" onclick="doDelete('${table}','${id}')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
      </div>
    </div>
  `);
}

async function doDelete(table, id) {
  const tableMap = {
    cat:          'cats',
    vet:          'veterinarians',
    appointment:  'appointments',
    consultation: 'consultations',
    vaccine:      'vaccines',
    deworming:    'dewormings',
    document:     'documents',
  };
  const { error } = await sb.from(tableMap[table]).delete().eq('id', id);
  if (error) return showToast('Error al eliminar: ' + error.message, 'error');
  showToast('Eliminado', 'success');
  closeModalDirect();
  await loadAllData();
  // Re-render sección actual
  navigate(state.currentSection);
}

// ──────────────────────────────────────────────
// RECORDATORIOS / NOTIFICACIONES
// ──────────────────────────────────────────────
async function checkReminders() {
  const today   = todayStr();
  const in2days = daysFromNow(2);

  const upcoming = state.appointments.filter(a =>
    a.status === 'pendiente' &&
    a.appointment_date >= today &&
    a.appointment_date <= in2days
  );

  if (!upcoming.length) return;

  // Banner en dashboard
  const banner = document.getElementById('reminders-banner');
  if (banner) {
    banner.classList.remove('hidden');
    const items = upcoming.map(a => {
      const diff = daysDiff(today, a.appointment_date);
      const when = diff === 0 ? '¡HOY!' : diff === 1 ? 'Mañana' : 'En 2 dias';
      const vet  = a.veterinarians?.clinic_name || a.veterinarians?.name || 'Sin clinica';
      const addr = a.veterinarians?.address || '';
      return `<div class="reminder-item">
        <strong>${when} &mdash; ${a.cats?.name}</strong>
        ${vet}${a.appointment_time ? ' &middot; ' + formatTime(a.appointment_time) : ''}${a.reason ? ' &middot; ' + a.reason : ''}
        ${addr ? `<br><a class="btn-waze" href="${wazeUrl(addr)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;margin-top:6px;font-size:.8rem"><i aria-hidden="true" class="fa-solid fa-route"></i> Como llegar</a>` : ''}
      </div>`;
    }).join('');
    banner.innerHTML = `<div class="reminder-banner-inner">
      <div class="reminder-icon-circle"><i aria-hidden="true" class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="reminder-content">
        <h4>Recordatorio de citas</h4>
        ${items}
      </div>
    </div>`;
  }

  // Notificaciones del navegador
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const notifiedKey = `notified_${today}`;
  const notified    = JSON.parse(localStorage.getItem(notifiedKey) || '[]');

  upcoming.forEach(a => {
    if (notified.includes(a.id)) return;
    const diff = daysDiff(today, a.appointment_date);
    const when = diff === 0 ? '¡HOY!' : diff === 1 ? 'Mañana' : 'En 2 días';
    const vet  = a.veterinarians?.clinic_name || a.veterinarians?.name || '';
    new Notification('MisGatos — Recordatorio de cita', {
      body: `${when}: ${a.cats?.name} en ${vet} a las ${formatTime(a.appointment_time)}`,
      icon: '/favicon.ico',
    });
    notified.push(a.id);
  });

  localStorage.setItem(notifiedKey, JSON.stringify(notified));
}

function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      Notification.requestPermission().then(p => {
        if (p === 'granted') checkReminders();
      });
    }, 3000);
  }
}

// ──────────────────────────────────────────────
// UTILIDAD: sumar meses a una fecha
// ──────────────────────────────────────────────
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + parseInt(months));
  return d.toISOString().split('T')[0];
}

// ──────────────────────────────────────────────
// WAZE
// ──────────────────────────────────────────────
function wazeUrl(address) {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

// ──────────────────────────────────────────────
// MODAL
// ──────────────────────────────────────────────
let _modalTrigger = null;

// ──────────────────────────────────────────────
// VISOR DE DOCUMENTOS
// ──────────────────────────────────────────────
function openDocViewer(url, title, fileType) {
  const overlay = document.getElementById('doc-viewer-overlay');
  document.getElementById('doc-viewer-title').textContent = title || 'Documento';
  document.getElementById('doc-viewer-download').href = url;

  let bodyHtml;
  if (fileType && fileType.startsWith('image/')) {
    bodyHtml = `<img src="${url}" alt="${title || 'Documento'}">`;
  } else if (fileType === 'application/pdf' || url.toLowerCase().includes('.pdf')) {
    bodyHtml = `<iframe src="${url}" title="${title || 'Documento'}"></iframe>`;
  } else {
    bodyHtml = `<div class="doc-viewer-nopreview">
      <i class="fa-solid fa-file" style="font-size:2.5rem;margin-bottom:12px;display:block" aria-hidden="true"></i>
      No hay vista previa disponible para este tipo de archivo.<br>
      <a href="${url}" target="_blank" rel="noopener" style="color:var(--primary);font-weight:600">Descargar archivo</a>
    </div>`;
  }
  document.getElementById('doc-viewer-body').innerHTML = bodyHtml;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  overlay.querySelector('.modal-close').focus();
}

function closeDocViewer() {
  document.getElementById('doc-viewer-overlay').classList.add('hidden');
  document.getElementById('doc-viewer-body').innerHTML = '';
  document.body.style.overflow = '';
}

function openModal(title, bodyHtml) {
  _modalTrigger = document.activeElement;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHtml;
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const focusable = overlay.querySelectorAll('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();
  });
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalDirect();
}

function closeModalDirect() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  if (_modalTrigger && typeof _modalTrigger.focus === 'function') {
    _modalTrigger.focus();
    _modalTrigger = null;
  }
}

function _trapModalFocus(e) {
  const viewer = document.getElementById('doc-viewer-overlay');
  if (!viewer.classList.contains('hidden')) {
    if (e.key === 'Escape') { closeDocViewer(); return; }
    return;
  }
  const overlay = document.getElementById('modal-overlay');
  if (overlay.classList.contains('hidden')) return;
  if (e.key === 'Escape') { closeModalDirect(); return; }
  if (e.key !== 'Tab') return;
  const focusable = [...overlay.querySelectorAll('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

// ──────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast-${type}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ──────────────────────────────────────────────
// UTILIDADES DE FECHA
// ──────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function daysDiff(from, to) {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to   + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

const _dtf = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
function catAvatarHtml(catObj) {
  if (!catObj) return '<div class="cat-avatar-sm cat-avatar-placeholder"><i class="fa-solid fa-cat" aria-hidden="true"></i></div>';
  if (catObj.photo_url) {
    return `<img src="${catObj.photo_url}" alt="${catObj.name}" class="cat-avatar-sm" loading="lazy">`;
  }
  return `<div class="cat-avatar-sm cat-avatar-placeholder"><i class="fa-solid fa-cat" aria-hidden="true"></i></div>`;
}

function formatDate(str) {
  if (!str) return '—';
  return _dtf.format(new Date(str + 'T00:00:00'));
}

function formatTime(t) {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${m} ${ampm}`;
}

function calcAge(birthdate) {
  if (!birthdate) return '';
  const birth = new Date(birthdate + 'T00:00:00');
  const now   = new Date();
  let years   = now.getFullYear() - birth.getFullYear();
  let months  = now.getMonth() - birth.getMonth();
  if (months < 0) { years--; months += 12; }
  if (years > 0 && months > 0) return `${years} año${years > 1 ? 's' : ''} ${months} mes${months !== 1 ? 'es' : ''}`;
  if (years > 0) return `${years} año${years > 1 ? 's' : ''}`;
  return `${months} mes${months !== 1 ? 'es' : ''}`;
}
