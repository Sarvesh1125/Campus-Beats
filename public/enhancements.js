'use strict';
let scanner = null;
function stopScanner() { if (scanner) { scanner.destroy(); scanner = null; } }
addEventListener('pagehide', stopScanner);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopScanner(); });
setInterval(() => { if (state.user && !document.hidden) refreshBell(); }, 20000);
for (const role of Object.keys(NAV)) NAV[role].splice(1, 0, ['calendar', 'Calendar']);
NAV.admin.splice(4, 0, ['checkin','Scan QR'], ['availability','Venue availability']);
NAV.admin.push(['audit','Audit log'], ['health','System health'], ['profile','My profile']);
NAV.organizer.splice(4, 0, ['availability','Venue availability']);

function showPasswordPage(token) {
  stopScanner(); $('#shell').hidden = true; $('#auth').hidden = false;
  const msg = h('div', { role: 'status' });
  const input = h('input', { type: token ? 'password' : 'email', required: true, minlength: token ? 8 : undefined, autocomplete: token ? 'new-password' : 'email' });
  const confirm = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
  const form = h('form', { onsubmit: guard(async e => {
    e.preventDefault();
    try {
      if (token && input.value !== confirm.value) throw new Error('Passwords do not match');
      const r = await api(token ? '/auth/reset-password' : '/auth/forgot-password', { method: 'POST', body: token ? { token, password: input.value } : { email: input.value } });
      if (token) { history.replaceState(null, '', '/'); state.user = null; showAuth(); toast('Password changed. Please log in.', 'success'); }
      else msg.replaceChildren(h('p', { class: 'notice' }, r.message));
    } catch (e) { msg.replaceChildren(h('p', { class: 'err' }, e.message), token && h('button', { class: 'btn ghost', type: 'button', onclick: () => showPasswordPage() }, 'Request a new link')); }
  }) }, msg, field(token ? 'New password' : 'Account email', input), token && field('Confirm password', confirm), h('button', { class: 'btn', type: 'submit' }, token ? 'Reset password' : 'Request reset link'));
  $('#auth').replaceChildren(h('div', { class: 'auth-wrap' }, authPanel(), h('div', { class: 'auth-card' }, h('h2', {}, token ? 'Set a new password' : 'Forgot your password?'), h('p', { class: 'meta' }, 'Secure account recovery · Campus Connect'), form, h('button', { class: 'btn ghost', onclick: () => { history.replaceState(null,'','/'); showAuth(); } }, 'Back to login'))));
}
function pager(total, current, load, limit = 20) {
  return h('div', { class: 'pager' }, h('button', { class: 'btn ghost small', disabled: current <= 1, onclick: guard(() => load(current - 1)) }, 'Previous'), h('span', {}, `Page ${current} of ${Math.max(1, Math.ceil(total / limit))} · ${total} records`), h('button', { class: 'btn ghost small', disabled: current * limit >= total, onclick: guard(() => load(current + 1)) }, 'Next'));
}
async function allPages(path, key) {
  const items = []; let p = 1; let r;
  do { r = await api(path + (path.includes('?') ? '&' : '?') + `page=${p++}&limit=100`); items.push(...r[key]); } while (items.length < r.total);
  return items;
}
async function eventDetails(id) { openEvent((await api(`/events/${id}/details`)).event); }
async function reassignEvent(ev) {
  const users = (await allPages('/users?role=organizer', 'users')).filter(u => u.active && u.verified);
  if (!users.length) throw new Error('Create or verify an Organizer first');
  const sel = select(users.map(u => [u._id, `${u.name} · ${u.organizationNumber}`]), users[0]._id);
  const reason = h('textarea', { required: true });
  const close = modal('Reassign ' + ev.title, h('form', { onsubmit: guard(async e => { e.preventDefault(); await api(`/events/${ev._id}/reassign`, { method: 'PATCH', body: { organizer: sel.value, reason: reason.value } }); close(); toast('Event reassigned', 'success'); reload(); }) }, field('New managing Organizer', sel), field('Reason', reason), h('p', { class: 'hint' }, 'Original creator, registrations and tickets are preserved.'), h('button', { class: 'btn', type: 'submit' }, 'Reassign event')));
}
async function userEditor(u) {
  const fields = { name: h('input', { required: true, value: u?.name || '' }), email: h('input', { type: 'email', required: true, value: u?.email || '', readonly: !!u }), phone: h('input', { required: true, value: u?.phone || '' }), role: select(['student','organizer','admin'], u?.role || 'student'), active: select([['true','Active'],['false','Deactivated']], String(u?.active ?? true)), verified: select([['false','Unverified'],['true','Verified']], String(u?.verified ?? false)), reason: h('textarea', { required: true }), currentPassword: h('input', { type: 'password', autocomplete: 'current-password' }) };
  const impact = u ? (await api(`/users/${u._id}/impact`)).events : [];
  const err = h('p', { class: 'err', hidden: true });
  const close = modal(u ? 'Manage account · ' + u.name : 'Create user', h('form', { onsubmit: guard(async e => {
    e.preventDefault(); err.hidden = true;
    const b = Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,v.value])); b.active = b.active === 'true';
    if (b.role === 'organizer') b.verified = b.verified === 'true'; else delete b.verified;
    try {
      if (b.role === 'admin' && u?.role !== 'admin' && !await confirmDialog('Grant this account full administrative access?', 'Grant Admin')) return;
      const r = await api(u ? `/users/${u._id}` : '/users', { method: u ? 'PATCH' : 'POST', body: b }); close(); toast(r.message || 'Account updated', r.delivery === false ? 'error' : 'success'); reload();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  }) }, err, ...['name','email','phone','role','active','verified'].map(k => field(k[0].toUpperCase()+k.slice(1), fields[k])), field('Reason for change', fields.reason), field('Your current password', fields.currentPassword, 'Required when granting Admin access'),
  h('div', { class: 'notice' }, 'Deactivation blocks all access. Unverified Organizers retain their profile and notifications. Their events and student tickets remain intact.'),
  impact.length ? h('div', {}, h('h3', {}, 'Affected upcoming / ongoing events'), impact.map(e => h('p', {}, `${e.title} · ${fmt(e.start)} · ${e.status}`))) : h('p', { class: 'hint' }, 'No upcoming or ongoing events affected.'),
  h('button', { class: 'btn', type: 'submit' }, u ? 'Save changes' : 'Create account & password setup')), { wide: true });
}
usersView = async function(role) {
  const box = h('div'); const list = h('div'); const q = h('input', { type: 'search', placeholder: 'Name, email or Organizer number' }); const filter = select([['','All roles'],['student','Student'],['organizer','Organizer'],['admin','Admin']], role);
  async function load(p = 1) { const r = await api(`/users?role=${filter.value}&q=${encodeURIComponent(q.value)}&page=${p}`); list.replaceChildren(r.users.length ? table(['Name','Email','Role / Organizer no.','Status','Created','Actions'], r.users.map(u => [u.name,u.email,h('div',{},badge(u.role),h('p', {class:'meta'},u.organizationNumber || '')), h('div',{},badge(u.active?'Active':'Deactivated'),u.role==='organizer'&&badge(u.verified?'Verified':'Unverified')),fmt(u.createdAt), h('div',{class:'actions'},h('button',{class:'btn small',onclick:guard(()=>userEditor(u))},'Manage'),h('button',{class:'btn small ghost',onclick:guard(async()=>{if(await confirmDialog(`Issue a password setup link for ${u.name}?`)){await api(`/users/${u._id}/password-setup`,{method:'POST'});toast('Password setup sent through configured delivery');}})},'Password setup'))])) : empty('No users found'),pager(r.total,p,load)); }
  box.append(h('div',{class:'toolbar'},field('Search users',q),field('Role',filter),h('button',{class:'btn',onclick:guard(()=>userEditor())},'＋ Create user')),list);
  let t; q.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>load().catch(e=>toast(e.message,'error')),300);});filter.addEventListener('change',guard(()=>load()));await load();return box;
};
async function checkAvailability(venue, start, end, exclude) {
  if (!start || !end) throw new Error('Choose both start and end times');
  const p = new URLSearchParams({ start: new Date(start+'+05:30').toISOString(), end: new Date(end+'+05:30').toISOString() }); if(exclude)p.set('exclude',exclude);
  const r = await api(`/venues/${venue}/availability?${p}`);
  const body = h('div',{},badge(r.available?'Available':'Occupied'),h('p',{},`${r.venue.name} · ${r.venue.location} · Capacity ${r.venue.capacity}`),h('p',{class:'meta'},r.venue.amenities.join(', ')),r.conflicts.length?table(['Event','Start (IST)','End (IST)'],r.conflicts.map(c=>[c._id?h('button',{class:'btn ghost small',onclick:guard(()=>eventDetails(c._id))},c.title):c.title,fmt(c.start),fmt(c.end)])):h('p',{},'No conflicting reservations in this interval. Availability is checked again when saving.'));
  modal('Venue availability',body,{wide:true});return r;
}
VIEWS.availability = async () => {
  const { venues } = await api('/venues'); if(!venues.length)return empty('Add a venue first');
  const venue = select(venues.map(v=>[v._id,v.name]),venues[0]._id), start = h('input',{type:'datetime-local'}), end = h('input',{type:'datetime-local'}), day = h('input',{type:'date',value:toLocal(new Date()).slice(0,10)});
  return h('div',{class:'card'},h('h2',{},'Plan a conflict-free event'),h('p',{class:'meta'},'Pending and approved events reserve a venue. Back-to-back bookings are allowed.'),field('Venue',venue),h('div',{class:'toolbar'},field('Start (IST)',start),field('End (IST)',end)),h('button',{class:'btn',onclick:guard(()=>checkAvailability(venue.value,start.value,end.value))},'Check availability'),h('hr'),field('Daily schedule date',day),h('button',{class:'btn ghost',onclick:guard(()=>checkAvailability(venue.value,day.value+'T00:00',toLocal(new Date(new Date(day.value+'T00:00+05:30').getTime()+86400000))))},'View daily reservations'));
};
VIEWS.checkin = async () => {
  const events = await allPages('/events?status=Approved','events');if(!events.length)return empty('No approved events available for check-in');
  const open=events.find(e=>Date.now()>=new Date(e.start)-3600000&&Date.now()<new Date(e.end));
  const sel=select(events.map(e=>[e._id,`${e.title} · ${fmt(e.start)}`]),(open||events[0])._id);
  const code=h('input',{placeholder:'TKT-XXXXXXXXXX',autocomplete:'off'}), video=h('video',{playsinline:true,muted:true,class:'camera'}), cameras=select([['environment','Rear / default camera']],'environment'), out=h('div',{'aria-live':'polite'}), count=h('p',{class:'meta'});
  let busy=false,last='',lastAt=0; const updateCount=async()=>{const r=await api(`/events/${sel.value}/details`);count.textContent=`Checked in: ${r.event.counts.checkedIn} · Confirmed seats: ${r.event.seatsTaken}/${r.event.capacity}`;};
  const submit=async text=>{if(busy||(last===text&&Date.now()-lastAt<4000))return;busy=true;last=text;lastAt=Date.now();try{const r=await api(`/events/${sel.value}/checkin`,{method:'POST',body:{ticketCode:text}});out.replaceChildren(h('div',{class:'notice success'},`✓ ${r.student?.name||'Student'} checked in · ${sel.selectedOptions[0].textContent} · ${fmt(r.checkedInAt)}`));code.value='';await updateCount();}catch(e){out.replaceChildren(h('div',{class:'err'},e.message));}finally{busy=false;}};
  const Qr=()=>import('/vendor/qr-scanner/qr-scanner.min.js').then(m=>m.default);
  const start=async()=>{if(!window.isSecureContext)throw new Error('Camera needs localhost or HTTPS. Use image upload or manual entry on an HTTP LAN address.');stopScanner();const QR=await Qr();scanner=new QR(video,r=>submit(r.data),{preferredCamera:cameras.value,maxScansPerSecond:3,returnDetailedScanResult:true});try{await scanner.start();const options=await QR.listCameras(true);cameras.replaceChildren(h('option',{value:'environment'},'Rear / default camera'),...options.map(c=>h('option',{value:c.id},c.label)));}catch(e){stopScanner();throw new Error('Camera unavailable. Allow camera permission, connect a camera, or use image upload/manual entry. '+(e.message||e));}};
  const upload=h('input',{type:'file',accept:'image/*',onchange:guard(async e=>{const file=e.target.files[0];if(!file)return;stopScanner();const QR=await Qr();const r=await QR.scanImage(file,{returnDetailedScanResult:true});await submit(r.data);e.target.value='';})});
  cameras.addEventListener('change',guard(async()=>{if(scanner)await scanner.setCamera(cameras.value);}));sel.addEventListener('change',guard(async()=>{last='';await updateCount();}));await updateCount();
  return h('div',{class:'scanner-layout'},h('div',{class:'card'},h('h2',{},'Scan student tickets'),field('Event',sel),count,h('p',{class:'meta'},'Check-in opens one hour before start and closes at the event end.'),video,field('Camera',cameras),h('div',{class:'toolbar'},h('button',{class:'btn',onclick:guard(start)},'Start Camera'),h('button',{class:'btn ghost',onclick:stopScanner},'Stop Camera')),out),h('div',{class:'card'},h('h3',{},'Other check-in options'),field('Upload QR image',upload),h('form',{onsubmit:guard(async e=>{e.preventDefault();await submit(code.value);})},field('Ticket code',code),h('button',{class:'btn',type:'submit'},'Check in')),h('button',{class:'btn ghost',onclick:guard(()=>openAttendees(sel.value))},'View attendees')));
};
VIEWS.calendar = async () => {
  const today=toLocal(new Date()).slice(0,10);let anchor=new Date(today+'T00:00:00Z');const mode=select([['month','Month'],['week','Week'],['agenda','Agenda']],matchMedia('(max-width:600px)').matches?'agenda':'month'), category=select([['','All categories'],...CATS],''), status=select([['','All statuses'],'Pending','Approved','Rejected','Completed','Cancelled','Archived'],''), scope=select([['','All visible events'],['mine','My events'],['others','Other Organizers']],'');const history=h('input',{type:'checkbox'});const title=h('h2'), grid=h('div');
  const iso=d=>d.toISOString().slice(0,10); const shift=(d,n)=>new Date(d.getTime()+n*86400000);
  async function load(){grid.replaceChildren(loading());let first,last;
    if(mode.value==='week'){first=shift(anchor,-((anchor.getUTCDay()+6)%7));last=shift(first,7);}else{first=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),1));last=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,1));if(mode.value==='month'){first=shift(first,-((first.getUTCDay()+6)%7));last=shift(first,42);}}
    title.textContent=mode.value==='week'?`${iso(first)} – ${iso(shift(last,-1))}`:anchor.toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'});
    const p=new URLSearchParams({start:iso(first)+'T00:00:00+05:30',end:iso(last)+'T00:00:00+05:30',category:category.value,status:status.value,scope:scope.value,history:history.checked?'1':'0'});const {events}=await api('/calendar?'+p);
    const button=e=>h('button',{class:'calendar-event '+(e.canManage?'owned':'public-event')+' '+slug(e.myRegistration?.status||e.status),onclick:()=>openEvent(e)},h('b',{},e.title),h('span',{},`${toLocal(e.start).slice(11)} · ${e.venue?.name||''}`),h('span',{},e.myRegistration?.status||(e.canManage?'My event · ':'')+e.status));
    if(mode.value==='agenda'){grid.className='agenda';grid.replaceChildren(...(events.length?events.map(e=>h('div',{class:'card'},h('p',{class:'meta'},`${fmt(e.start)} → ${fmt(e.end)}`),button(e))):[empty('No events in this period.')]));return;}
    grid.className='calendar-grid';const cells=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>h('div',{class:'calendar-heading'},x));
    for(let day=first;day<last;day=shift(day,1)){const key=iso(day),beg=new Date(key+'T00:00:00+05:30'),end=new Date(beg.getTime()+86400000);cells.push(h('div',{class:'calendar-day'+(key===today?' today':'')},h('span',{class:'day-label'},key.slice(8)),events.filter(e=>new Date(e.start)<end&&new Date(e.end)>beg).map(button)));}grid.replaceChildren(...cells);
  }
  const move=n=>{if(mode.value==='week')anchor=shift(anchor,7*n);else anchor=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+n,1));return load();};
  for(const el of [mode,category,status,scope,history])el.addEventListener('change',guard(load));
  const root=h('div',{},h('div',{class:'calendar-toolbar'},title,h('div',{class:'actions'},h('button',{class:'btn ghost',onclick:guard(()=>move(-1))},'Previous'),h('button',{class:'btn ghost',onclick:guard(()=>{anchor=new Date(today+'T00:00Z');return load();})},'Today'),h('button',{class:'btn ghost',onclick:guard(()=>move(1))},'Next'))),h('div',{class:'toolbar'},field('View',mode),field('Category',category),field('Status',status),state.user.role==='organizer'&&field('Ownership',scope),field(state.user.role==='student'?'Include cancelled registrations':'Include archived history',history)),h('p',{class:'meta'},'All times in Asia/Kolkata (IST). Click an event to view details. Waitlisted entries do not guarantee a seat.'),h('div',{class:'calendar-scroll'},grid));await load();return root;
};
VIEWS.notifications=async()=>{const root=h('div'),list=h('div');async function load(p=1){const r=await api('/notifications?page='+p);list.replaceChildren(...r.notifications.map(n=>h('div',{class:'card notif'+(n.read?'':' unread')},h('div',{},h('p',{},n.message),h('span',{class:'meta'},fmt(n.createdAt))),h('div',{class:'actions'},n.event&&h('button',{class:'btn ghost small',onclick:guard(()=>eventDetails(n.event))},'Event details'),!n.read&&h('button',{class:'btn ghost small',onclick:guard(async()=>{await api(`/notifications/${n._id}`,{method:'PATCH',body:{read:true}});await load(p);refreshBell();})},'Mark read'),h('button',{class:'btn ghost small',onclick:guard(async()=>{await api(`/notifications/${n._id}`,{method:'DELETE'});await load(p);refreshBell();})},'Delete')))),!r.total?empty('No notifications yet'):pager(r.total,p,load));}root.append(h('button',{class:'btn ghost',onclick:guard(async()=>{await api('/notifications/read-all',{method:'PATCH'});await load();refreshBell();})},'Mark all read'),list);await load();return root;};
VIEWS.audit=async()=>{const box=h('div');async function load(p=1){const r=await api('/audit?page='+p);box.replaceChildren(table(['Time','Actor','Action','Target','Reason / changes'],r.logs.map(l=>[fmt(l.createdAt),l.actor?.name||'System',l.action,l.target,h('div',{},l.reason,h('pre',{},JSON.stringify(l.changes,null,2)))])),pager(r.total,p,load));}await load();return box;};
VIEWS.health=async()=>{const r=await api('/admin/health');return h('div',{},h('div',{class:'stats'},stat(r.db,'Database'),stat(r.pendingAnnouncements,'Announcements pending retry'),stat(r.attention,'Events needing attention'),stat(r.uptimeSeconds,'Server uptime (seconds)')),h('button',{class:'btn ghost',onclick:()=>go('events')},'Manage events'));};
const oldOrganizerDashboard=organizerDashboard;
organizerDashboard=async()=>{if(!state.user.verified)return h('div',{class:'card'},h('h2',{},'Organizer verification required'),h('p',{},'Contact an Admin to verify your account. You can still update your profile and read notifications.'),h('button',{class:'btn',onclick:()=>go('profile')},'My profile'));return oldOrganizerDashboard();};
const oldAdminDashboard=adminDashboard;
adminDashboard=async()=>{const box=await oldAdminDashboard();const r=await api('/admin/health');box.prepend(h('div',{class:'hero'},h('div',{},h('span',{class:'eyebrow'},'CAMPUS OPERATIONS'),h('h2',{},'A clear view of your campus.'),h('p',{},`${r.attention} events need attention. Manage schedules, people and check-in from one place.`)),h('div',{class:'actions'},h('button',{class:'btn',onclick:()=>go('availability')},'Check a venue'),h('button',{class:'btn ghost',onclick:()=>go('checkin')},'Scan tickets'))));return box;};
// Paginated event lists retain the existing event actions and details.
async function eventListView(kind) {
  const root=h('div'),list=h('div'),q=h('input',{type:'search',placeholder:'Search titles or descriptions'}),category=select([['','All categories'],...CATS],''),status=select([['','All statuses'],'Pending','Approved','Rejected','Completed','Cancelled','Archived'],''),from=h('input',{type:'date'}),sort=select([['asc','Earliest first'],['desc','Latest first']],'asc');const {venues}=await api('/venues');const venue=select([['','All venues'],...venues.map(v=>[v._id,v.name])],'');
  async function load(p=1){const query=new URLSearchParams({page:p,q:q.value,category:category.value,status:status.value,from:from.value,venue:venue.value,sort:sort.value,...(kind==='mine'?{mine:'1'}:{})});const r=await api('/events?'+query);list.replaceChildren(r.events.length?(state.user.role==='student'?h('div',{class:'grid'},r.events.map(eventCard)):eventTable(r.events)):empty('No events match this view.'),pager(r.total,p,load));}
  root.append(h('div',{class:'hero'},h('div',{},h('span',{class:'eyebrow'},'CAMPUS CONNECT'),h('h2',{},kind==='mine'?'Your next campus experience':kind==='discover'?'Find your people. Try something new.':'Events, organized.'),h('p',{},'Browse schedules, track registrations and keep your campus connected.')),state.user.role==='organizer'&&h('button',{class:'btn',onclick:guard(()=>openEventForm())},'＋ Create event')),h('div',{class:'toolbar'},field('Search',q),field('Category',category),field('Venue',venue),field('From (IST)',from),field('Sort',sort),state.user.role!=='student'&&field('Status',status)),list);
  for(const x of [category,venue,from,sort,status])x.addEventListener('change',guard(()=>load()));let timer;q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>load().catch(e=>toast(e.message,'error')),300);});await load();return root;
}
for(const kind of ['discover','mine','manage','events'])VIEWS[kind]=()=>eventListView(kind);
openAttendees=async function(id){const box=h('div');modal('Attendees',box,{wide:true});async function load(p=1){const r=await api(`/events/${id}/attendees?page=${p}`);box.replaceChildren(h('h3',{},r.event.title),h('button',{class:'btn',onclick:()=>{$('#modalRoot').replaceChildren();go('checkin');}},'Open QR scanner'),r.attendees.length?table(['Student','Email','Status','Ticket','Checked in'],r.attendees.map(a=>[a.student?.name,a.student?.email,badge(a.status),h('code',{},a.ticketCode),fmt(a.checkedInAt)])):empty('No registrations'),pager(r.total,p,load));}await load();};
// Prompt only while a form has unsaved user edits.
document.addEventListener('input',e=>{const f=e.target.closest('form');if(f)f.dataset.dirty='1';});
document.addEventListener('submit',e=>{if(e.target.matches('form'))delete e.target.dataset.dirty;});
addEventListener('beforeunload',e=>{if(document.querySelector('form[data-dirty="1"]')){e.preventDefault();e.returnValue='';}});
