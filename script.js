// India Museum Portal - client-only application with simple auth, reviews, and scanner
const STORAGE_KEY = 'museum_app_v1';

// museums are now loaded from `museums.json` at runtime so data can be edited separately
let museums = [];

async function loadMuseums(){
  try{
    const res = await fetch('museums.json');
    if(!res.ok) throw new Error('Failed to load museums.json: '+res.status);
    museums = await res.json();
  }catch(e){
    console.error('Could not load museums.json, falling back to empty list', e);
    museums = [];
  }
}

// extract Wikipedia page title from a URL like https://en.wikipedia.org/wiki/Indian_Museum
function extractWikiTitle(url){
  try{ const u = new URL(url); const parts = u.pathname.split('/'); return parts.pop(); }catch(e){return null;}
}

async function fetchWikipediaThumbnailForTitle(title){
  if(!title) return null;
  const api = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
  try{
    const r = await fetch(api);
    if(!r.ok) return null;
    const json = await r.json();
    if(json && json.thumbnail && json.thumbnail.source) return json.thumbnail.source;
  }catch(e){ console.debug('wiki thumb fetch failed', e); }
  return null;
}

// Search Wikipedia for a label and return the best matching page title (or null).
async function searchWikipediaTitle(query){
  if(!query) return null;
  const api = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch='+encodeURIComponent(query)+'&format=json&origin=*';
  try{
    const r = await fetch(api);
    if(!r.ok) return null;
    const j = await r.json();
    if(j && j.query && j.query.search && j.query.search.length){
      return j.query.search[0].title; // best match
    }
  }catch(e){ console.debug('wiki search failed', e); }
  return null;
}

// Open Wikipedia article for a label. Opens a window synchronously (to avoid popup blockers)
// and navigates it to the article when found, otherwise falls back to a search results page.
async function openWikipediaForLabel(label){
  if(!label) return;
  // open a placeholder window synchronously so popup blockers don't stop us
  const win = window.open('about:blank');
  if(!win) return notifyRect('Could not open window (popup blocked)');
  try{
    win.document.title = 'Searching Wikipedia...';
  }catch(e){}
  const title = await searchWikipediaTitle(label);
  if(title){
    win.location.href = 'https://en.wikipedia.org/wiki/'+encodeURIComponent(title);
  } else {
    // fallback to search page
    win.location.href = 'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(label);
  }
}

// Prefetch thumbnails for museums that reference Wikipedia pages and cache them in app.thumbnails
async function prefetchThumbnails(){
  app.thumbnails = app.thumbnails || {};
  let changed = false;
  for(const m of museums){
    // prefer cached thumbnail by museum id
    if(app.thumbnails[m.id]){ m._thumb = app.thumbnails[m.id]; continue; }
    const src = m.image || m.img || '';
    if(!src) continue;
    if(src.includes('wikipedia.org')){
      const title = extractWikiTitle(src);
      if(!title) continue;
      const thumb = await fetchWikipediaThumbnailForTitle(title);
      if(thumb){ m._thumb = thumb; app.thumbnails[m.id] = thumb; changed = true; }
    }
  }
  if(changed) saveApp(app);
}

function getThumbnailSrc(m){
  return (m._thumb) || (m.image) || (m.img) || 'https://via.placeholder.com/300x200?text=No+Image';
}

function getHoursString(m){
  const open = m.opening_time || m.opening || '';
  const close = m.closing_time || m.closing || '';
  const closed = m.closed_days || m.closed || '';
  let s = '';
  if(open || close) s += (open||'') + (open && close ? ' - ' : '') + (close||'');
  if(closed) s += (s? ' • ' : '') + 'Closed: ' + closed;
  return s;
}

// App storage structure (local demo): { users: {username: {passwordHash, data:{wishlist,visited,favorites,reviews,points}}}, currentUser: null }
function loadApp(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return {users:{},currentUser:null};
  try{return JSON.parse(raw);}catch(e){return {users:{},currentUser:null}}}
function saveApp(app){localStorage.setItem(STORAGE_KEY,JSON.stringify(app))}

const app = loadApp();

// get current user data (create anonymous session if none logged in)
function getUserData(){
  if(!app.currentUser) {
    if(!app._anon) app._anon = {wishlist:[],visited:[],favorites:[],reviews:{},points:0};
    return app._anon;
  }
  if(!app.users[app.currentUser].data) app.users[app.currentUser].data = {wishlist:[],visited:[],favorites:[],reviews:{},points:0};
  return app.users[app.currentUser].data;
}

function saveUserData(){ saveApp(app); }

let state = getUserData();

// DOM refs
const museumList = document.getElementById('museum-list');
const searchInput = document.getElementById('search');
const profileModal = document.getElementById('profile-modal');
const profileEl = document.getElementById('profile');
const modalClose = document.getElementById('modal-close');
const navDirectory = document.getElementById('nav-directory');
const navDashboard = document.getElementById('nav-dashboard');
const navBadges = document.getElementById('nav-badges');
const directoryView = document.getElementById('directory-view');
const dashboardView = document.getElementById('dashboard-view');
const badgesView = document.getElementById('badges-view');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const btnResetJourney = document.getElementById('btn-reset-journey');
const btnDeleteAccount = document.getElementById('btn-delete-account');
const userDisplay = document.getElementById('user-display');
const navScanner = document.getElementById('nav-scanner');

// Rectangle overlay element (created in index.html) used instead of prompt/alert
const rectOverlayEl = document.getElementById('rect-overlay');
const rectBoxEl = rectOverlayEl ? rectOverlayEl.querySelector('.rect-box') : null;

function showRect(options){
  if(!rectOverlayEl || !rectBoxEl) return Promise.resolve(false);
  return new Promise(resolve=>{
    rectBoxEl.innerHTML = '';
    if(options.title){ const h = document.createElement('h3'); h.textContent = options.title; rectBoxEl.appendChild(h); }
    const msg = document.createElement('div'); msg.className = 'rect-msg'; msg.innerHTML = options.message || ''; rectBoxEl.appendChild(msg);
    const inputs = [];
    if(options.inputs && Array.isArray(options.inputs)){
      options.inputs.forEach(inp=>{
        const input = document.createElement('input'); input.className='rect-input'; input.type=inp.type||'text'; input.placeholder=inp.placeholder||''; input.value=inp.value||''; rectBoxEl.appendChild(input); inputs.push(input);
      });
    }
    const actions = document.createElement('div'); actions.className='rect-actions';
    const ok = document.createElement('button'); ok.className='btn'; ok.textContent = options.okText || 'OK';
    ok.onclick = ()=>{ rectOverlayEl.classList.add('hidden'); if(inputs.length) resolve(inputs.map(i=>i.value)); else resolve(true); };
    actions.appendChild(ok);
    if(options.cancelText){ const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent = options.cancelText; cancel.onclick = ()=>{ rectOverlayEl.classList.add('hidden'); resolve(false); }; actions.appendChild(cancel); }
    rectBoxEl.appendChild(actions);
    rectOverlayEl.classList.remove('hidden');
  });
}

function notifyRect(message, timeout=1400){ showRect({title:'',message,okText:'Close'}); if(timeout>0) setTimeout(()=>{ if(rectOverlayEl) rectOverlayEl.classList.add('hidden'); }, timeout); }

// review & scanner elements
const reviewModal = document.getElementById('review-modal');
const reviewClose = document.getElementById('review-close');
const starRating = document.getElementById('star-rating');
const reviewNote = document.getElementById('review-note');
const saveReviewBtn = document.getElementById('save-review');
const scannerModal = document.getElementById('scanner-modal');
const scannerClose = document.getElementById('scanner-close');
const scannerVideo = document.getElementById('scanner-video');
const captureBtn = document.getElementById('capture');
const stopCameraBtn = document.getElementById('stop-camera');
const scanResult = document.getElementById('scan-result');
const uploadInput = document.getElementById('upload-image');
// Collection modal refs
const collectionModal = document.getElementById('collection-modal');
const collectionClose = document.getElementById('collection-close');
const collectionTitle = document.getElementById('collection-title');
const collectionGrid = document.getElementById('collection-grid');

// scanner view elements (tabbed scanner)
const scannerUpload = document.getElementById('scanner-upload');
const btnScanUpload = document.getElementById('btn-scan-upload');
const btnOpenLens = document.getElementById('btn-open-lens');

let currentReviewMuseumId = null;
let mobilenetModel = null;
let cameraStream = null;

function formatDate(d){
  const dt = new Date(d);
  return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString();
}

function renderMuseums(filter=''){
  const q = filter.trim().toLowerCase();
  museumList.innerHTML = '';
  const filtered = museums.filter(m=>{
    if(!q) return true;
    return m.name.toLowerCase().includes(q) || (m.city||'').toLowerCase().includes(q) || ((m.description||m.desc||'').toLowerCase().includes(q));
  });
  filtered.forEach(m=>{ museumList.appendChild(createMuseumCard(m, {small:false})); });
}

// Badges definition — images live in /badges folder
const BADGES = [
  {id:'novice traveller', title:'Novice Traveller', file:'badges/novice traveller.png', desc:'Visited your first museum.', criteria: 'Earned on your first museum visit.'},
  {id:'Cultural voyager', title:'Cultural Voyager', file:'badges/Cultural voyager.png', desc:'Visited 5 musuems.', criteria: 'Earned after 5 unique museum visits.'},
  {id:'heritage seeker', title:'Heritage Seeker', file:'badges/heritage seeker.png', desc:'Visited 10 museums.', criteria: 'Earned after 10 unique museum visits.'},
  {id:'Lightspeed traveller', title:'Lightspeed Traveller', file:'badges/Lightspeed traveller.png', desc:'Fast explorer.', criteria: 'Earned when you visit 3 unique museums within 30 days.'},
  {id:'sage traveller', title:'Sage Traveller', file:'badges/sage traveller.png', desc:'Visited 15 museums.', criteria: 'Earned after 15 unique museum visits.'},
  {id:'traveller of the mortal world', title:'Traveller of the Mortal World', file:'badges/traveller of the mortal world.png', desc:'Visited 20 museums.', criteria: 'Earned after 20 unique museum visits.'},
  {id:'True traveller', title:'True Traveller', file:'badges/True traveller.png', desc:'True dedication.', criteria: 'Have visited more than 20 museums.'}
];

function ensureBadgeState(){ state = getUserData(); if(!state.badges) state.badges = []; }

function renderBadges(){
  ensureBadgeState();
  const grid = document.getElementById('badges-grid'); if(!grid) return;
  grid.innerHTML = '';
  BADGES.forEach(b=>{
    const unlocked = (state.badges || []).includes(b.id);
    const card = document.createElement('div'); card.className='badge-card' + (unlocked? '':' locked');
    const img = document.createElement('img'); img.src = b.file; img.alt = b.title; card.appendChild(img);
    const t = document.createElement('div'); t.className='title'; t.textContent = b.title; card.appendChild(t);
  if(!unlocked){ const ov = document.createElement('div'); ov.className='lock-overlay'; /* intentionally no text - visual overlay only */ card.appendChild(ov); }
    else { const ov = document.createElement('div'); ov.className='lock-overlay'; ov.style.display='none'; card.appendChild(ov); }
    // show criteria if present
    if(b.criteria){ const c = document.createElement('div'); c.className = 'badge-criteria'; c.textContent = b.criteria; c.style.fontSize='0.85rem'; c.style.color='var(--muted)'; c.style.marginTop='6px'; card.appendChild(c); }
    grid.appendChild(card);
  });
}

function showBadgeAnimation(imgSrc){
  try{
    const img = document.createElement('img'); img.src = imgSrc; img.className='badge-unlock-anim'; document.body.appendChild(img);
    // force reflow then hide (scale up and fade)
    requestAnimationFrame(()=>{ img.classList.remove('hide'); img.style.transform = 'translate(-50%,-50%) scale(1)'; });
    setTimeout(()=>{ img.classList.add('hide'); }, 1200);
    setTimeout(()=>{ img.remove(); }, 2200);
  }catch(e){ console.error('badge animation failed', e); }
}

// createMuseumCard: returns a card-wrapper element for a museum. options.small controls sizes used in dashboard/collection.
function createMuseumCard(m, opts={}){
  const small = !!opts.small;
  const wrapper = document.createElement('div'); wrapper.className = 'card-wrapper';
  const inner = document.createElement('div'); inner.className = 'card-inner';

  const front = document.createElement('div'); front.className = 'card-face card-front';
  const img = document.createElement('img'); img.src = getThumbnailSrc(m); img.alt = m.name; front.appendChild(img);
  const body = document.createElement('div'); body.className='card-body';
  const h = document.createElement('h4'); h.textContent = m.name; body.appendChild(h);
  const p = document.createElement('p'); p.textContent = (m.city||'') + (m.city? ' • ':'') + (small? '' : getHoursString(m)); body.appendChild(p);
  front.appendChild(body);

  const back = document.createElement('div'); back.className = 'card-face card-back'; back.style.position='absolute';
  const backTitle = document.createElement('h4'); backTitle.textContent = m.name; back.appendChild(backTitle);
  const backDesc = document.createElement('p'); backDesc.textContent = (m.description||m.desc||'').slice(0,200); back.appendChild(backDesc);
  const backMeta = document.createElement('div'); backMeta.style.marginTop='8px';
  const tick = document.createElement('div'); tick.textContent = 'Ticket: ' + (m.entree_price || m.ticket || 'N/A'); backMeta.appendChild(tick);
  back.appendChild(backMeta);

  const star = document.createElement('div'); star.className='fav-star'; star.innerHTML = (getUserData().favorites||[]).includes(m.id)? '★' : '☆'; back.appendChild(star);

  inner.appendChild(front); inner.appendChild(back); wrapper.appendChild(inner);

  // hover flip
  wrapper.addEventListener('mouseenter', ()=> wrapper.classList.add('hover'));
  wrapper.addEventListener('mouseleave', ()=> wrapper.classList.remove('hover'));
  // open profile on click
  wrapper.addEventListener('click', ()=> showProfile(m.id));
  // star click
  star.onclick = async (e)=>{ e.stopPropagation(); wrapper.classList.add('hover'); const ok = await ensureLoggedIn(); if(!ok){ wrapper.classList.remove('hover'); return; } toggleFavorite(m.id); star.classList.add('active'); setTimeout(()=>star.classList.remove('active'),600); };

  return wrapper;
}

// Ensure user is logged in before performing action; if not, prompt then run action
async function ensureLoggedIn(action){
  if(app.currentUser) { if(action) return action(); return true; }
  const ok = await openAuthPrompt();
  if(!ok) return false;
  if(action) return action();
  return true;
}

function getMuseum(id){return museums.find(m=>m.id===id)}

// Show a full collection page (modal) for types: 'wishlist','visited','favorites'
function showCollection(type){
  state = getUserData();
  collectionGrid.innerHTML='';
  let items = [];
  if(type==='wishlist') items = (state.wishlist||[]).map(id=>getMuseum(id)).filter(Boolean);
  else if(type==='favorites') items = (state.favorites||[]).map(id=>getMuseum(id)).filter(Boolean);
  else if(type==='visited') items = (state.visited||[]).map(v=>getMuseum(v.id)).filter(Boolean);
  collectionTitle.textContent = (type==='wishlist'?'Wishlist': type==='visited'?'Visited Log':'Favorites');
  if(!items.length){ const p = document.createElement('div'); p.className='profile-section'; p.textContent='No items found.'; collectionGrid.appendChild(p); }
  else{
    items.forEach(m=>{ const c = createMuseumCard(m,{small:false}); collectionGrid.appendChild(c); });
  }
  collectionModal.classList.remove('hidden');
}

function showProfile(id){
  const m = getMuseum(id); if(!m) return;
  profileEl.innerHTML = '';
  // two-column profile grid
  const grid = document.createElement('div'); grid.className = 'profile-grid';

  const left = document.createElement('div'); left.className = 'profile-left';
  const img = document.createElement('img'); img.src = getThumbnailSrc(m); left.appendChild(img);

  const right = document.createElement('div'); right.className = 'profile-right';
  const title = document.createElement('h2'); title.textContent = m.name; right.appendChild(title);
  const subtitle = document.createElement('p'); subtitle.textContent = (m.city||'') + (m.city? ' • ':'') + getHoursString(m); right.appendChild(subtitle);

  // meta badges
  const metaRow = document.createElement('div'); metaRow.className = 'profile-meta';
  const ticketBadge = document.createElement('span'); ticketBadge.className='badge'; ticketBadge.textContent = 'Ticket: ' + (m.entree_price || m.ticket || 'N/A'); metaRow.appendChild(ticketBadge);
  if(m.famous_for){ const fbadge = document.createElement('span'); fbadge.className='badge'; fbadge.textContent = 'Famous: ' + (Array.isArray(m.famous_for)? m.famous_for.join(', '): m.famous_for); metaRow.appendChild(fbadge); }
  if(m.memorials && m.memorials.length){ const mb = document.createElement('span'); mb.className='badge'; mb.textContent = 'Memorials: ' + (Array.isArray(m.memorials)? m.memorials.join(', '): m.memorials); metaRow.appendChild(mb); }
  right.appendChild(metaRow);

  // description section
  const descSec = document.createElement('div'); descSec.className='profile-section';
  const desc = document.createElement('p'); desc.textContent = (m.description || m.desc || ''); descSec.appendChild(desc);
  right.appendChild(descSec);

  // actions (only in profile)
  const actions = document.createElement('div'); actions.style.marginTop='10px';
  const wish = document.createElement('button'); wish.className='btn secondary';
  // initialize wishlist button text
  wish.textContent = (getUserData().wishlist||[]).includes(id)? 'Remove from Wishlist' : 'Add to Wishlist';
  // toggle wishlist without navigating; refresh UI in-place
  wish.onclick=async ()=>{ await addToWishlist(id); // update button text after toggle
    wish.textContent = (getUserData().wishlist||[]).includes(id)? 'Remove from Wishlist' : 'Add to Wishlist'; };
  const visitedBtn = document.createElement('button'); visitedBtn.className='btn'; visitedBtn.textContent='Mark Visited'; visitedBtn.style.marginLeft='8px'; visitedBtn.onclick=()=>{ openReviewDialog(id); };
  const favBtn = document.createElement('button'); favBtn.className='btn secondary'; favBtn.textContent = (getUserData().favorites||[]).includes(id)? 'Unfavorite' : 'Favorite'; favBtn.style.marginLeft='8px'; favBtn.onclick = ()=>{ toggleFavorite(id); favBtn.textContent = (getUserData().favorites||[]).includes(id)? 'Unfavorite' : 'Favorite'; };
  actions.appendChild(wish); actions.appendChild(visitedBtn); actions.appendChild(favBtn);
  right.appendChild(actions);

  grid.appendChild(left); grid.appendChild(right);
  profileEl.appendChild(grid);

  // exhibits
  const exhibitsTitle = document.createElement('h3'); exhibitsTitle.textContent = 'Top Exhibits'; exhibitsTitle.style.marginTop='14px'; profileEl.appendChild(exhibitsTitle);
  const eg = document.createElement('div'); eg.className = 'exhibits';
  (m.exhibits||[]).forEach(e=>{
    const ex = document.createElement('div'); ex.className='exhibit';
    const im = document.createElement('img'); im.src = e.img; ex.appendChild(im);
    const et = document.createElement('strong'); et.textContent = e.title; ex.appendChild(et);
    const ed = document.createElement('p'); ed.textContent = e.desc; ex.appendChild(ed);
    eg.appendChild(ex);
  });
  profileEl.appendChild(eg);
  // Show user's review (if exists)
  const userState = getUserData();
  const reviewData = (userState && userState.reviews && userState.reviews[m.id]) ? userState.reviews[m.id] : null;
  if(reviewData){
    const revSec = document.createElement('div'); revSec.className = 'profile-section';
    const revH = document.createElement('h3'); revH.textContent = 'Your Review'; revSec.appendChild(revH);
    const stars = document.createElement('div'); stars.style.marginTop='6px'; stars.textContent = (reviewData.rating? ('★'.repeat(reviewData.rating) + ' ('+reviewData.rating+'/5)') : 'No rating'); revSec.appendChild(stars);
    const rnote = document.createElement('p'); rnote.style.marginTop='8px'; rnote.textContent = reviewData.note || ''; revSec.appendChild(rnote);
    const rdate = document.createElement('div'); rdate.style.fontSize='0.85rem'; rdate.style.color='var(--muted)'; rdate.textContent = reviewData.date? ('Reviewed: '+ new Date(reviewData.date).toLocaleString()) : ''; revSec.appendChild(rdate);
    profileEl.appendChild(revSec);
  }
  profileModal.classList.remove('hidden');
}

function closeModal(){profileModal.classList.add('hidden');}

function toggleWishlist(id){
  state = getUserData();
  const idx = state.wishlist.indexOf(id);
  if(idx===-1) state.wishlist.push(id); else state.wishlist.splice(idx,1);
  saveUserData(); renderDashboard(); renderMuseums(searchInput.value);
}

async function addToWishlist(id){
  const ok = await ensureLoggedIn(); if(!ok) return;
  state = getUserData();
  const idx = state.wishlist.indexOf(id);
  if(idx===-1){ state.wishlist.push(id); saveUserData(); notifyRect('Added to wishlist'); }
  else { state.wishlist.splice(idx,1); saveUserData(); notifyRect('Removed from wishlist'); }
  // refresh UI in-place (dashboard, museum list, profile) but do not navigate
  try{ await _refreshAfterWishlistChange(id); }catch(e){ /* ignore */ }
}
// Ensure UI reflects wishlist changes in other views as well
async function _refreshAfterWishlistChange(id){
  try{ renderDashboard(); }catch(e){ /* ignore */ }
  try{ renderMuseums(searchInput ? searchInput.value : ''); }catch(e){ /* ignore */ }
  try{ if(!profileModal.classList.contains('hidden') && id) showProfile(id); }catch(e){ /* ignore */ }
}
// Ensure wishlist click also reveals dashboard so the user sees the added item immediately
async function addToWishlistAndShow(id){
  await addToWishlist(id);
  // show dashboard view so change is visible
  if(navDashboard && directoryView && dashboardView){
    navDashboard.classList.add('active'); navDirectory.classList.remove('active'); navScanner.classList.remove('active');
    directoryView.classList.add('hidden'); dashboardView.classList.remove('hidden');
    const sv = document.getElementById('scanner-view'); if(sv) sv.classList.add('hidden');
    // close profile modal if open to reveal dashboard
    if(profileModal && !profileModal.classList.contains('hidden')) profileModal.classList.add('hidden');
    try{ renderDashboard(); }catch(e){ console.debug('renderDashboard failed after addToWishlistAndShow', e); }
  }
}

function toggleFavorite(id){ state = getUserData(); const idx = state.favorites.indexOf(id); if(idx===-1) state.favorites.push(id); else state.favorites.splice(idx,1); saveUserData(); renderDashboard(); renderMuseums(searchInput.value);} 

// Open review dialog when marking visited
function openReviewDialog(id){
  ensureLoggedIn(()=>{
    currentReviewMuseumId = id;
    // reset UI
    reviewNote.value = '';
    renderStars(0);
    reviewModal.classList.remove('hidden');
  });
}

function markVisitedWithReview(id, rating, note){
  state = getUserData();
  const now = new Date().toISOString();
  // If there is already a visit recorded for this museum, update it instead of adding duplicates
  const existingIndex = (state.visited||[]).findIndex(v=>v.id===id);
  if(existingIndex!==-1){
    const existing = state.visited[existingIndex];
    existing.date = now; // refresh timestamp
    existing.rating = rating||existing.rating||null;
    existing.note = note||existing.note||'';
    // update review map too
    if(rating||note) state.reviews[id] = {rating: existing.rating, note: existing.note, date: existing.date};
  } else {
    const entry = {id:id,date:now,rating:rating||null,note:note||''};
    if(!state.visited) state.visited = [];
    state.visited.push(entry);
    if(rating||note) state.reviews[id] = {rating, note, date:entry.date};
  }
  // remove from wishlist if present
  const widx = state.wishlist.indexOf(id); if(widx!==-1) state.wishlist.splice(widx,1);
  // award points
  state.points = (state.points||0) + 10;
  saveUserData(); try{ renderDashboard(); }catch(e){ console.warn('renderDashboard failed after marking visit', e); }
  // Badge unlocking: Novice Traveller unlocked when the user has at least one visited entry
  try{
    ensureBadgeState();
    // Novice Traveller: unlocked when the user has at least one visited entry
    if(!(state.badges||[]).includes('novice traveller') && (state.visited && state.visited.length>0)){
      state.badges.push('novice traveller'); saveUserData(); try{ renderBadges(); }catch(e){}
      showBadgeAnimation('badges/novice traveller.png');
    }
    // True Traveller: unlocked when user has visited at least 5 unique museums
    const uniqueVisited = (state.visited||[]).map(v=>v.id).filter((v,i,arr)=>arr.indexOf(v)===i);
    if(!(state.badges||[]).includes('True traveller') && uniqueVisited.length >= 5){
      state.badges.push('True traveller'); saveUserData(); try{ renderBadges(); }catch(e){}
      showBadgeAnimation('badges/True traveller.png');
    }
    // Lightspeed Traveller: visit 3 unique museums within the last 30 days
    if(!(state.badges||[]).includes('Lightspeed traveller') && (state.visited && state.visited.length>0)){
      try{
        const now = Date.now();
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const recent = (state.visited||[]).filter(v=>{ try{ const t = new Date(v.date).getTime(); return (now - t) <= THIRTY_DAYS; }catch(e){ return false; } });
        const uniqueRecent = recent.map(r=>r.id).filter((v,i,arr)=>arr.indexOf(v)===i);
        if(uniqueRecent.length >= 3){ state.badges.push('Lightspeed traveller'); saveUserData(); try{ renderBadges(); }catch(e){}; showBadgeAnimation('badges/Lightspeed traveller.png'); }
      }catch(e){ /* ignore */ }
    }
  }catch(e){ console.error('badge unlock check failed', e); }
  notifyRect('Visit saved — review recorded');
  // If profile modal is open for this museum, refresh it to show the saved review
  if(!profileModal.classList.contains('hidden')){
    try{ showProfile(id); }catch(e){ /* ignore */ }
  }
}



function renderDashboard(){
  // refresh local state from app
  state = getUserData();
  const wishEl = document.getElementById('wishlist');
  const visitedEl = document.getElementById('visited');
  const favEl = document.getElementById('favorites');
  // If any dashboard DOM pieces are missing (script may run on other pages), bail out safely
  if(!wishEl || !visitedEl || !favEl){
    // When dashboard DOM isn't present (user on another view), skip quietly.
    console.debug('renderDashboard: dashboard elements not found; skipping render');
    return;
  }
  // replace simple lists with small card grids and clickable headers
  const wishCol = wishEl.closest('.dash-column') || wishEl.parentElement;
  const visitedCol = visitedEl.closest('.dash-column') || visitedEl.parentElement;
  const favCol = favEl.closest('.dash-column') || favEl.parentElement;
  if(wishCol) wishCol.innerHTML = '';
  if(visitedCol) visitedCol.innerHTML = '';
  if(favCol) favCol.innerHTML = '';

  // header buttons to open full collection page
  const makeHeader = (title, type)=>{
    const h = document.createElement('h3');
    const b = document.createElement('button'); b.className='btn'; b.textContent = title; b.onclick = ()=> showCollection(type);
    h.appendChild(b); return h;
  };

  // Wishlist column
  wishCol.appendChild(makeHeader('Wishlist','wishlist'));
  const wg = document.createElement('div'); wg.className='grid'; wg.style.marginTop='10px';
  state.wishlist.forEach(id=>{ const m = getMuseum(id); if(!m) return; const c = createMuseumCard(m,{small:true}); wg.appendChild(c); });
  if(!state.wishlist.length){ const p = document.createElement('div'); p.className='profile-section'; p.textContent='Your wishlist is empty.'; wg.appendChild(p); }
  wishCol.appendChild(wg);

  // Visited column
  visitedCol.appendChild(makeHeader('Visited Log','visited'));
  const vg = document.createElement('div'); vg.className='grid'; vg.style.marginTop='10px';
  state.visited.slice().reverse().forEach(entry=>{ const m = getMuseum(entry.id); if(!m) return; const c = createMuseumCard(m,{small:true});
    // add small footer with date/rating and optional review note (in quotes)
    const footer = document.createElement('div'); footer.style.fontSize='0.8rem'; footer.style.marginTop='6px'; footer.style.color='var(--muted)';
    let ftxt = formatDate(entry.date);
    if(entry.rating) ftxt += ' • ' + entry.rating + '★';
    // prefer note on the entry, fall back to reviews map
    const note = (entry.note && entry.note.trim()) ? entry.note.trim() : ((state.reviews && state.reviews[entry.id] && state.reviews[entry.id].note) ? state.reviews[entry.id].note : '');
    if(note) ftxt += ' — "' + note + '"';
    footer.textContent = ftxt;
    c.querySelector('.card-body').appendChild(footer);
    vg.appendChild(c);
  });
  if(!state.visited.length){ const p = document.createElement('div'); p.className='profile-section'; p.textContent='You have not recorded any visits yet.'; vg.appendChild(p); }
  visitedCol.appendChild(vg);

  // Favorites column
  favCol.appendChild(makeHeader('Favorites','favorites'));
  const fg = document.createElement('div'); fg.className='grid'; fg.style.marginTop='10px';
  state.favorites.forEach(id=>{ const m = getMuseum(id); if(!m) return; const c = createMuseumCard(m,{small:true}); fg.appendChild(c); });
  if(!state.favorites.length){ const p = document.createElement('div'); p.className='profile-section'; p.textContent='No favorites yet.'; fg.appendChild(p); }
  favCol.appendChild(fg);
}

// Navigation
navDirectory.addEventListener('click',()=>{
  navDirectory.classList.add('active');navDashboard.classList.remove('active');navScanner.classList.remove('active');
  directoryView.classList.remove('hidden');dashboardView.classList.add('hidden');
  const sv = document.getElementById('scanner-view'); if(sv) sv.classList.add('hidden');
});
navScanner.addEventListener('click',()=>{
  // user requested scanner to directly open Google Lens / Image Search
  try{
    // mark nav state
    navScanner.classList.add('active'); navDirectory.classList.remove('active'); navDashboard.classList.remove('active');
    // hide other app views
    directoryView.classList.add('hidden'); dashboardView.classList.add('hidden');
  }catch(e){}
  // open Google Images (reverse-image search) in a new tab/window
  try{ window.open('https://images.google.com/','_blank'); }catch(e){ console.error('Could not open Google Images', e); notifyRect('Could not open Google Lens / Image Search'); }
});
navDashboard.addEventListener('click', async ()=>{
  const proceed = await ensureLoggedIn(); if(!proceed) return;
  navDashboard.classList.add('active');navDirectory.classList.remove('active');
  directoryView.classList.add('hidden');dashboardView.classList.remove('hidden');
  // render dashboard and ensure the view is scrolled to top so user sees initial content
  try{ renderDashboard(); }catch(e){ console.warn('renderDashboard error', e); }
  try{ window.scrollTo({top:0,behavior:'auto'}); }catch(e){}
  try{ if(dashboardView) dashboardView.scrollTop = 0; }catch(e){}
});
// Badges nav
if(navBadges){ navBadges.addEventListener('click', ()=>{
  // show badges view
  navBadges.classList.add('active'); navDirectory.classList.remove('active'); navDashboard.classList.remove('active'); navScanner.classList.remove('active');
  directoryView.classList.add('hidden'); dashboardView.classList.add('hidden'); if(badgesView) badgesView.classList.remove('hidden');
  try{ renderBadges(); }catch(e){ console.warn('renderBadges failed', e); }
}); }
searchInput.addEventListener('input',e=>renderMuseums(e.target.value));
modalClose.addEventListener('click',closeModal);
profileModal.addEventListener('click',e=>{if(e.target===profileModal)closeModal();});
// collection modal close handlers
if(collectionClose) collectionClose.addEventListener('click',()=>{ collectionModal.classList.add('hidden'); });
if(collectionModal) collectionModal.addEventListener('click', e=>{ if(e.target===collectionModal) collectionModal.classList.add('hidden'); });

// Auth UI
// Login button goes to separate login page
btnLogin.addEventListener('click',()=>{ window.location.href = 'login.html'; });
btnLogout.addEventListener('click',()=>{app.currentUser=null;saveApp(app); updateAuthUI(); state = getUserData(); renderDashboard();});
if(btnResetJourney){ btnResetJourney.addEventListener('click', async ()=>{
  const ok = await showRect({title:'Reset Journey', message:'This will clear your wishlist, visited log, favorites and reviews. Continue?', okText:'Reset', cancelText:'Cancel'});
  if(!ok) return;
  if(app.currentUser){ app.users[app.currentUser].data = {wishlist:[],visited:[],favorites:[],reviews:{},points:0,badges:app.users[app.currentUser].data?app.users[app.currentUser].data.badges:[]}; }
  else { app._anon = {wishlist:[],visited:[],favorites:[],reviews:{},points:0,badges:[]}; }
  saveApp(app); state = getUserData(); renderDashboard(); renderBadges(); notifyRect('Journey reset');
}); }
if(btnDeleteAccount){ btnDeleteAccount.addEventListener('click', async ()=>{
  if(!app.currentUser) return notifyRect('No account signed in');
  const ok = await showRect({title:'Delete Account', message:'Permanently delete your account and all saved data? This cannot be undone.', okText:'Delete', cancelText:'Cancel'});
  if(!ok) return;
  try{ delete app.users[app.currentUser]; app.currentUser = null; saveApp(app); updateAuthUI(); state = getUserData(); renderDashboard(); notifyRect('Account deleted'); }
  catch(e){ console.error('delete account failed', e); notifyRect('Could not delete account'); }
}); }

function updateAuthUI(){
  if(app.currentUser){ 
    userDisplay.textContent = app.currentUser + ' • ' + ((getUserData().points||0)) + ' pts';
    btnLogin.classList.add('hidden'); btnLogout.classList.remove('hidden');
    if(btnResetJourney) btnResetJourney.classList.remove('hidden');
    if(btnDeleteAccount) btnDeleteAccount.classList.remove('hidden');
  } else { 
    userDisplay.textContent=''; btnLogin.classList.remove('hidden'); btnLogout.classList.add('hidden');
    if(btnResetJourney) btnResetJourney.classList.add('hidden');
    if(btnDeleteAccount) btnDeleteAccount.classList.add('hidden');
  }
}

// Simple auth prompt (demo / local only)
// openAuthPrompt now directs user to the separate `login.html` page.
async function openAuthPrompt(){
  // Show an on-screen rectangle telling user to go to login page
  const res = await showRect({title:'Sign in required', message:'You need to sign in to continue. Open the login page?', okText:'Open Login', cancelText:'Cancel'});
  if(res) window.location.href = 'login.html';
  return false;
}

// SHA-256 helper
async function sha256(str){
  const enc = new TextEncoder(); const data = enc.encode(str); const hash = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Review modal handling
function renderStars(selected){
  starRating.innerHTML='';
  for(let i=1;i<=5;i++){ const s = document.createElement('span'); s.className='star'+(i<=selected?' selected':''); s.textContent='★'; s.dataset.val=i; s.onclick=()=>renderStars(i); starRating.appendChild(s);} 
}
renderStars(0);
reviewClose.addEventListener('click',()=>reviewModal.classList.add('hidden'));
saveReviewBtn.addEventListener('click', async ()=>{
  if(!currentReviewMuseumId) return notifyRect('No museum selected');
  const sel = Array.from(starRating.querySelectorAll('.star.selected')).length;
  // disable to prevent duplicate clicks
  saveReviewBtn.disabled = true; saveReviewBtn.textContent = 'Saving...';
  try{
    await markVisitedWithReview(currentReviewMuseumId, sel, reviewNote.value.trim());
  }catch(e){ console.error('Error saving review', e); notifyRect('Could not save visit'); }
  saveReviewBtn.disabled = false; saveReviewBtn.textContent = 'Save Visit';
  reviewModal.classList.add('hidden');
});

// Scanner handling (uses mobilenet loaded via CDN)
async function ensureMobilenet(){ if(mobilenetModel) return mobilenetModel; try{ mobilenetModel = await mobilenet.load(); return mobilenetModel;}catch(e){console.warn('Failed to load mobilenet',e); return null;} }

if(scannerClose){ scannerClose.addEventListener('click',()=>{ stopCamera(); if(scannerModal) scannerModal.classList.add('hidden'); }); }
if(stopCameraBtn){ stopCameraBtn.addEventListener('click',()=>{ stopCamera(); }); }

async function openScanner(){
  scannerModal.classList.remove('hidden');
  // start camera
  try{ cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); scannerVideo.srcObject = cameraStream; await scannerVideo.play(); }catch(e){ notifyRect('Camera not available: '+(e.message||''), 3000); }
  // load model in background
  ensureMobilenet();
}

if(captureBtn){ captureBtn.addEventListener('click',async ()=>{
  // open a placeholder window synchronously so we can navigate to Wikipedia after async work
  const wikiWin = window.open('about:blank');
  // capture frame
  const c = document.createElement('canvas'); c.width = scannerVideo.videoWidth; c.height = scannerVideo.videoHeight; const ctx = c.getContext('2d'); ctx.drawImage(scannerVideo,0,0,c.width,c.height);
  const dataUrl = c.toDataURL('image/jpeg');
  scanResult.innerHTML = '';
  const img = document.createElement('img'); img.src = dataUrl; img.style.maxWidth='220px'; scanResult.appendChild(img);
  const model = await ensureMobilenet();
  if(!model){ scanResult.appendChild(document.createTextNode('Recognition model not available.')); return; }
  scanResult.appendChild(document.createTextNode('Identifying...'));
  const predictions = await model.classify(c);
  scanResult.innerHTML = ''; scanResult.appendChild(img);
  if(predictions && predictions.length){
    const p = predictions[0];
    const title = document.createElement('div'); title.innerHTML = '<strong>Prediction:</strong> '+p.className + ' ('+Math.round(p.probability*100)+'%)'; scanResult.appendChild(title);
    // attempt to find a matching Wikipedia page for the top label and navigate the placeholder window
    try{
      const label = p.className;
      const wikiTitle = await searchWikipediaTitle(label);
      if(wikiWin){
        if(wikiTitle) wikiWin.location.href = 'https://en.wikipedia.org/wiki/'+encodeURIComponent(wikiTitle);
        else wikiWin.location.href = 'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(label);
      }
    }catch(e){ console.debug('wikipedia open failed', e); }
    // try mapping to known artifacts (demo mapping)
    const known = mapPredictionToArtifact(p.className);
    if(known){
      const card = document.createElement('div'); card.style.marginTop='8px'; card.innerHTML = '<h4>'+known.title+'</h4><p>'+known.history+'</p><p><em>Source: sample data</em></p>';
      const addBtn = document.createElement('button'); addBtn.className='btn'; addBtn.textContent='Add to Wishlist'; addBtn.onclick=()=>{ addToWishlist(known.museumId||known.id); };
      card.appendChild(addBtn);
      scanResult.appendChild(card);
    } else {
      const link = document.createElement('a'); link.href='https://www.google.com/search?q='+encodeURIComponent(p.className); link.target='_blank'; link.textContent='Search the web for more info'; scanResult.appendChild(link);
    }
  }
}); }

// Handle uploaded images: classify and provide web search links
if(uploadInput){
  uploadInput.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    // show preview
    const url = URL.createObjectURL(file);
    const imgEl = new Image(); imgEl.crossOrigin = 'anonymous'; imgEl.src = url;
    imgEl.onload = async ()=>{
      // draw to canvas
      const c = document.createElement('canvas'); c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(imgEl,0,0);
      scanResult.innerHTML = '';
      const thumb = document.createElement('img'); thumb.src = url; thumb.style.maxWidth='220px'; thumb.style.maxHeight='160px'; thumb.style.borderRadius='6px'; thumb.style.marginRight='8px'; scanResult.appendChild(thumb);
      const model = await ensureMobilenet();
      if(!model){ const t = document.createElement('div'); t.textContent = 'Recognition model not available.'; scanResult.appendChild(t); URL.revokeObjectURL(url); return; }
      const predictions = await model.classify(c);
      displayScanResults(predictions, c.toDataURL('image/jpeg'), url, file);
    };
    imgEl.onerror = ()=>{ notifyRect('Could not read that image'); URL.revokeObjectURL(url); };
  });
}

// Helper to process an uploaded File (used by scanner tab and modal upload)
async function processUploadedImageFile(file){
  if(!file) return notifyRect('No image selected');
  const url = URL.createObjectURL(file);
  const imgEl = new Image(); imgEl.crossOrigin='anonymous'; imgEl.src = url;
  imgEl.onload = async ()=>{
    const c = document.createElement('canvas'); c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(imgEl,0,0);
    scanResult.innerHTML = '';
    const thumb = document.createElement('img'); thumb.src = url; thumb.style.maxWidth='220px'; thumb.style.maxHeight='160px'; thumb.style.borderRadius='6px'; thumb.style.marginRight='8px'; scanResult.appendChild(thumb);
    const model = await ensureMobilenet();
    if(!model){ const t = document.createElement('div'); t.textContent = 'Recognition model not available.'; scanResult.appendChild(t); return; }
    const predictions = await model.classify(c);
    displayScanResults(predictions, c.toDataURL('image/jpeg'), url, file);
    // do not revoke immediately so user can open the blob; browser will clean up later
  };
  imgEl.onerror = ()=>{ notifyRect('Could not read that image'); URL.revokeObjectURL(url); };
}

// Wire scanner tab controls
if(scannerUpload){ scannerUpload.addEventListener('change', (e)=>{ const f = e.target.files && e.target.files[0]; if(f) processUploadedImageFile(f); }); }
if(btnScanUpload){ btnScanUpload.addEventListener('click', ()=>{ const f = (scannerUpload && scannerUpload.files && scannerUpload.files[0]) || null; if(!f) return notifyRect('Please choose an image first'); processUploadedImageFile(f); }); }
// Wire Open Google Lens button to classify the uploaded image and open the best-matching Wikipedia page.
if(btnOpenLens){ btnOpenLens.addEventListener('click', async ()=>{
  const f = (scannerUpload && scannerUpload.files && scannerUpload.files[0]) || null;
  if(!f) return notifyRect('Please choose an image first');
  // open placeholder window synchronously to avoid popup blockers
  const win = window.open('about:blank');
  if(!win) return notifyRect('Could not open window (popup blocked)');
  try{
    win.document.title = 'Searching Wikipedia...';
  }catch(e){}
  try{
    const url = URL.createObjectURL(f);
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
    img.onload = async ()=>{
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(img,0,0);
      const model = await ensureMobilenet();
      URL.revokeObjectURL(url);
      if(!model){ try{ win.location.href = 'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(f.name||''); }catch(e){}; return; }
      const preds = await model.classify(c);
      const top = (preds && preds[0])? preds[0].className : (f.name || '');
      try{
        const title = await searchWikipediaTitle(top);
        if(title) win.location.href = 'https://en.wikipedia.org/wiki/'+encodeURIComponent(title);
        else win.location.href = 'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(top);
      }catch(e){ try{ win.location.href = 'https://en.wikipedia.org/w/index.php?search='+encodeURIComponent(top); }catch(e2){} }
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); try{ win.close(); }catch(e){}; notifyRect('Could not read image'); };
  }catch(e){ console.error('openLens error', e); try{ win.close(); }catch(e){}; notifyRect('Could not process image'); }
}); }

function displayScanResults(predictions, dataUrl, blobUrl, file){
  // predictions: array with className and probability
  const container = document.createElement('div'); container.style.marginTop='8px';
  const list = document.createElement('ul'); list.style.padding='0'; list.style.listStyle='none';
  if(predictions && predictions.length){
    predictions.slice(0,5).forEach(p=>{
      const li = document.createElement('li'); li.style.marginBottom='6px';
      li.innerHTML = '<strong>'+p.className+'</strong> — '+Math.round(p.probability*100)+'%';
      list.appendChild(li);
    });
  } else { const li = document.createElement('li'); li.textContent='No predictions'; list.appendChild(li); }
  container.appendChild(list);

  // Web search links using top label(s)
  const topLabel = (predictions && predictions[0])? predictions[0].className : '';
  const actions = document.createElement('div'); actions.style.marginTop='8px'; actions.style.display='flex'; actions.style.gap='8px';
  if(topLabel){
    const googleBtn = document.createElement('button'); googleBtn.className='btn'; googleBtn.textContent = 'Search images for "'+topLabel+'"'; googleBtn.onclick = ()=>{ window.open('https://www.google.com/search?tbm=isch&q='+encodeURIComponent(topLabel),'_blank'); };
  const wikiBtn = document.createElement('button'); wikiBtn.className='btn secondary'; wikiBtn.textContent = 'Search Wikipedia for "'+topLabel+'"'; wikiBtn.onclick = ()=>{ openWikipediaForLabel(topLabel); };
    actions.appendChild(googleBtn); actions.appendChild(wikiBtn);
  }

  // Open blob in new tab so user can drag to Google Images 'search by image' (browser allows manual upload)
  if(blobUrl){
    const viewImg = document.createElement('button'); viewImg.className='btn secondary'; viewImg.textContent='Open image (for reverse search)'; viewImg.onclick = ()=>{ window.open(blobUrl,'_blank'); };
    actions.appendChild(viewImg);
  // Reverse-image action: open Wikipedia for the top predicted label (or filename) of the image
    const rev = document.createElement('button'); rev.className='btn'; rev.textContent='Search Wikipedia (Lens)';
    rev.onclick = async ()=>{
      // classify or use topLabel to open Wikipedia page for this image
      const label = topLabel || (file && file.name) || '';
      await openWikipediaForLabel(label);
    };
    actions.appendChild(rev);
  }

  // Provide a generic web search of top 3 labels combined
  if(predictions && predictions.length){
    const combined = predictions.slice(0,3).map(p=>p.className.split(',')[0]).join(' ');
    const webBtn = document.createElement('button'); webBtn.className='btn'; webBtn.textContent='Search web for labels'; webBtn.onclick = ()=>{ window.open('https://www.google.com/search?q='+encodeURIComponent(combined),'_blank'); };
    actions.appendChild(webBtn);
  }

  container.appendChild(actions);
  // replace the scanResult details (keep image preview already appended)
  // remove any previous details beyond the preview
  const existingChildren = Array.from(scanResult.children).slice(1);
  existingChildren.forEach(n=>n.remove());
  scanResult.appendChild(container);
}

// (Imgur upload helper removed — image reverse search now uses classifier -> Wikipedia lookup)

function mapPredictionToArtifact(label){
  // Very small demo map — in real app use a proper knowledge base or image search
  const map = {
    'stone wall': {title:'Ancient Stone Carving',history:'Likely a carved relief; could relate to temple architecture. Visit the nearby archaeological museums for similar items.',museumId:'salar-jung-hyderabad'},
    'marble': {title:'Marble Sculpture',history:'Marble sculptures are common in Mughal and Rajput art. See collections at Victoria Memorial and CSMVS.',museumId:'victoria-memorial-kolkata'},
    'altar': {title:'Religious Sculpture',history:'Religious sculptures often depict deities and mythological scenes; check regional museum catalogs.'}
  };
  for(const k in map) if(label.toLowerCase().includes(k)) return map[k];
  return null;
}

function stopCamera(){ if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; scannerVideo.srcObject=null; } }

// Initial render
document.addEventListener('DOMContentLoaded', async ()=>{ await loadMuseums(); // start thumbnail prefetch in background and render
  prefetchThumbnails().then(()=>{ renderMuseums(searchInput ? searchInput.value : ''); populateBanner(); });
  renderMuseums(searchInput ? searchInput.value : ''); updateAuthUI(); renderDashboard();
  // render badges area if present
  try{ renderBadges(); }catch(e){}
  
});

// Banner population: show top 5 museum thumbnails in a scrolling strip
const bannerTrack = document.getElementById('banner-track');
function populateBanner(){
  if(!bannerTrack || !museums || !museums.length) return;
  bannerTrack.innerHTML = '';
  const top = museums.slice(0,5);
  // create items once
  top.forEach(m=>{
    const item = document.createElement('div'); item.className = 'banner-item';
    const img = document.createElement('img'); img.src = getThumbnailSrc(m); img.alt = m.name; item.appendChild(img);
    bannerTrack.appendChild(item);
  });
  // duplicate items to allow seamless looping animation
  top.forEach(m=>{
    const item = document.createElement('div'); item.className = 'banner-item';
    const img = document.createElement('img'); img.src = getThumbnailSrc(m); img.alt = m.name; item.appendChild(img);
    bannerTrack.appendChild(item);
  });
  // start scroll animation
  setTimeout(()=>{ bannerTrack.classList.add('scrolling'); }, 120);
}
