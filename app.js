/* ============================================================
   MisGatos — app.js
   Control Veterinario Personal
   ============================================================ */

// ──────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────
const SUPABASE_URL  = 'https://ryjmssfihczyooumwdxs.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_PlQBi5aOpgoLnfYXBN5--g_opxu-7yz';
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
      document.getElementById('user-email-display').textContent = session.user.email;
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

  // FAB solo en Mis Gatos
  const fab = document.getElementById('fab-add-cat');
  if (fab) fab.classList.toggle('hidden', section !== 'cats');

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
    sb.from('cats').select('*').eq('user_id', uid).order('name'),
    sb.from('veterinarians').select('*').eq('user_id', uid).order('name'),
    sb.from('appointments').select('*, cats(name, photo_url), veterinarians(name, clinic_name, address, phone)').order('appointment_date'),
    sb.from('consultations').select('*, cats(name), veterinarians(name, clinic_name)').order('visit_date', { ascending: false }),
    sb.from('vaccines').select('*, cats(name), veterinarians(name)').order('date_applied', { ascending: false }),
    sb.from('dewormings').select('*, cats(name), veterinarians(name)').order('date_applied', { ascending: false }),
    sb.from('documents').select('*, cats(name)').order('created_at', { ascending: false }),
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
async function loadDashboard() {
  const today = todayStr();
  const in30  = daysFromNow(30);
  const in7   = daysFromNow(7);

  // Welcome section
  const welcomeEl = document.getElementById('dash-welcome');
  if (welcomeEl) {
    const email = state.user?.email || '';
    const name  = email.split('@')[0];
    const dateStr = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    welcomeEl.innerHTML = `
      <div>
        <h1>Hola, ${name}.</h1>
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

  // Alert stat cards
  const statCats   = document.getElementById('stat-cats')?.closest('.stat-card');
  const statVacs   = document.getElementById('stat-vaccines-due')?.closest('.stat-card');
  const statDews   = document.getElementById('stat-deworm-due')?.closest('.stat-card');
  if (statVacs) statVacs.classList.toggle('stat-alert', vacsDue.length > 0);
  if (statDews) statDews.classList.toggle('stat-alert', dewsDue.length > 0);

  // Proximas citas — timeline
  const nearApts   = upcoming.filter(a => a.appointment_date <= in7).slice(0, 5);
  const upcomingEl = document.getElementById('upcoming-appointments');
  upcomingEl.innerHTML = nearApts.length
    ? `<div class="apt-timeline">${nearApts.map(a => {
        const diff  = daysDiff(today, a.appointment_date);
        const label = diff === 0 ? 'HOY' : diff === 1 ? 'Manana' : `En ${diff}d`;
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
  const filtered = _catStatusFilter === 'all'
    ? state.cats
    : state.cats.filter(c => getCatStatus(c.id).cls === _catStatusFilter);

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">Ningún gato con ese estado.</div>';
    return;
  }

  grid.innerHTML = filtered.map(c => {
    const age    = c.birthdate ? calcAge(c.birthdate) : '';
    const status = getCatStatus(c.id);
    const info   = [c.breed || 'Sin raza', c.gender, age].filter(Boolean).join(' · ');
    return `<div class="cat-card">
      <div class="cat-card-photo" onclick="showCatDetail('${c.id}')">
        ${c.photo_url
          ? `<img src="${c.photo_url}" alt="${c.name}" loading="lazy">`
          : '<div class="cat-no-photo"><i aria-hidden="true" class="fa-solid fa-cat"></i></div>'}
        <div class="cat-status-pill">
          <span class="status-dot status-${status.cls}"></span>${status.label}
        </div>
      </div>
      <div class="cat-card-body">
        <div class="cat-card-name-row">
          <div>
            <div class="cat-card-name">${c.name}</div>
            <div class="cat-card-info">${info}</div>
          </div>
          <div class="cat-card-icon-btns">
            <button class="cat-icon-btn" onclick="showCatDetail('${c.id}')" aria-label="Ver detalle de ${c.name}" title="Ver detalle">
              <i aria-hidden="true" class="fa-solid fa-eye"></i>
            </button>
            <button class="cat-icon-btn" onclick="showCatForm('${c.id}')" aria-label="Editar ${c.name}" title="Editar">
              <i aria-hidden="true" class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="cat-icon-btn cat-icon-btn-danger" onclick="confirmDelete('cat','${c.id}','${c.name}')" aria-label="Eliminar ${c.name}" title="Eliminar">
              <i aria-hidden="true" class="fa-solid fa-trash-can"></i>
            </button>
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
      <div id="cat-photo-preview" class="${cat?.photo_url ? '' : 'photo-placeholder'}">
        ${cat?.photo_url ? `<img class="photo-preview" src="${cat.photo_url}" id="cat-img-preview">` : '[sin foto]'}
      </div>
      <div class="field">
        <label for="cat-photo-file"><i aria-hidden="true" class="fa-solid fa-camera"></i> Foto del gato</label>
        <input type="file" id="cat-photo-file" accept="image/*" onchange="previewCatPhoto(this)">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-cat-name">Nombre *</label>
          <input type="text" id="f-cat-name" name="name" autocomplete="off" value="${cat?.name || ''}" required>
        </div>
        <div class="field">
          <label for="f-cat-breed">Raza</label>
          <input type="text" id="f-cat-breed" name="breed" autocomplete="off" value="${cat?.breed || ''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-cat-gender">Genero</label>
          <select id="f-cat-gender" name="gender">
            <option value="">-- Seleccionar --</option>
            <option value="macho" ${cat?.gender==='macho'?'selected':''}>Macho</option>
            <option value="hembra" ${cat?.gender==='hembra'?'selected':''}>Hembra</option>
          </select>
        </div>
        <div class="field">
          <label for="f-cat-birth">Fecha de nacimiento</label>
          <input type="date" id="f-cat-birth" name="birthdate" value="${cat?.birthdate || ''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-cat-color">Color</label>
          <input type="text" id="f-cat-color" name="color" autocomplete="off" value="${cat?.color || ''}">
        </div>
        <div class="field">
          <label for="f-cat-weight"><i aria-hidden="true" class="fa-solid fa-weight-scale"></i> Peso (kg)</label>
          <input type="number" id="f-cat-weight" name="weight" step="0.1" inputmode="decimal" autocomplete="off" value="${cat?.weight || ''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-cat-chip">Microchip</label>
          <input type="text" id="f-cat-chip" name="microchip" autocomplete="off" value="${cat?.microchip || ''}">
        </div>
        <div class="field">
          <label for="f-cat-blood">Tipo de sangre</label>
          <input type="text" id="f-cat-blood" name="blood_type" autocomplete="off" value="${cat?.blood_type || ''}">
        </div>
      </div>
      <div class="field">
        <label for="f-cat-allergies">Alergias</label>
        <input type="text" id="f-cat-allergies" name="allergies" autocomplete="off" value="${cat?.allergies || ''}" placeholder="Ej: Pollo, antibioticos&hellip;">
      </div>
      <div class="checkbox-field">
        <input type="checkbox" name="is_sterilized" id="cb-sterilized" ${cat?.is_sterilized ? 'checked' : ''}>
        <label for="cb-sterilized">Esta esterilizado/a</label>
      </div>
      <div class="field">
        <label for="f-cat-notes">Notas</label>
        <textarea id="f-cat-notes" name="notes">${cat?.notes || ''}</textarea>
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
    const ext  = photoFile.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('cat-photos').upload(path, photoFile, { upsert: true });
    if (!upErr) {
      const { data } = sb.storage.from('cat-photos').getPublicUrl(path);
      photoUrl = data.publicUrl;
    }
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
      <div class="vet-card-name">Dr(a). ${v.name}</div>
      <div class="vet-card-clinic">${v.clinic_name || 'Consultorio independiente'}</div>
      <div class="vet-card-info">
        ${v.phone ? `<i aria-hidden="true" class="fa-solid fa-phone"></i> ${v.phone}<br>` : ''}
        ${v.email ? `<i aria-hidden="true" class="fa-solid fa-envelope"></i> ${v.email}<br>` : ''}
        ${v.address ? `<i aria-hidden="true" class="fa-solid fa-location-dot"></i> ${v.address}${v.city ? ', ' + v.city : ''}<br>` : ''}
        ${v.schedule ? `<i aria-hidden="true" class="fa-solid fa-clock"></i> ${v.schedule}` : ''}
      </div>
      <div class="vet-card-actions">
        ${v.address ? `<a class="btn-waze" href="${wazeUrl(v.address)}" target="_blank" rel="noopener noreferrer"><i aria-hidden="true" class="fa-solid fa-route"></i> Waze</a>` : ''}
        <button class="btn-secondary" onclick="showVetForm('${v.id}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
        <button class="btn-danger" onclick="confirmDelete('vet','${v.id}','${v.name}')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
      </div>
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
      ? `<span class="badge badge-red">${diff === 0 ? 'HOY' : diff === 1 ? 'Manana' : 'En 2 dias'}</span>`
      : '';

    const vetName    = a.veterinarians?.clinic_name || a.veterinarians?.name || 'Sin veterinario';
    const vetAddress = a.veterinarians?.address;

    return `<div class="apt-item">
      <div class="apt-date-box">
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
      <div class="apt-actions">
        ${vetAddress ? `<a class="btn-waze" href="${wazeUrl(vetAddress)}" target="_blank" rel="noopener noreferrer"><i aria-hidden="true" class="fa-solid fa-route"></i> Waze</a>` : ''}
        <button class="btn-secondary" style="font-size:.8rem;padding:6px 12px" onclick="showAppointmentForm('${a.id}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
        ${a.status === 'pendiente' ? `<button class="btn-primary" style="font-size:.8rem;padding:6px 12px;background:var(--secondary)" onclick="completeAppointment('${a.id}')"><i aria-hidden="true" class="fa-solid fa-check"></i> Completar</button>` : ''}
        <button class="btn-danger" style="font-size:.8rem;padding:6px 12px" onclick="confirmDelete('appointment','${a.id}','cita')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
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
  container.innerHTML = list.map(c => `
    <div class="list-item">
      <div class="list-item-icon"><i aria-hidden="true" class="fa-solid fa-notes-medical"></i></div>
      <div class="list-item-body">
        <h4>${c.cats?.name} — ${formatDate(c.visit_date)}</h4>
        <p>${c.veterinarians?.name || 'Sin veterinario'} ${c.veterinarians?.clinic_name ? '· ' + c.veterinarians.clinic_name : ''}</p>
        ${c.reason ? `<p><strong>Motivo:</strong> ${c.reason}</p>` : ''}
        ${c.diagnosis ? `<p><strong>Diagnóstico:</strong> ${c.diagnosis}</p>` : ''}
        ${c.treatment ? `<p><strong>Tratamiento:</strong> ${c.treatment}</p>` : ''}
        ${c.weight_at_visit ? `<p>Peso: ${c.weight_at_visit} kg</p>` : ''}
        ${c.follow_up_date ? `<p>Seguimiento: ${formatDate(c.follow_up_date)}</p>` : ''}
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary" onclick="showConsultationForm('${c.id}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
        <button class="btn-danger" onclick="confirmDelete('consultation','${c.id}','consulta')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
      </div>
    </div>
  `).join('');
}

function showConsultationForm(consId = null) {
  const c = consId ? state.consultations.find(x => x.id === consId) : null;
  const catOptions = state.cats.map(x =>
    `<option value="${x.id}" ${c?.cat_id === x.id ? 'selected' : ''}>${x.name}</option>`).join('');
  const vetOptions = '<option value="">-- Sin asignar --</option>' + state.vets.map(v =>
    `<option value="${v.id}" ${c?.vet_id === v.id ? 'selected' : ''}>${v.name}</option>`).join('');

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
        <label>Diagnóstico</label>
        <textarea name="diagnosis">${c?.diagnosis || ''}</textarea>
      </div>
      <div class="field">
        <label>Tratamiento</label>
        <textarea name="treatment">${c?.treatment || ''}</textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label><i aria-hidden="true" class="fa-solid fa-weight-scale"></i> Peso (kg)</label>
          <input type="number" name="weight_at_visit" step="0.1" inputmode="decimal" autocomplete="off" value="${c?.weight_at_visit || ''}">
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
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

async function saveConsultation(e, consId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    cat_id:          fd.get('cat_id'),
    vet_id:          fd.get('vet_id') || null,
    visit_date:      fd.get('visit_date'),
    reason:          fd.get('reason') || null,
    diagnosis:       fd.get('diagnosis') || null,
    treatment:       fd.get('treatment') || null,
    weight_at_visit: fd.get('weight_at_visit') ? parseFloat(fd.get('weight_at_visit')) : null,
    temperature:     fd.get('temperature') ? parseFloat(fd.get('temperature')) : null,
    follow_up_date:  fd.get('follow_up_date') || null,
    notes:           fd.get('notes') || null,
  };
  let err;
  if (consId) {
    ({ error: err } = await sb.from('consultations').update(payload).eq('id', consId));
  } else {
    ({ error: err } = await sb.from('consultations').insert(payload));
  }
  if (err) return showToast('Error: ' + err.message, 'error');
  showToast('Consulta guardada', 'success');
  closeModalDirect();
  await loadAllData();
  renderConsultations();
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
    const dueAlert = v.next_due_date && v.next_due_date < today
      ? `<span class="due-alert">VENCIDA desde ${formatDate(v.next_due_date)}</span>`
      : v.next_due_date && v.next_due_date <= in30
      ? `<span class="due-soon">Refuerzo pronto: ${formatDate(v.next_due_date)}</span>`
      : v.next_due_date ? `<span class="text-muted">Próximo refuerzo: ${formatDate(v.next_due_date)}</span>` : '';

    return `<div class="list-item">
      <div class="list-item-icon"><i aria-hidden="true" class="fa-solid fa-syringe"></i></div>
      <div class="list-item-body">
        <h4>${v.vaccine_name} — ${v.cats?.name}</h4>
        <p>Aplicada: ${formatDate(v.date_applied)} — ${v.veterinarians?.name || '—'}</p>
        ${v.vaccine_brand ? `<p>Marca: ${v.vaccine_brand} ${v.batch_number ? '· Lote: ' + v.batch_number : ''}</p>` : ''}
        ${dueAlert}
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary" onclick="showVaccineForm('${v.id}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
        <button class="btn-danger" onclick="confirmDelete('vaccine','${v.id}','vacuna')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

function showVaccineForm(vacId = null) {
  const v = vacId ? state.vaccines.find(x => x.id === vacId) : null;
  const catOpts = state.cats.map(c => `<option value="${c.id}" ${v?.cat_id===c.id?'selected':''}>${c.name}</option>`).join('');
  const vetOpts = '<option value="">-- Sin asignar --</option>' + state.vets.map(x => `<option value="${x.id}" ${v?.vet_id===x.id?'selected':''}>${x.name}</option>`).join('');

  openModal(v ? 'Editar vacuna' : 'Registrar Vacuna', `
    <form onsubmit="saveVaccine(event,'${vacId || ''}')">
      <div class="field-row">
        <div class="field"><label>Gato *</label><select name="cat_id" required>${catOpts}</select></div>
        <div class="field"><label>Veterinario</label><select name="vet_id">${vetOpts}</select></div>
      </div>
      <div class="field"><label>Nombre de la vacuna *</label><input type="text" name="vaccine_name" value="${v?.vaccine_name||''}" required placeholder="Ej: Triple felina, Rabia..."></div>
      <div class="field-row">
        <div class="field"><label>Marca</label><input type="text" name="vaccine_brand" value="${v?.vaccine_brand||''}"></div>
        <div class="field"><label>Número de lote</label><input type="text" name="batch_number" value="${v?.batch_number||''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha aplicacion *</label><input type="date" name="date_applied" value="${v?.date_applied||todayStr()}" required></div>
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-plus"></i> Proximo refuerzo</label><input type="date" name="next_due_date" value="${v?.next_due_date||''}"></div>
      </div>
      <div class="field"><label>Notas</label><textarea name="notes">${v?.notes||''}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

async function saveVaccine(e, vacId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    cat_id:        fd.get('cat_id'),
    vet_id:        fd.get('vet_id') || null,
    vaccine_name:  fd.get('vaccine_name'),
    vaccine_brand: fd.get('vaccine_brand') || null,
    batch_number:  fd.get('batch_number') || null,
    date_applied:  fd.get('date_applied'),
    next_due_date: fd.get('next_due_date') || null,
    notes:         fd.get('notes') || null,
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
    const dueAlert = d.next_due_date && d.next_due_date < today
      ? `<span class="due-alert">VENCIDA desde ${formatDate(d.next_due_date)}</span>`
      : d.next_due_date && d.next_due_date <= in30
      ? `<span class="due-soon">Pronto: ${formatDate(d.next_due_date)}</span>`
      : d.next_due_date ? `<span class="text-muted">Próxima: ${formatDate(d.next_due_date)}</span>` : '';

    return `<div class="list-item">
      <div class="list-item-icon"><i aria-hidden="true" class="fa-solid fa-tablets"></i></div>
      <div class="list-item-body">
        <h4>${d.product_name} — ${d.cats?.name}</h4>
        <p>${formatDate(d.date_applied)} — ${typeLabel} ${d.dose ? '— Dosis: ' + d.dose : ''}</p>
        <p>${d.veterinarians?.name || '—'}</p>
        ${dueAlert}
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary" onclick="showDewormingForm('${d.id}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
        <button class="btn-danger" onclick="confirmDelete('deworming','${d.id}','desparasitacion')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

function showDewormingForm(dewId = null) {
  const d = dewId ? state.dewormings.find(x => x.id === dewId) : null;
  const catOpts = state.cats.map(c => `<option value="${c.id}" ${d?.cat_id===c.id?'selected':''}>${c.name}</option>`).join('');
  const vetOpts = '<option value="">-- Sin asignar --</option>' + state.vets.map(v => `<option value="${v.id}" ${d?.vet_id===v.id?'selected':''}>${v.name}</option>`).join('');

  openModal(d ? 'Editar desparasitación' : 'Registrar Desparasitación', `
    <form onsubmit="saveDeworming(event,'${dewId || ''}')">
      <div class="field-row">
        <div class="field"><label>Gato *</label><select name="cat_id" required>${catOpts}</select></div>
        <div class="field"><label>Veterinario</label><select name="vet_id">${vetOpts}</select></div>
      </div>
      <div class="field"><label>Producto *</label><input type="text" name="product_name" value="${d?.product_name||''}" required placeholder="Ej: Stronghold, Advocate..."></div>
      <div class="field-row">
        <div class="field">
          <label>Tipo</label>
          <select name="type">
            <option value="">-- Seleccionar --</option>
            <option value="interno"  ${d?.type==='interno' ?'selected':''}>Interno</option>
            <option value="externo"  ${d?.type==='externo' ?'selected':''}>Externo</option>
            <option value="ambos"    ${d?.type==='ambos'   ?'selected':''}>Interno+Externo</option>
          </select>
        </div>
        <div class="field"><label>Dosis</label><input type="text" name="dose" value="${d?.dose||''}" placeholder="Ej: 0.5 ml"></div>
      </div>
      <div class="field-row">
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha aplicacion *</label><input type="date" name="date_applied" value="${d?.date_applied||todayStr()}" required></div>
        <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-plus"></i> Proxima aplicacion</label><input type="date" name="next_due_date" value="${d?.next_due_date||''}"></div>
      </div>
      <div class="field"><label>Notas</label><textarea name="notes">${d?.notes||''}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="closeModalDirect()"><i aria-hidden="true" class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="submit" class="btn-primary"><i aria-hidden="true" class="fa-solid fa-floppy-disk"></i> Guardar</button>
      </div>
    </form>
  `);
}

async function saveDeworming(e, dewId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    cat_id:        fd.get('cat_id'),
    vet_id:        fd.get('vet_id') || null,
    product_name:  fd.get('product_name'),
    type:          fd.get('type') || null,
    dose:          fd.get('dose') || null,
    date_applied:  fd.get('date_applied'),
    next_due_date: fd.get('next_due_date') || null,
    notes:         fd.get('notes') || null,
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

  const typeIcon = { receta: '<i aria-hidden="true" class="fa-solid fa-file-prescription"></i>', analisis: '<i aria-hidden="true" class="fa-solid fa-flask"></i>', rayos_x: '<i aria-hidden="true" class="fa-solid fa-x-ray"></i>', otro: '<i aria-hidden="true" class="fa-solid fa-file"></i>' };
  const typeLabel = { receta: 'Receta', analisis: 'Análisis', rayos_x: 'Rayos X', otro: 'Otro' };

  grid.innerHTML = list.map(d => `
    <div class="doc-card">
      <div class="doc-card-type">${typeLabel[d.type] || 'DOC'}</div>
      <div class="doc-card-title">${d.title}</div>
      <div class="doc-card-meta">
        ${d.cats?.name}<br>
        ${typeLabel[d.type] || 'Documento'}<br>
        ${d.date_issued ? formatDate(d.date_issued) : formatDate(d.created_at?.split('T')[0])}
      </div>
      <div class="doc-card-actions">
        ${d.file_url ? `<a class="btn-primary" href="${d.file_url}" target="_blank" rel="noopener noreferrer" style="font-size:.8rem;padding:6px 12px">Ver</a>` : ''}
        <button class="btn-secondary" style="font-size:.8rem;padding:6px 10px" onclick="showDocumentForm('${d.id}')"><i aria-hidden="true" class="fa-solid fa-pen-to-square"></i> Editar</button>
        <button class="btn-danger" style="font-size:.8rem;padding:6px 10px" onclick="confirmDelete('document','${d.id}','documento')"><i aria-hidden="true" class="fa-solid fa-trash-can"></i> Eliminar</button>
      </div>
    </div>
  `).join('');
}

function showDocumentForm(docId = null) {
  const d = docId ? state.documents.find(x => x.id === docId) : null;
  const catOpts = state.cats.map(c => `<option value="${c.id}" ${d?.cat_id===c.id?'selected':''}>${c.name}</option>`).join('');

  openModal(d ? 'Editar documento' : 'Subir Documento', `
    <form onsubmit="saveDocument(event,'${docId || ''}')">
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
      <div class="field"><label>Título *</label><input type="text" name="title" value="${d?.title||''}" required placeholder="Ej: Receta antibiótico, Biometría..."></div>
      <div class="field"><label><i aria-hidden="true" class="fa-solid fa-calendar-days"></i> Fecha del documento</label><input type="date" name="date_issued" value="${d?.date_issued||todayStr()}"></div>
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
}

async function saveDocument(e, docId) {
  e.preventDefault();
  const fd  = new FormData(e.target);
  let fileUrl = docId ? state.documents.find(x => x.id === docId)?.file_url : null;
  let fileType = docId ? state.documents.find(x => x.id === docId)?.file_type : null;

  const file = document.getElementById('doc-file')?.files[0];
  if (file) {
    const ext  = file.name.split('.').pop();
    const path = `${state.user.id}/${Date.now()}.${ext}`;
    const { data: upData, error: upErr } = await sb.storage.from('medical-docs').upload(path, file, { upsert: true });
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
  } else {
    ({ error: err } = await sb.from('documents').insert(payload));
  }
  if (err) return showToast('Error: ' + err.message, 'error');
  showToast('Documento guardado', 'success');
  closeModalDirect();
  await loadAllData();
  renderDocuments();
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
// WAZE
// ──────────────────────────────────────────────
function wazeUrl(address) {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

// ──────────────────────────────────────────────
// MODAL
// ──────────────────────────────────────────────
let _modalTrigger = null;

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
  if (years > 0) return `${years} año${years > 1 ? 's' : ''}`;
  return `${months} mes${months !== 1 ? 'es' : ''}`;
}
