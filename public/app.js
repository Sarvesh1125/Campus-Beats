'use strict';
/* Campus Beats front end. Every action calls the Express API; nothing is stored in the browser. */
const $ = (s) => document.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag); let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  if (value !== undefined) e.value = value;
  return e;
};
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const slug = (s) => String(s).toLowerCase().replace(/\s+/g, '-');
const badge = (s) => h('span', { class: 'badge ' + slug(s) }, s);
const state = { user: null, view: null };
const CATS = ['Academic', 'Cultural', 'Sports', 'Social', 'Workshop', 'Seminar'];
const toLocal = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && state.user && !path.startsWith('/auth/')) { state.user = null; showAuth(); }
    throw new Error((data && data.error) || `Request failed (${r.status})`);
  }
  return data;
}
function toast(msg, type = 'info') {
  const t = h('div', { class: 'toast ' + type, role: type === 'error' ? 'alert' : 'status' }, msg);
  $('#toasts').append(t); setTimeout(() => t.remove(), 4500);
}
const guard = (fn) => async (e) => {
  const b = e && e.currentTarget; if (b) b.disabled = true;
  try { await fn(e); } catch (err) { toast(err.message, 'error'); } finally { if (b && b.isConnected) b.disabled = false; }
};
function modal(title, body, { wide } = {}) {
  const prev = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  const onKey = (e) => { if (e.key === 'Escape' && $('#modalRoot').lastChild === overlay) close(); };
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close dialog', onclick: close }, '✕')), body));
  $('#modalRoot').append(overlay); document.addEventListener('keydown', onKey);
  const f = overlay.querySelector('input,select,textarea'); if (f) f.focus(); else overlay.querySelector('.modal button')?.focus();
  return close;
}
function confirmDialog(message, label = 'Confirm') {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; close(); resolve(v); } };
    const close = modal('Please confirm', h('div', {}, h('p', {}, message),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn ghost', onclick: () => fin(false) }, 'Cancel'), h('button', { class: 'btn danger', onclick: () => fin(true) }, label))));
  });
}
const loading = () => h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' });
const empty = (msg) => h('div', { class: 'empty' }, msg);
const field = (label, input, hint) => { const id = 'f' + Math.random().toString(36).slice(2, 8); input.id = id; return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('span', { class: 'hint' }, hint)); };
const table = (heads, rows) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
const stat = (n, label) => h('div', { class: 'card stat' }, h('b', {}, n ?? '—'), h('span', {}, label));
const select = (opts, value, attrs) => h('select', { ...attrs, value }, opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v }, l); }));

// ---------------- Auth ----------------
function authPanel() {
  return h('div', { class: 'auth-panel' }, h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), 'Campus Beats'),
    h('h2', {}, 'Every campus event, one ticket away.'),
    h('div', { class: 'mini-ticket', 'aria-hidden': 'true' }, h('div', { class: 'stub' }, h('span', { class: 'mon' }, 'Oct'), h('span', { class: 'day' }, '24'), h('span', { class: 'wd' }, 'Sat')),
      h('div', { class: 'body' }, h('b', {}, 'Rhythm of Campus'), h('span', { class: 'meta' }, 'Main Auditorium, 5:00 pm'), h('span', { class: 'meta' }, 'Ticket TKT-8F2A91C0D3'))));
}
function showAuth() {
  $('#shell').hidden = true; const a = $('#auth'); a.hidden = false;
  let mode = 'login';
  const draw = () => {
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const f = (name, label, type = 'text', extra = {}) => field(label, h('input', { name, type, required: true, ...extra }));
    const role = select([['student', 'Student'], ['organizer', 'Organizer']], 'student', { name: 'role' });
    const orgField = field('Organization registration number', h('input', { name: 'organizationNumber' }));
    orgField.hidden = true; role.addEventListener('change', () => { orgField.hidden = role.value !== 'organizer'; });
    const form = h('form', { novalidate: true, onsubmit: guard(async (e) => {
      e.preventDefault(); err.hidden = true;
      const fd = Object.fromEntries(new FormData(form));
      try {
        const r = mode === 'login' ? await api('/auth/login', { method: 'POST', body: { email: fd.email, password: fd.password } }) : await api('/auth/register', { method: 'POST', body: fd });
        state.user = r.user; start();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    }) },
      err,
      mode === 'register' && f('name', 'Full name', 'text', { autocomplete: 'name' }),
      f('email', 'Email', 'email', { autocomplete: 'email' }),
      mode === 'register' && f('phone', 'Phone number', 'tel', { placeholder: '10–15 digits' }),
      f('password', 'Password', 'password', { autocomplete: mode === 'login' ? 'current-password' : 'new-password', minlength: 8 }),
      mode === 'register' && field('Role', role),
      mode === 'register' && orgField,
      mode === 'register' && field('Interests', h('input', { name: 'interests', placeholder: 'AI, music, sports' }), 'Comma separated'),
      h('button', { class: 'btn', type: 'submit', style: 'width:100%' }, mode === 'login' ? 'Log in' : 'Create account'));
    a.replaceChildren(h('div', { class: 'auth-wrap' }, authPanel(), h('div', { class: 'auth-card' }, h('h2', {}, mode === 'login' ? 'Welcome back' : 'Create your account'), h('p', { class: 'meta' }, mode === 'login' ? 'Log in to see your events and tickets.' : 'Students can register for events. Organizers need admin verification.'),
      h('div', { class: 'tabs', role: 'tablist' },
        ['login', 'register'].map((m) => h('button', { class: 'btn ' + (mode === m ? '' : 'ghost'), role: 'tab', 'aria-selected': mode === m, onclick: () => { mode = m; draw(); } }, m === 'login' ? 'Log in' : 'Register'))),
      form)));
  };
  draw();
}

// ---------------- Shell ----------------
const NAV = {
  student: [['discover', 'Discover events'], ['mine', 'My events'], ['notifications', 'Notifications'], ['suggestions', 'Suggestions'], ['profile', 'My profile']],
  organizer: [['dashboard', 'Dashboard'], ['create', 'Create event'], ['manage', 'Manage events'], ['checkin', 'Check-in'], ['reports', 'Reports'], ['notifications', 'Notifications'], ['suggestions', 'Suggestions'], ['profile', 'Profile']],
  admin: [['dashboard', 'Dashboard'], ['approvals', 'Event approvals'], ['events', 'All events'], ['users', 'Users'], ['organizers', 'Organizer verification'], ['venues', 'Venues'], ['reports', 'Reports'], ['notifications', 'Notifications'], ['suggestions', 'Suggestions']],
};
function start() {
  $('#auth').hidden = true; $('#shell').hidden = false;
  $('#whoName').textContent = state.user.name; $('#whoRole').textContent = state.user.role;
  $('#nav').replaceChildren(...NAV[state.user.role].map(([k, l]) => h('button', { 'data-view': k, onclick: () => go(k) }, l)));
  go(NAV[state.user.role][0][0]);
}
async function go(name) {
  if (name === 'create') { await go('manage'); return openEventForm(); }
  state.view = name; $('#sidebar').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('#nav button').forEach((b) => { b.dataset.view === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  const label = NAV[state.user.role].find((n) => n[0] === name)[1]; $('#viewTitle').textContent = label;
  const v = $('#view'); v.replaceChildren(loading());
  try { const node = await VIEWS[name](); if (state.view === name) { v.replaceChildren(node); v.focus(); } }
  catch (e) { v.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); }
  refreshBell();
}
const reload = () => go(state.view);
async function refreshBell() {
  try { const { unread } = await api('/notifications'); const c = $('#bellCount'); c.textContent = unread; c.hidden = !unread; } catch { /* ignore */ }
}

// ---------------- Event pieces ----------------
function eventCard(ev) {
  const my = ev.myRegistration; const d = new Date(ev.start);
  const pct = ev.capacity ? Math.min(100, Math.round((ev.seatsTaken / ev.capacity) * 100)) : 0;
  const left = ev.capacity - ev.seatsTaken;
  const seatText = left <= 0 ? (ev.waitlistCount ? `Full, ${ev.waitlistCount} on the waitlist` : 'Full') : `${left} of ${ev.capacity} seats left`;
  return h('article', { class: 'evt' },
    h('div', { class: 'stub', 'aria-hidden': 'true' }, h('span', { class: 'mon' }, d.toLocaleString('en-IN', { month: 'short' })), h('span', { class: 'day' }, d.getDate()), h('span', { class: 'wd' }, d.toLocaleString('en-IN', { weekday: 'short' }))),
    h('div', { class: 'body' },
      h('div', { class: 'row' }, h('span', { class: 'cat' }, ev.category), (ev.displayStatus || ev.status) !== 'Approved' && badge(ev.displayStatus || ev.status), my && badge(my.status)),
      h('h3', {}, ev.title),
      h('p', { class: 'meta' }, `${d.toLocaleTimeString('en-IN', { timeStyle: 'short' })} at ${ev.venue ? ev.venue.name : 'venue to be announced'}`),
      h('div', { class: 'seats' }, h('div', { class: 'bar', role: 'img', 'aria-label': `${ev.seatsTaken} of ${ev.capacity} seats taken` }, h('i', { style: `width:${pct}%` })),
        h('span', { class: 'meta' }, seatText + (ev.rating.avg ? `, rated ${ev.rating.avg}/5` : ''))),
      h('button', { class: 'btn small', onclick: () => openEvent(ev) }, 'View details')));
}
async function showTicket(eventId) {
  const { ticket } = await api(`/events/${eventId}/ticket`);
  modal('Your QR ticket', h('div', { class: 'ticket' }, h('h3', {}, ticket.event.title), h('p', { class: 'meta' }, fmt(ticket.event.start)),
    ticket.qr ? h('img', { src: ticket.qr, alt: 'QR code for ticket ' + ticket.ticketCode }) : h('p', {}, `Ticket is ${ticket.status} – no QR available.`),
    h('code', {}, ticket.ticketCode), badge(ticket.status), ticket.checkedInAt && h('p', { class: 'meta' }, 'Checked in ' + fmt(ticket.checkedInAt))));
}
function openEvent(ev) {
  const u = state.user; const body = h('div'); let close;
  const done = (m) => { close(); toast(m, 'success'); reload(); };
  body.append(h('div', { class: 'row' }, badge(ev.category), badge(ev.displayStatus || ev.status)),
    h('p', {}, ev.description),
    h('p', { class: 'meta' }, `📅 ${fmt(ev.start)} → ${fmt(ev.end)}`), h('p', { class: 'meta' }, `📍 ${ev.venue?.name || '—'}, ${ev.venue?.location || ''}`),
    h('p', { class: 'meta' }, `Organizer: ${ev.organizer?.name || '—'} · Seats ${ev.seatsTaken}/${ev.capacity} · Waitlist ${ev.waitlistCount}`),
    ev.rejectionReason && h('div', { class: 'err' }, 'Rejected: ' + ev.rejectionReason),
    u.role !== 'student' && h('p', { class: 'meta' }, `Budget ₹${(ev.budget || 0).toLocaleString('en-IN')}${ev.budgetNotes ? ' – ' + ev.budgetNotes : ''}`));
  const actions = h('div', { class: 'form-actions' }); body.append(actions);
  if (u.role === 'student') {
    const my = ev.myRegistration; const upcoming = new Date(ev.start) > new Date();
    const live = my && ['registered', 'waitlisted', 'checked-in', 'no-show'].includes(my.status);
    if (my) body.insertBefore(h('p', {}, 'Your registration: ', badge(my.status)), actions);
    if (live && my.status !== 'waitlisted') actions.append(h('button', { class: 'btn ghost', onclick: guard(() => showTicket(ev._id)) }, 'View QR ticket'));
    if (live && ['registered', 'waitlisted'].includes(my.status) && upcoming)
      actions.append(h('button', { class: 'btn danger', onclick: guard(async () => { if (await confirmDialog('Cancel your registration for this event?', 'Cancel registration')) { await api(`/events/${ev._id}/register`, { method: 'DELETE' }); done('Registration cancelled'); } }) }, 'Cancel registration'));
    if (!live && ev.status === 'Approved' && upcoming) {
      const full = ev.seatsTaken >= ev.capacity;
      actions.append(h('button', { class: 'btn', onclick: guard(async () => { const r = await api(`/events/${ev._id}/register`, { method: 'POST' }); done(r.registration.status === 'registered' ? 'Registered! Your QR ticket is ready.' : 'Event is full – you joined the waitlist.'); }) }, full ? 'Join waitlist' : 'Register'));
    }
    if (my && my.status === 'checked-in' && new Date(ev.end) < new Date()) body.append(feedbackForm(ev));
  } else {
    actions.append(h('button', { class: 'btn ghost', onclick: () => { close(); openAttendees(ev._id); } }, 'Attendees & check-in'));
    body.append(h('h2', { class: 'section' }, 'Feedback'), feedbackList(ev));
  }
  close = modal(ev.title, body, { wide: true });
}
function feedbackForm(ev) {
  const box = h('div', {}, h('h2', { class: 'section' }, 'Your feedback'));
  api(`/events/${ev._id}/feedback`).then(({ feedback }) => {
    const rating = select([5, 4, 3, 2, 1].map((n) => [n, '★'.repeat(n) + ` (${n})`]), feedback ? feedback.rating : 5);
    const comment = h('textarea', { maxlength: 1000, value: feedback ? feedback.comment : '' });
    box.append(field('Rating', rating), field('Comment (optional, max 1000 characters)', comment),
      h('div', { class: 'form-actions' },
        feedback && h('button', { class: 'btn danger', onclick: guard(async () => { if (await confirmDialog('Delete your feedback?', 'Delete')) { await api(`/events/${ev._id}/feedback`, { method: 'DELETE' }); toast('Feedback deleted', 'success'); reload(); } }) }, 'Delete'),
        h('button', { class: 'btn', onclick: guard(async () => { await api(`/events/${ev._id}/feedback`, { method: 'PUT', body: { rating: Number(rating.value), comment: comment.value } }); toast(feedback ? 'Feedback updated' : 'Thanks for your feedback!', 'success'); }) }, feedback ? 'Update feedback' : 'Submit feedback')));
  }).catch((e) => box.append(h('div', { class: 'err' }, e.message)));
  return box;
}
function feedbackList(ev) {
  const box = h('div', {}, loading());
  api(`/events/${ev._id}/feedback`).then((r) => {
    box.replaceChildren(r.count ? h('div', {}, h('p', {}, `Average ★ ${r.averageRating} from ${r.count} response(s)`), table(['Student', 'Rating', 'Comment'], r.feedback.map((f) => [f.student?.name || '—', '★'.repeat(f.rating), f.comment || '—']))) : empty('No feedback yet.'));
  }).catch((e) => box.replaceChildren(h('div', { class: 'err' }, e.message)));
  return box;
}
async function openAttendees(id) {
  const body = h('div', {}, loading()); modal('Attendees', body, { wide: true });
  const draw = async () => {
    const { event, attendees } = await api(`/events/${id}/attendees`);
    const code = h('input', { placeholder: 'TKT-XXXXXXXXXX', 'aria-label': 'Ticket code', autocomplete: 'off' });
    body.replaceChildren(h('h3', {}, event.title), h('div', { class: 'toolbar' }, field('Ticket code (type or scan)', code),
      h('button', { class: 'btn', onclick: guard(async () => { const r = await api(`/events/${id}/checkin`, { method: 'POST', body: { ticketCode: code.value } }); toast(`Checked in ${r.student?.name || 'attendee'}`, 'success'); await draw(); }) }, 'Check in')),
      attendees.length ? table(['Name', 'Email', 'Phone', 'Status', 'Ticket', 'Checked in'], attendees.map((a) => [a.student?.name, a.student?.email, a.student?.phone, badge(a.status), h('code', {}, a.ticketCode), fmt(a.checkedInAt)])) : empty('Nobody has registered yet.'));
  };
  try { await draw(); } catch (e) { body.replaceChildren(h('div', { class: 'err' }, e.message)); }
}

async function openEventForm(ev) {
  const { venues } = await api('/venues');
  if (!venues.length) return toast('No venues exist yet. Ask an admin to add one.', 'error');
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const f = {
    title: h('input', { value: ev?.title || '', maxlength: 200, required: true }),
    category: select(CATS, ev?.category || CATS[0]),
    venue: select(venues.map((v) => [v._id, `${v.name} (cap. ${v.capacity})`]), ev?.venue?._id || venues[0]._id),
    start: h('input', { type: 'datetime-local', value: ev ? toLocal(ev.start) : '' }),
    end: h('input', { type: 'datetime-local', value: ev ? toLocal(ev.end) : '' }),
    capacity: h('input', { type: 'number', min: 1, step: 1, value: ev?.capacity || '' }),
    budget: h('input', { type: 'number', min: 0, step: '0.01', value: ev?.budget ?? 0 }),
    budgetNotes: h('textarea', { value: ev?.budgetNotes || '' }),
    description: h('textarea', { value: ev?.description || '', style: 'min-height:120px' }),
  };
  const close = modal(ev ? 'Edit event' : 'Create event', h('form', { novalidate: true, onsubmit: guard(async (e) => {
    e.preventDefault(); err.hidden = true;
    const body = { title: f.title.value, category: f.category.value, venue: f.venue.value, capacity: Number(f.capacity.value), budget: f.budget.value === '' ? 0 : Number(f.budget.value), budgetNotes: f.budgetNotes.value, description: f.description.value,
      start: f.start.value ? new Date(f.start.value).toISOString() : '', end: f.end.value ? new Date(f.end.value).toISOString() : '' };
    try { await api(ev ? `/events/${ev._id}` : '/events', { method: ev ? 'PATCH' : 'POST', body }); close(); toast(ev ? 'Event updated and sent back for approval' : 'Event submitted for admin approval', 'success'); reload(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  }) }, err, field('Title', f.title), h('div', { class: 'toolbar' }, field('Category', f.category), field('Venue', f.venue)),
    h('div', { class: 'toolbar' }, field('Start', f.start), field('End', f.end)),
    h('div', { class: 'toolbar' }, field('Capacity', f.capacity), field('Budget (₹)', f.budget)),
    field('Budget breakdown', f.budgetNotes, 'Required when budget is above ₹10,000'),
    field('Description', f.description, 'Minimum 50 characters'),
    ev && h('p', { class: 'hint' }, 'Saving changes sends the event back to Pending for admin approval.'),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn', type: 'submit' }, ev ? 'Save changes' : 'Submit event'))), { wide: true });
}

// ---------------- Views ----------------
function eventTable(events, { admin } = {}) {
  if (!events.length) return empty('No events found.');
  return table(['Event', 'When', 'Venue', 'Status', 'Seats', 'Actions'], events.map((ev) => {
    const live = ['Pending', 'Approved', 'Rejected'].includes(ev.status);
    const terminal = ['Cancelled', 'Rejected', 'Completed', 'Archived'].includes(ev.status);
    const started = !terminal && new Date(ev.start) <= new Date();
    const ongoing = Boolean(ev.isOngoing) || (started && new Date(ev.end) > new Date());
    const locked = started;
    const deletable = Number(ev.registrationHistoryCount || 0) === 0 && !locked && !['Completed', 'Archived'].includes(ev.status);
    const st = (status, label, confirm, cls = 'ghost') => h('button', { class: `btn small ${cls}`, onclick: guard(async () => { if (!confirm || await confirmDialog(confirm, label)) { await api(`/events/${ev._id}/status`, { method: 'PATCH', body: { status } }); toast(`Event ${status.toLowerCase()}`, 'success'); reload(); } }) }, label);
    const remove = h('button', { class: 'btn small danger', disabled: !deletable, title: deletable ? 'Delete this empty event' : (locked ? 'Started events cannot be deleted' : 'Only events with no registration history can be deleted'), onclick: guard(async () => { if (deletable && await confirmDialog(`Permanently delete "${ev.title}"? This is only allowed because nobody has ever registered.`, 'Delete event')) { await api(`/events/${ev._id}`, { method: 'DELETE' }); toast('Empty event deleted', 'success'); reload(); } }) }, 'Delete');
    return [h('strong', {}, ev.title), fmt(ev.start), ev.venue?.name, badge(ev.displayStatus || ev.status),
      `${ev.counts ? ev.counts.registered + ev.counts.checkedIn + ev.counts.noShow : ev.seatsTaken}/${ev.capacity}` + (ev.counts?.waitlisted ? ` (+${ev.counts.waitlisted} wl)` : ''),
      h('div', { class: 'actions' }, h('button', { class: 'btn small ghost', onclick: () => openEvent(ev) }, 'Details'), h('button', { class: 'btn small ghost', onclick: () => openAttendees(ev._id) }, 'Attendees'),
        live && !locked && h('button', { class: 'btn small ghost', onclick: () => openEventForm(ev) }, 'Edit'),
        live && !locked && st('Cancelled', 'Cancel event', 'Cancel this event? All registered students will be notified.', 'danger'),
        locked && h('span', { class: 'hint' }, ongoing ? 'Live event locked' : 'Started event locked'),
        ev.status === 'Approved' && new Date(ev.end) < new Date() && st('Completed', 'Complete'),
        ['Cancelled', 'Completed'].includes(ev.status) && st('Archived', 'Archive', 'Archive this event? It stays in reports.'),
        remove)];
  }));
}

const VIEWS = {
  async discover() {
    const q = h('input', { type: 'search', placeholder: 'Search events…' }); const cat = select([['', 'All categories'], ...CATS.map((c) => [c, c])], '');
    const from = h('input', { type: 'date' }); const { venues } = await api('/venues'); const ven = select([['', 'All venues'], ...venues.map((v) => [v._id, v.name])], '');
    const list = h('div', { class: 'grid' });
    const load = async () => {
      list.replaceChildren(loading());
      const p = new URLSearchParams(); if (q.value) p.set('q', q.value); if (cat.value) p.set('category', cat.value); if (from.value) p.set('from', from.value); if (ven.value) p.set('venue', ven.value);
      try { const { events } = await api('/events?' + p); list.replaceChildren(...(events.length ? events.map(eventCard) : [empty('No events match your search.')])); } catch (e) { list.replaceChildren(h('div', { class: 'err' }, e.message)); }
    };
    let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); }); [cat, from, ven].forEach((x) => x.addEventListener('change', load));
    await load();
    return h('div', {}, h('div', { class: 'intro' }, h('h2', {}, 'Happening on campus'), h('p', { class: 'meta' }, 'Pick an event, grab a seat, and show your QR ticket at the door.')), h('div', { class: 'toolbar' }, field('Search', q), field('Category', cat), field('From date', from), field('Venue', ven)), list);
  },
  async mine() {
    const { events } = await api('/events?mine=1');
    return events.length ? h('div', { class: 'grid' }, events.map(eventCard)) : empty('You have not registered for any events yet. Head to Discover events!');
  },
  async dashboard() { return state.user.role === 'admin' ? adminDashboard() : organizerDashboard(); },
  async manage() {
    const { events } = await api('/events');
    return h('div', {}, h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => openEventForm() }, '＋ Create event'),
      !state.user.verified && h('span', { class: 'err' }, 'Your organizer account is not verified yet – an admin must verify you before you can create events.')), eventTable(events));
  },
  async checkin() {
    const { events } = await api('/events?status=Approved'); const now = Date.now();
    const open = events.filter((e) => now >= new Date(e.start) - 3600000 && now <= new Date(e.end));
    if (!events.length) return empty('You have no approved events.');
    const sel = select(events.map((e) => [e._id, `${e.title} – ${fmt(e.start)}`]), (open[0] || events[0])._id);
    const code = h('input', { placeholder: 'TKT-XXXXXXXXXX', autocomplete: 'off' }); const out = h('div', { 'aria-live': 'polite' });
    return h('div', { class: 'card', style: 'max-width:560px' }, h('p', { class: 'meta' }, 'Check-in opens 1 hour before the event starts and closes when it ends. Scanner guns that type the ticket code work too.'),
      field('Event', sel), field('Ticket code', code),
      h('button', { class: 'btn', onclick: guard(async () => {
        try { const r = await api(`/events/${sel.value}/checkin`, { method: 'POST', body: { ticketCode: code.value } }); out.replaceChildren(h('div', { class: 'toast success', style: 'max-width:none' }, `✔ Checked in ${r.student?.name || 'attendee'}`)); code.value = ''; code.focus(); }
        catch (e) { out.replaceChildren(h('div', { class: 'err', role: 'alert' }, e.message)); }
      }) }, 'Check in'), h('div', { style: 'margin-top:1rem' }, out),
      h('button', { class: 'btn ghost small', style: 'margin-top:1rem', onclick: () => openAttendees(sel.value) }, 'View attendee list'));
  },
  reports,
  async approvals() {
    const { events } = await api('/events?status=Pending');
    if (!events.length) return empty('🎉 No events are waiting for approval.');
    return h('div', { class: 'grid' }, events.map((ev) => h('article', { class: 'card event' }, h('div', { class: 'row' }, badge(ev.category), badge('Pending')), h('h3', {}, ev.title),
      h('div', { class: 'meta' }, `${fmt(ev.start)} · ${ev.venue?.name} · cap. ${ev.capacity}`), h('div', { class: 'meta' }, `Organizer: ${ev.organizer?.name}${ev.organizer?.verified ? '' : ' (NOT verified)'}`), h('div', { class: 'meta' }, `Budget ₹${ev.budget.toLocaleString('en-IN')}`), h('p', {}, ev.description),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: guard(async () => { await api(`/events/${ev._id}/status`, { method: 'PATCH', body: { status: 'Approved' } }); toast('Event approved', 'success'); reload(); }) }, 'Approve'),
        h('button', { class: 'btn small danger', onclick: () => {
          const reason = h('textarea', { maxlength: 500 });
          const c = modal('Reject event', h('div', {}, field('Reason (shown to the organizer)', reason), h('div', { class: 'form-actions' }, h('button', { class: 'btn danger', onclick: guard(async () => { await api(`/events/${ev._id}/status`, { method: 'PATCH', body: { status: 'Rejected', reason: reason.value } }); c(); toast('Event rejected', 'success'); reload(); }) }, 'Reject'))));
        } }, 'Reject'),
        h('button', { class: 'btn small ghost', onclick: () => openEvent(ev) }, 'Details')))));
  },
  async events() { const { events } = await api('/events'); return eventTable(events, { admin: true }); },
  users: () => usersView(''),
  organizers: () => usersView('organizer'),
  async venues() {
    const { venues } = await api('/venues?all=1');
    const form = (v) => {
      const f = { name: h('input', { value: v?.name || '' }), location: h('input', { value: v?.location || '' }), capacity: h('input', { type: 'number', min: 1, value: v?.capacity || '' }), amenities: h('input', { value: (v?.amenities || []).join(', ') }) };
      const err = h('div', { class: 'err', hidden: true, role: 'alert' });
      const c = modal(v ? 'Edit venue' : 'Add venue', h('form', { novalidate: true, onsubmit: guard(async (e) => {
        e.preventDefault(); err.hidden = true;
        try { await api(v ? `/venues/${v._id}` : '/venues', { method: v ? 'PATCH' : 'POST', body: { name: f.name.value, location: f.location.value, capacity: Number(f.capacity.value), amenities: f.amenities.value } }); c(); toast('Venue saved', 'success'); reload(); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; }
      }) }, err, field('Name', f.name), field('Location', f.location), field('Capacity', f.capacity), field('Amenities', f.amenities, 'Comma separated'), h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save'))));
    };
    return h('div', {}, h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => form() }, '＋ Add venue')),
      venues.length ? table(['Name', 'Location', 'Capacity', 'Amenities', 'Status', 'Actions'], venues.map((v) => [h('strong', {}, v.name), v.location, v.capacity, v.amenities.join(', ') || '—', badge(v.active ? 'Active' : 'Archived'),
        h('div', { class: 'actions' }, h('button', { class: 'btn small ghost', onclick: () => form(v) }, 'Edit'),
          v.active ? h('button', { class: 'btn small danger', onclick: guard(async () => { if (await confirmDialog(`Archive venue "${v.name}"?`, 'Archive')) { await api(`/venues/${v._id}`, { method: 'DELETE' }); toast('Venue archived', 'success'); reload(); } }) }, 'Archive')
            : h('button', { class: 'btn small ghost', onclick: guard(async () => { await api(`/venues/${v._id}`, { method: 'PATCH', body: { active: true } }); reload(); }) }, 'Restore'))])) : empty('No venues yet.'));
  },
  async notifications() {
    const { notifications } = await api('/notifications');
    if (!notifications.length) return empty('You have no notifications.');
    return h('div', {}, notifications.map((n) => h('div', { class: 'card notif' + (n.read ? '' : ' unread') }, h('div', {}, h('div', {}, n.message), h('div', { class: 'meta' }, fmt(n.createdAt))),
      h('div', { class: 'actions' }, !n.read && h('button', { class: 'btn small ghost', onclick: guard(async () => { await api(`/notifications/${n._id}`, { method: 'PATCH', body: { read: true } }); reload(); }) }, 'Mark read'),
        h('button', { class: 'btn small ghost', 'aria-label': 'Delete notification', onclick: guard(async () => { await api(`/notifications/${n._id}`, { method: 'DELETE' }); reload(); }) }, 'Delete')))));
  },
  async suggestions() {
    const { suggestions } = await api('/suggestions'); const text = h('textarea', { maxlength: 2000, placeholder: 'Suggest a feature or report a bug…' }); const admin = state.user.role === 'admin';
    return h('div', {}, h('div', { class: 'card', style: 'max-width:640px;margin-bottom:1.5rem' }, field('New suggestion or bug report', text),
      h('button', { class: 'btn', onclick: guard(async () => { await api('/suggestions', { method: 'POST', body: { text: text.value } }); toast('Thank you! Suggestion submitted.', 'success'); reload(); }) }, 'Submit')),
      suggestions.length ? table(admin ? ['From', 'Suggestion', 'Date', 'Status'] : ['Suggestion', 'Date', 'Status'], suggestions.map((s) => {
        const st = admin ? select(['Submitted', 'In progress', 'Implemented'], s.status, { 'aria-label': 'Status', onchange: guard(async (e) => { await api(`/suggestions/${s._id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Status updated', 'success'); }) }) : badge(s.status);
        return admin ? [`${s.user?.name || '—'} (${s.user?.role || ''})`, s.text, fmt(s.createdAt), st] : [s.text, fmt(s.createdAt), st];
      })) : empty('No suggestions yet.'));
  },
  async profile() {
    const u = state.user; const err = h('div', { class: 'err', hidden: true, role: 'alert' });
    const f = { name: h('input', { value: u.name }), phone: h('input', { value: u.phone }), interests: h('input', { value: (u.interests || []).join(', ') }), org: h('input', { value: u.organizationNumber || '' }), cur: h('input', { type: 'password' }), np: h('input', { type: 'password', minlength: 8 }) };
    return h('form', { class: 'card', style: 'max-width:600px', novalidate: true, onsubmit: guard(async (e) => {
      e.preventDefault(); err.hidden = true; const body = { name: f.name.value, phone: f.phone.value, interests: f.interests.value };
      if (u.role === 'organizer') body.organizationNumber = f.org.value; if (f.np.value) { body.newPassword = f.np.value; body.currentPassword = f.cur.value; }
      try { state.user = (await api('/profile', { method: 'PATCH', body })).user; $('#whoName').textContent = state.user.name; toast('Profile updated', 'success'); reload(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    }) }, err, h('p', {}, h('strong', {}, u.email), ' · ', badge(u.role), u.role === 'organizer' && badge(u.verified ? 'Verified' : 'Pending verification')),
      field('Full name', f.name), field('Phone', f.phone), field('Interests', f.interests, 'Comma separated'), u.role === 'organizer' && field('Organization registration number', f.org, 'Changing this requires re-verification'),
      field('Current password', f.cur, 'Only needed to change your password'), field('New password', f.np),
      h('div', { class: 'form-actions' }, u.role !== 'admin' && h('button', { type: 'button', class: 'btn danger', onclick: guard(async () => { if (await confirmDialog('Deactivate your account? You will be logged out and cannot log in again.', 'Deactivate')) { await api('/profile', { method: 'DELETE' }); state.user = null; showAuth(); toast('Account deactivated'); } }) }, 'Deactivate account'), h('button', { class: 'btn', type: 'submit' }, 'Save changes')));
  },
};

async function usersView(role) {
  const { users } = await api('/users' + (role ? '?role=' + role : ''));
  const flip = (u, body, msg) => guard(async () => { await api(`/users/${u._id}`, { method: 'PATCH', body }); toast(msg, 'success'); reload(); });
  return users.length ? table(['Name', 'Email', 'Role', role ? 'Org. number' : 'Phone', 'Status', 'Actions'], users.map((u) => [h('strong', {}, u.name), u.email, badge(u.role), role ? u.organizationNumber || '—' : u.phone,
    h('div', { class: 'row' }, badge(u.active ? 'Active' : 'Deactivated'), u.role === 'organizer' && badge(u.verified ? 'Verified' : 'Unverified')),
    h('div', { class: 'actions' }, u.role === 'organizer' && h('button', { class: 'btn small', onclick: flip(u, { verified: !u.verified }, u.verified ? 'Verification revoked' : 'Organizer verified') }, u.verified ? 'Revoke' : 'Verify'),
      u.role !== 'admin' && h('button', { class: 'btn small ' + (u.active ? 'danger' : 'ghost'), onclick: guard(async () => { if (!u.active || await confirmDialog(`Deactivate ${u.name}?`, 'Deactivate')) { await api(`/users/${u._id}`, { method: 'PATCH', body: { active: !u.active } }); toast('User updated', 'success'); reload(); } }) }, u.active ? 'Deactivate' : 'Reactivate'))])) : empty('No users found.');
}

const summaryCards = (s) => h('div', { class: 'stats' }, stat(s.totalRegistrations, 'Confirmed registrations'), stat(s.attendanceCount, 'Checked in'), stat(s.attendanceRate + '%', 'Attendance rate'), stat(s.noShowCount, 'No-shows'), stat(s.waitlistCount, 'On waitlists'), stat(s.cancellationCount, 'Cancellations'), stat(s.averageRating ?? '–', `Avg rating (${s.feedbackCount})`));
async function adminDashboard() {
  const r = await api('/reports'); const e = r.events;
  return h('div', {}, h('div', { class: 'stats' }, stat(e.total, 'Total events'), stat(e.approved, 'Approved'), stat(e.pending, 'Pending approval'), stat(e.cancelled, 'Cancelled'), stat(e.completed, 'Completed')), summaryCards(r.summary),
    e.pending ? h('p', {}, h('button', { class: 'btn', onclick: () => go('approvals') }, `Review ${e.pending} pending event(s)`)) : null);
}
async function organizerDashboard() {
  const [r, { events }] = await Promise.all([api('/reports'), api('/events')]);
  const up = events.filter((e) => new Date(e.end) > new Date() && ['Pending', 'Approved'].includes(e.status));
  return h('div', {}, !state.user.verified && h('div', { class: 'err' }, 'Your organizer account is awaiting admin verification. You can create events once verified.'), summaryCards(r.summary),
    h('h2', { class: 'section' }, 'Upcoming events'), up.length ? h('div', { class: 'grid' }, up.map(eventCard)) : empty('No upcoming events. Create one from the menu!'));
}
async function reports() {
  const r = await api('/reports'); const admin = r.role === 'admin';
  const exp = h('button', { class: 'btn', onclick: guard(async () => {
    const res = await fetch('/api/reports?format=csv', { credentials: 'same-origin' }); if (!res.ok) throw new Error('Export failed');
    const url = URL.createObjectURL(await res.blob()); const a = h('a', { href: url, download: 'campus-report.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }) }, '⬇ Export CSV');
  return h('div', {}, h('div', { class: 'toolbar' }, exp, h('span', { class: 'meta' }, 'Generated ' + fmt(r.generatedAt) + ' using MongoDB aggregation pipelines')), summaryCards(r.summary),
    admin && h('div', {}, h('h2', { class: 'section' }, 'Events by category'), r.byCategory.length ? table(['Category', 'Events', 'Total capacity'], r.byCategory.map((c) => [c.category, c.events, c.capacity])) : empty('No data'),
      h('h2', { class: 'section' }, 'Venue usage'), r.venueUsage.length ? table(['Venue', 'Capacity', 'Events', 'Hours booked'], r.venueUsage.map((v) => [v.venue, v.capacity, v.events, v.hoursBooked])) : empty('No data'),
      h('h2', { class: 'section' }, 'Organizer activity'), r.organizers.length ? table(['Organizer', 'Events created', 'Approved/completed'], r.organizers.map((o) => [o.organizer, o.events, o.approved])) : empty('No data')),
    h('h2', { class: 'section' }, 'Event-wise report'),
    r.eventWise.length ? table(['Event', 'Status', 'Registered', 'Checked-in', 'Waitlisted', 'Cancelled', 'No-show', 'Avg rating'], r.eventWise.map((e) => [h('strong', {}, e.title), badge(e.status), e.registered, e.checkedIn, e.waitlisted, e.cancelled, e.noShow, e.avgRating ? `★ ${e.avgRating} (${e.feedbackCount})` : '—'])) : empty('No events to report on yet.'));
}

// ---------------- Boot ----------------
$('#logoutBtn').addEventListener('click', guard(async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; showAuth(); }));
$('#bellBtn').addEventListener('click', () => go('notifications'));
$('#menuBtn').addEventListener('click', () => { const o = $('#sidebar').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(o)); });
(async () => { try { state.user = (await api('/auth/me')).user; start(); } catch { showAuth(); } })();
