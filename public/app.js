(function(){
"use strict";
/* ================= constants + helpers ================= */
const TYPES = {
  pm:{label:"Maintenance",c:"var(--pm)"}, repair:{label:"Repair",c:"var(--repair)"},
  install:{label:"Installation",c:"var(--install)"}, assess:{label:"Estimate",c:"var(--assess)"},
  portable:{label:"Shop repair",c:"var(--portable)"}, personal:{label:"Personal",c:"var(--personal)"},
  busy:{label:"Busy",c:"var(--busy)"}
};
const STAGES = {pickup:"To pick up", shop:"In the shop", ready:"Ready to return", returned:"Returned"};
const CHECKLIST = [
  "Engine oil and filter changed",
  "Air filter inspected / replaced",
  "Spark plugs inspected / replaced",
  "Coolant level and hoses (liquid-cooled)",
  "Belts inspected",
  "Battery load-tested, terminals cleaned",
  "Fuel supply and connections checked for leaks",
  "Exhaust system inspected",
  "Wiring and connections inspected",
  "Enclosure, vents and air intake clear",
  "Controller alarms and event log reviewed",
  "Exercise schedule verified",
  "Transfer switch operation tested",
  "Run test under load"
];
const RESULTS = ["", "OK", "Done", "Needs attention", "N/A"];
const PIN = { overdue:"#C8331B", soon:"#F4C20D", booked:"#3E7A55", plan:"#3E5B70", none:"#9AA1A6" };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const todayIso = () => iso(new Date());
function mondayOf(d){ const x = new Date(d.getFullYear(),d.getMonth(),d.getDate()); const w = (x.getDay()+6)%7; x.setDate(x.getDate()-w); return x; }
function addMonths(s, m){ const d = parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+m); const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(day,last)); return iso(d); }
function addDays(s, n){ const d = parse(s); d.setDate(d.getDate()+n); return iso(d); }
const daysBetween = (a,b) => Math.round((parse(b)-parse(a))/86400000);
const fmtDate = s => parse(s).toLocaleDateString("en-CA",{weekday:"short",month:"short",day:"numeric"});
const fmtLongDate = s => parse(s).toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"});
function fmtTime(t){ if(!t) return ""; const [h,m] = t.split(":").map(Number); const ap = h>=12?"pm":"am"; const hh = ((h+11)%12)+1; return hh+(m?":"+pad(m):"")+ap; }
function fmtClock(ms){ return new Date(ms).toLocaleTimeString("en-CA",{hour:"numeric",minute:"2-digit"}); }
function newId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function nextWeekday(){ const d = new Date(); do{ d.setDate(d.getDate()+1); }while(d.getDay()===0||d.getDay()===6); return iso(d); }
function km(a, b){ const R=6371, r=x=>x*Math.PI/180; const dLat=r(b.lat-a.lat), dLng=r(b.lng-a.lng); const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
const hasLoc = c => c && isFinite(Number(c.lat)) && isFinite(Number(c.lng)) && c.lat !== "" && c.lng !== "";
const loc = c => ({ lat:Number(c.lat), lng:Number(c.lng) });

/* ---------- trade (industry) ---------- */
const IND = () => state.industry || { equipment:"Equipment", sizeUnit:"", fuels:[], equipmentTypes:[], brands:[], jobTypes:{ pm:{label:"Maintenance",on:true}, repair:{label:"Service call",on:true}, install:{label:"Installation",on:true}, assess:{label:"Estimate",on:true}, shop:{label:"Shop repair",on:false,board:"Shop repairs"} } };
const eqLower = () => { const e = IND().equipment || "Equipment"; return e === e.toUpperCase() ? e : e.toLowerCase(); };
const appName = () => state.settings?.business?.name || "Fielora";
const shopOn = () => !!IND().jobTypes.shop?.on;
const sizeTxt = c => c.kw ? `${c.kw}${IND().sizeUnit ? " " + IND().sizeUnit : ""}` : "";
const enabledTypes = () => ["pm","repair","install","assess","portable"].filter(k => k === "portable" ? shopOn() : (IND().jobTypes[k]?.on !== false));
function applyIndustry(){
  const jt = IND().jobTypes;
  TYPES.pm.label = jt.pm.label; TYPES.repair.label = jt.repair.label; TYPES.install.label = jt.install.label; TYPES.assess.label = jt.assess.label; TYPES.portable.label = jt.shop.label;
  $("#jType").innerHTML = enabledTypes().map(k=>`<label><input type="radio" name="type" value="${k}"> ${esc(TYPES[k].label)}</label>`).join("") + `<label><input type="radio" name="type" value="personal"> Personal time</label>`;
  $("#legend").innerHTML = enabledTypes().map(k=>`<span style="--c:${TYPES[k].c}">${esc(TYPES[k].label)}</span>`).join("") + `<span style="--c:var(--personal)">Personal time</span>`;
  $("#shopTab").hidden = !shopOn(); $("#shopTabLabel").textContent = jt.shop.board || "Shop"; $("#shopTitle").textContent = jt.shop.board || "Shop";
  const E = IND().equipment || "Equipment";
  $("#cEtypeLabel").textContent = `${E} type`; $("#cBrandLabel").textContent = `${E} brand`;
  $("#cKwLabel").textContent = IND().sizeUnit ? `Size (${IND().sizeUnit})` : "Size / capacity";
  $("#cFuelWrap").hidden = !IND().fuels.length;
  $("#cFuel").innerHTML = `<option value="">—</option>` + IND().fuels.map(f=>`<option>${esc(f)}</option>`).join("");
  $("#brands").innerHTML = IND().brands.map(b=>`<option value="${esc(b)}">`).join("");
  $("#etypes").innerHTML = IND().equipmentTypes.map(b=>`<option value="${esc(b)}">`).join("");
  const name = appName();
  $("#brandName").textContent = state.settings?.business?.name || "Fielora";
  document.title = state.settings?.business?.name ? `${name} · Fielora` : "Fielora";
  const logo = $("#brandLogo"); logo.hidden = !state.branding?.logo; if(state.branding?.logo) logo.src = `/api/branding/logo?v=${state.branding.v||1}`;
}
function fillTowns(){
  const towns = [...new Set(Object.values(state.customers).map(c=>c.town).filter(Boolean))].sort();
  $("#towns").innerHTML = towns.map(t=>`<option value="${esc(t)}">`).join("");
}

let toastTimer;
function toast(msg){ const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove("show"), 2600); }

/* ================= state + server ================= */
const state = { customers:{}, jobs:{}, weekStart: mondayOf(new Date()), user:null, settings:null, mail:{configured:false}, online:true, ticket:null };
const isOwner = () => state.user?.role === "owner";

async function api(method, url, body){
  const opts = { method, headers:{ "X-Requested-With":"fielora" }, credentials:"same-origin" };
  if(body !== undefined){ opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try{ res = await fetch(url, opts); }
  catch(e){ state.online = false; setStatus(); throw { status:0, error:"Can’t reach the server. Check your internet connection." }; }
  state.online = true;
  let data = {}; try{ data = await res.json(); }catch(e){}
  if(res.status === 401 && !["/api/login","/api/login/2fa","/api/password","/api/2fa/disable"].includes(url)) showAuth();
  if(res.status === 403 && data.code === "2fa_required") openAccount(true);
  if(!res.ok) throw { status:res.status, error: data.error || "Something went wrong. Try again.", code:data.code };
  return data;
}

let pendingWrites = 0;
async function put(coll, id, data){
  state[coll][id] = data; render();
  pendingWrites++;
  try{ await api("PUT", `/api/${coll}/${id}`, data); }
  catch(e){ toast(e.error || "Couldn’t save. Try again."); refresh(); }
  finally{ pendingWrites--; }
}
async function remove(coll, id){
  delete state[coll][id]; render();
  pendingWrites++;
  try{ await api("DELETE", `/api/${coll}/${id}`); }
  catch(e){ toast(e.error || "Couldn’t delete. Try again."); refresh(); }
  finally{ pendingWrites--; }
}
async function refresh(){
  if(!state.user || pendingWrites) return;
  try{
    const d = await api("GET", "/api/data");
    if(pendingWrites) return;
    state.customers = d.customers || {}; state.jobs = d.jobs || {};
    fillTowns(); render();
  }catch(e){ setStatus(); }
}
function setStatus(){
  const el = $("#storeStatus");
  if(!state.online) el.textContent = "Offline — changes won’t save until the connection is back.";
  else if(state.user) el.textContent = `Signed in as ${state.user.name || state.user.username}.` + " Changes save automatically and show up for the whole team.";
  else el.textContent = "";
}
async function loadMe(){
  const me = await api("GET","/api/me");
  state.user = me.user; state.settings = me.settings; state.mail = me.mail; state.mapTiles = me.mapTiles; state.sharepoint = me.sharepoint; state.forms = me.forms; state.branding = me.branding; state.industry = me.industry; state.presets = me.presets;
  applyRole(); applyIndustry();
  if(me.needs2faSetup){ openAccount(true); return false; }
  return true;
}
function applyRole(){
  const r = state.user?.role || "none";
  document.body.classList.remove("role-owner","role-staff");
  document.body.classList.add("role-"+r);
  setStatus();
  if(typeof renderInstallUI === "function") renderInstallUI();
}

/* ================= sign in ================= */
const authDlg = $("#authDlg");
let needsSetup = false;
function authStep(step){
  const code = step === "code";
  $("#aUserWrap").hidden = code; $("#aPassWrap").hidden = code;
  $("#aNameWrap").hidden = code || !needsSetup;
  document.querySelectorAll("#authDlg .setup-only").forEach(el=>el.hidden = code || !needsSetup);
  $("#aCodeWrap").hidden = !code; $("#aBack").hidden = !code;
  $("#authTitle").textContent = code ? "Enter your code" : (needsSetup ? "Set up Fielora" : "Sign in");
  $("#authIntro").textContent = code ? "Open your authenticator app and enter the 6-digit code for this app." : (needsSetup ? "Create the first account. You can add the rest of the team after." : "Sign in to see the schedule.");
  $("#aSubmit").textContent = code ? "Verify" : (needsSetup ? "Create account" : "Sign in");
  $("#aUser").required = !code; $("#aPass").required = !code; $("#aCode").required = code;
  $("#aError").textContent = "";
  setTimeout(()=> (code ? $("#aCode") : $("#aUser")).focus(), 30);
}
async function showAuth(){
  state.user = null; state.ticket = null; applyRole();
  try{
    const st = await api("GET","/api/setup"); needsSetup = st.needsSetup;
    if(st.presets) $("#aInd").innerHTML = st.presets.map(p=>`<option value="${p.id}"${p.id==="general"?" selected":""}>${esc(p.name)}</option>`).join("");
  }catch(e){ needsSetup = false; }
  $("#aPass").autocomplete = needsSetup ? "new-password" : "current-password";
  authStep("password");
  if(!authDlg.open) authDlg.showModal();
}
authDlg.addEventListener("cancel", e=>e.preventDefault());
$("#aBack").addEventListener("click", ()=>{ state.ticket = null; $("#aCode").value = ""; authStep("password"); });
$("#authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  $("#aSubmit").disabled = true; $("#aError").textContent = "";
  try{
    let d;
    if(state.ticket){
      d = await api("POST","/api/login/2fa",{ ticket:state.ticket, code:$("#aCode").value });
      if(typeof d.recoveryLeft === "number" && d.recoveryLeft < 3 && !/^\d{6}$/.test($("#aCode").value.trim())) setTimeout(()=>toast(`You have ${d.recoveryLeft} recovery codes left. Set up two-step login again to get new ones.`), 800);
    } else {
      d = await api("POST", needsSetup ? "/api/setup" : "/api/login", { username:$("#aUser").value, password:$("#aPass").value, name:$("#aName").value, businessName:$("#aBiz").value, industry:$("#aInd").value, homeTown:$("#aTown").value });
      if(d.needs2fa){ state.ticket = d.ticket; $("#aCode").value = ""; authStep("code"); return; }
    }
    state.ticket = null; $("#aPass").value = ""; $("#aCode").value = "";
    setPwVisible($("#aPass"), false);
    authDlg.close();
    if(await loadMe()) await refresh();
  }catch(err){
    $("#aError").textContent = err.error;
    if(err.code === "ticket_expired"){ state.ticket = null; authStep("password"); $("#aError").textContent = err.error; }
  }finally{ $("#aSubmit").disabled = false; }
});

/* ================= account ================= */
const acctDlg = $("#acctDlg");
let forced = false, tfaStage = "idle";
acctDlg.addEventListener("cancel", e=>{ if(forced) e.preventDefault(); });
function openAccount(isForced=false){
  forced = !!isForced;
  acctDlg.classList.toggle("forced", forced);
  $("#forcedNote").hidden = !forced;
  tfaStage = "idle"; renderTfa(); renderInstallUI();
  $("#pError").textContent = ""; $("#tError").textContent = ""; $("#bError").textContent = "";
  if(!forced){
    if(isOwner()){ loadTeam(); fillBiz(); renderLogo(); renderTradeForm(state.industry); }
    $("#mailStatus").innerHTML = state.mail?.configured
      ? `Service reports are emailed through Outlook from <b>${esc(state.mail.from)}</b>. A copy also goes to that mailbox.`
      : "Outlook email isn’t connected yet. Finished reports can still be opened, downloaded, or shared from a phone. The setup steps are in the README.";
  }
  if(!acctDlg.open) acctDlg.showModal();
}
function renderTfa(data){
  const el = $("#tfaBody"), on = state.user?.totpEnabled;
  if(tfaStage === "scan"){
    el.innerHTML = `<p class="hint" style="margin:0">1. Install an authenticator app on your phone (Microsoft Authenticator, Google Authenticator, or similar).<br>2. In the app, add an account and scan this code:</p>
      <div class="qr-box"><img src="${data.qr}" alt="QR code for your authenticator app"><div><p class="hint" style="margin:0 0 4px">Can’t scan? Enter this key instead:</p><div class="secret">${esc(data.secret)}</div></div></div>
      <form id="tfaEnableForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="flex:1;min-width:160px"><label for="tfaCode">3. Enter the 6-digit code it shows</label><input id="tfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></div>
        <button type="submit" class="btn primary">Turn on</button>
      </form><p class="err" id="tfaErr" role="alert"></p>`;
    $("#tfaCode").focus();
    $("#tfaEnableForm").addEventListener("submit", async e=>{
      e.preventDefault();
      try{
        const r = await api("POST","/api/2fa/enable",{ code:$("#tfaCode").value });
        state.user.totpEnabled = true; tfaStage = "codes"; renderTfa(r);
      }catch(err){ $("#tfaErr").textContent = err.error; }
    });
  } else if(tfaStage === "codes"){
    el.innerHTML = `<p style="margin:0"><span class="role-pill ok-pill">On</span> Two-step login is on.</p>
      <p class="hint" style="margin:10px 0 0"><b>Save these recovery codes</b> somewhere safe (not on the same phone). Each one works once if you lose your phone. They won’t be shown again.</p>
      <div class="codes">${data.recoveryCodes.map(c=>`<span>${esc(c)}</span>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost" id="tfaCopy">Copy codes</button><button type="button" class="btn primary" id="tfaDone">I’ve saved them</button></div>`;
    $("#tfaCopy").onclick = async ()=>{ try{ await navigator.clipboard.writeText(data.recoveryCodes.join("\n")); toast("Codes copied"); }catch(e){ toast("Couldn’t copy. Write them down instead."); } };
    $("#tfaDone").onclick = async ()=>{
      tfaStage = "idle"; renderTfa();
      if(forced){ forced = false; acctDlg.close(); acctDlg.classList.remove("forced"); if(await loadMe()) await refresh(); }
    };
  } else if(on){
    const req = state.settings?.require2fa;
    el.innerHTML = `<p style="margin:0"><span class="role-pill ok-pill">On</span> You’ll be asked for a code from your authenticator app when you sign in.</p>
      ${req ? `<p class="hint" style="margin:8px 0 0">The owner requires two-step login, so it can’t be turned off.</p>` :
      `<form id="tfaOffForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
        <div class="field" style="flex:1;min-width:160px"><label for="tfaPw">Password to turn it off</label><input id="tfaPw" type="password" autocomplete="current-password" required></div>
        <button type="submit" class="btn danger">Turn off</button></form><p class="err" id="tfaErr" role="alert"></p>`}`;
    enhancePasswords(el);
    const f = $("#tfaOffForm");
    if(f) f.addEventListener("submit", async e=>{
      e.preventDefault();
      try{ await api("POST","/api/2fa/disable",{ password:$("#tfaPw").value }); state.user.totpEnabled = false; renderTfa(); toast("Two-step login turned off"); }
      catch(err){ $("#tfaErr").textContent = err.error; }
    });
  } else {
    el.innerHTML = `<p class="hint" style="margin:0 0 10px">Adds a second step when you sign in: a 6-digit code from an app on your phone. Even if someone learns your password, they can’t get in without your phone.</p>
      <button type="button" class="btn primary" id="tfaStart">Set up two-step login</button><p class="err" id="tfaErr" role="alert"></p>`;
    $("#tfaStart").onclick = async ()=>{
      try{ const r = await api("POST","/api/2fa/setup"); tfaStage = "scan"; renderTfa(r); }
      catch(err){ $("#tfaErr").textContent = err.error; }
    };
  }
}
$("#pwForm").addEventListener("submit", async e=>{
  e.preventDefault(); $("#pError").textContent = "";
  try{ await api("POST","/api/password",{ current:$("#pCur").value, next:$("#pNew").value }); e.target.reset(); toast("Password changed. Other devices were signed out."); }
  catch(err){ $("#pError").textContent = err.error; }
});
const ROLE_LABEL = { owner:"Owner", staff:"Staff" };
async function loadTeam(){
  try{
    const { users } = await api("GET","/api/users");
    $("#teamList").innerHTML = users.map(u=>{
      const me = u.id === state.user.id;
      return `<div class="team-row"><div><b>${esc(u.name||u.username)}</b> ${me?`<span class="role-pill">You</span>`:""}<div class="hint">${esc(u.username)} · two-step login ${u.totpEnabled?"on":"off"}</div></div>
      <div class="acts">${me ? `<span class="role-pill">${ROLE_LABEL[u.role]}</span>` : `<select data-role="${u.id}" aria-label="Access for ${esc(u.username)}">${ROLE_LABEL[u.role] ? "" : `<option value="" selected disabled>No access — choose a role</option>`}${Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}"${u.role===k?" selected":""}>${v}</option>`).join("")}</select>
        ${u.totpEnabled?`<button type="button" class="btn ghost" data-reset2fa="${u.id}" data-uname="${esc(u.username)}">Reset two-step</button>`:""}
        <button type="button" class="btn ghost" data-resetpw="${u.id}" data-uname="${esc(u.username)}">Reset password</button>
        <button type="button" class="btn danger" data-rmuser="${u.id}" data-uname="${esc(u.username)}">Remove</button>`}</div></div>`;
    }).join("");
  }catch(e){ $("#teamList").innerHTML = `<p class="hint">${esc(e.error)}</p>`; }
}
$("#teamList").addEventListener("change", async e=>{
  const s = e.target.closest("[data-role]"); if(!s) return;
  try{ await api("PATCH", `/api/users/${s.dataset.role}`, { role:s.value }); toast("Access updated"); }
  catch(err){ $("#tError").textContent = err.error; loadTeam(); }
});
$("#teamList").addEventListener("click", async e=>{
  const b = e.target.closest("button"); if(!b) return; const d = b.dataset;
  try{
    if(d.rmuser){ if(!confirm(`Remove ${d.uname}? They won’t be able to sign in.`)) return; await api("DELETE", `/api/users/${d.rmuser}`); toast("Removed"); }
    else if(d.reset2fa){ if(!confirm(`Reset two-step login for ${d.uname}? Use this if they lost their phone. They’ll be signed out and can set it up again.`)) return; await api("POST", `/api/users/${d.reset2fa}/reset-2fa`); toast("Two-step login reset"); }
    else if(d.resetpw){ const pw = prompt(`New temporary password for ${d.uname} (at least 10 characters):`); if(!pw) return; await api("POST", `/api/users/${d.resetpw}/reset-password`, { password:pw }); toast("Password reset. Give them the new password."); }
    else return;
    loadTeam();
  }catch(err){ $("#tError").textContent = err.error; }
});
$("#addUserForm").addEventListener("submit", async e=>{
  e.preventDefault(); $("#tError").textContent = "";
  try{
    await api("POST","/api/users",{ name:$("#tName").value, username:$("#tUser").value, password:$("#tPass").value, role:$("#tRole").value });
    e.target.reset(); toast("Person added. Give them their username and temporary password."); loadTeam();
  }catch(err){ $("#tError").textContent = err.error; }
});
function fillBiz(){
  const s = state.settings || {}; const b = s.business || {};
  $("#bName").value = b.name || ""; $("#bPhone").value = b.phone || ""; $("#bEmail").value = b.email || ""; $("#bWeb").value = b.website || "";
  $("#bHome").value = s.homeBase?.label || ""; $("#bHome").dataset.orig = s.homeBase?.label || "";
  $("#bHomeStatus").textContent = s.homeBase ? `Set (${Number(s.homeBase.lat).toFixed(3)}, ${Number(s.homeBase.lng).toFixed(3)})` : "";
  $("#bReq2fa").checked = !!s.require2fa;
}
$("#bizForm").addEventListener("submit", async e=>{
  e.preventDefault(); $("#bError").textContent = "";
  const body = { business:{ name:$("#bName").value, phone:$("#bPhone").value, email:$("#bEmail").value, website:$("#bWeb").value }, require2fa:$("#bReq2fa").checked };
  const home = $("#bHome").value.trim();
  try{
    if(home && home !== $("#bHome").dataset.orig){
      $("#bHomeStatus").textContent = "Looking up…";
      const g = await api("GET", `/api/geocode?q=${encodeURIComponent(home + ", Ontario")}`);
      if(!g.results.length){ $("#bHomeStatus").textContent = ""; $("#bError").textContent = "Couldn’t find that home base. Try a town name."; return; }
      body.homeBase = { label:home, lat:g.results[0].lat, lng:g.results[0].lng };
    }
    const r = await api("PUT","/api/settings", body);
    state.settings = r.settings; fillBiz(); applyIndustry(); toast("Settings saved"); mapState.baseDirty = true;
  }catch(err){ $("#bError").textContent = err.error; fillBiz(); }
});
$("#logoutBtn").addEventListener("click", async ()=>{
  try{ await api("POST","/api/logout"); }catch(e){}
  forced = false; acctDlg.classList.remove("forced"); acctDlg.close();
  state.customers = {}; state.jobs = {}; render(); showAuth();
});

/* ================= derived ================= */
const custName = id => state.customers[id]?.name || "Unknown customer";
function jobsOn(dateIso){
  return Object.entries(state.jobs).filter(([,j])=>j.date===dateIso && j.status!=="cancelled")
    .sort((a,b)=> (b[1].priority==="outage") - (a[1].priority==="outage") || (a[1].time||"").localeCompare(b[1].time||""));
}
function nextDue(c){ if(!c.plan || c.plan==="none" || !c.lastService) return null; return addMonths(c.lastService, Number(c.plan)); }
function upcomingPm(cid){
  const t = todayIso();
  return Object.values(state.jobs).find(j=>j.customerId===cid && j.type==="pm" && j.status!=="done" && j.status!=="cancelled" && j.date>=t);
}
function dueRows(){
  const t = todayIso(); const out = [];
  for(const [id,c] of Object.entries(state.customers)){
    if(!c.plan || c.plan==="none") continue;
    const nd = nextDue(c);
    const days = nd ? daysBetween(t, nd) : -9999;
    if(days <= 45) out.push({id,c,nd,days,booked:upcomingPm(id)});
  }
  return out.sort((a,b)=>a.days-b.days);
}
function custStatus(id, c, weeks=8){
  if(upcomingPm(id)) return "booked";
  if(!c.plan || c.plan==="none") return "none";
  const nd = nextDue(c);
  if(!nd) return "overdue";
  const d = daysBetween(todayIso(), nd);
  if(d < 0) return "overdue";
  if(d <= weeks*7) return "soon";
  return "plan";
}
function dueText(c){
  if(!c.plan || c.plan==="none") return "No maintenance plan";
  const nd = nextDue(c); if(!nd) return "No service on record";
  const d = daysBetween(todayIso(), nd);
  return d < 0 ? `${-d} days overdue` : `Due ${fmtLongDate(nd)}`;
}

/* ================= render ================= */
function render(){
  setStatus();
  renderWeek();
  renderDue(); renderShop(); renderCustomers(); if(mapState.map && currentView()==="map") renderMap();
}
function renderWeek(){
  const ws = state.weekStart, we = new Date(ws); we.setDate(we.getDate()+6);
  const mo = d => d.toLocaleDateString("en-CA",{month:"short"});
  $("#weekTitle").textContent = ws.getMonth()===we.getMonth() ? `${mo(ws)} ${ws.getDate()}–${we.getDate()}` : `${mo(ws)} ${ws.getDate()} – ${mo(we)} ${we.getDate()}`;
  const t = todayIso(); let html = "";
  for(let i=0;i<7;i++){
    const d = new Date(ws); d.setDate(d.getDate()+i); const di = iso(d);
    const jobs = jobsOn(di);
    html += `<div class="day${di===t?" today":""}"><div class="day-head"><span class="num">${d.getDate()}</span><span class="dow">${d.toLocaleDateString("en-CA",{weekday:"long"})}</span>${state.user?`<button class="add" data-add="${di}" aria-label="Add on ${esc(fmtDate(di))}">+</button>`:""}</div><div class="day-body">`;
    if(!jobs.length) html += `<div class="day-empty">Open</div>`;
    for(const [id,j] of jobs){
      const when = j.time ? `${esc(fmtTime(j.time))}${j.duration?` · ${esc(j.duration)}h`:""}` : "All day";
      if(j.type === "busy"){
        html += `<div class="job busy" style="--c:var(--busy)"><div class="t">${when}</div><div class="n">Busy — work</div></div>`;
        continue;
      }
      if(j.type === "personal"){
        html += `<button class="job personal" style="--c:var(--personal)" data-job="${id}"><div class="t">${when} <span class="tag">Personal</span></div><div class="n">${esc(j.title||"Personal time")}</div></button>`;
        continue;
      }
      const c = state.customers[j.customerId] || {};
      const flags = (j.priority==="outage"?`<span class="flag">Outage</span>`:"") + (j.status==="parts"?`<span class="flag parts">Parts</span>`:"") + (j.formCompletedAt ? `<span class="tag">Form ✓</span>` : "");
      html += `<button class="job${j.status==="done"?" done":""}" style="--c:${TYPES[j.type]?.c||"var(--steel)"}" data-job="${id}">
        <div class="t">${when} ${flags}</div>
        <div class="n">${esc(custName(j.customerId))}</div>
        <div class="w">${esc(TYPES[j.type]?.label||"")}${c.town?" — "+esc(c.town):""}</div></button>`;
    }
    html += `</div></div>`;
  }
  $("#week").innerHTML = html;
}
function renderDue(){
  const rows = dueRows();
  const unbooked = rows.filter(r=>!r.booked).length;
  const b = $("#dueCount"); b.hidden = !unbooked; b.textContent = unbooked;
  if(!rows.length){
    const anyPlans = Object.values(state.customers).some(c=>c.plan && c.plan!=="none");
    $("#dueList").innerHTML = `<div class="empty"><p>${anyPlans?"Nobody’s maintenance is due in the next 45 days.":"Put customers on a maintenance plan and they’ll show up here when service comes due."}</p>${anyPlans?"":`<button class="btn primary" data-goto="customers">Go to customers</button>`}</div>`;
    return;
  }
  $("#dueList").innerHTML = `<div class="list">${rows.map(r=>{
    const pill = !r.nd ? `<span class="pill over">No service on record</span>`
      : r.days<0 ? `<span class="pill over">${-r.days} days overdue</span>`
      : r.days<=14 ? `<span class="pill soon">Due ${esc(fmtDate(r.nd))}</span>` : `<span class="pill">Due ${esc(fmtDate(r.nd))}</span>`;
    const gen = [r.c.brand, sizeTxt(r.c), r.c.fuel].filter(Boolean).join(", ");
    const act = r.booked ? `<span class="pill ok">Booked ${esc(fmtDate(r.booked.date))}</span>` : `<button class="btn primary" data-book="${r.id}">Book visit</button>`;
    const near = hasLoc(r.c) ? `<button class="btn ghost" data-planfrom="${r.id}">Nearby</button>` : "";
    return `<div class="row"><div class="main"><div class="name">${esc(r.c.name)}</div><div class="sub">${esc([r.c.town, gen].filter(Boolean).join(" — "))}</div></div><div class="acts">${pill}${near}${act}</div></div>`;
  }).join("")}</div>`;
}
function renderShop(){
  const items = Object.entries(state.jobs).filter(([,j])=>j.type==="portable" && j.status!=="cancelled" && (j.stage||"pickup")!=="returned");
  const c = $("#shopCount"); c.hidden = !items.length; c.textContent = items.length;
  const nextStage = {pickup:"shop",shop:"ready",ready:"returned"}, nextLabel = {pickup:"Mark picked up",shop:"Mark ready",ready:"Mark returned"};
  $("#shopBoard").innerHTML = ["pickup","shop","ready"].map(st=>{
    const cards = items.filter(([,j])=>(j.stage||"pickup")===st);
    return `<div class="lane"><h2>${STAGES[st]} (${cards.length})</h2>${cards.length?cards.map(([id,j])=>{
      const cu = state.customers[j.customerId]||{};
      return `<div class="card"><div class="name">${esc(cu.name||"Unknown customer")}</div><div class="sub">${esc([cu.brand,cu.model,cu.town].filter(Boolean).join(", "))}${j.notes?"<br>"+esc(j.notes):""}</div><div class="acts"><button class="btn primary" data-stage="${id}" data-to="${nextStage[st]}">${nextLabel[st]}</button><button class="btn ghost" data-job="${id}">Open</button></div></div>`;
    }).join(""):`<p class="hint" style="margin:4px">Nothing here.</p>`}</div>`;
  }).join("");
}
function renderCustomers(){
  const q = $("#custSearch").value.trim().toLowerCase();
  const list = Object.entries(state.customers).filter(([,c])=>!q || [c.name,c.town,c.model,c.brand,c.serial,c.phone,c.address,c.postal,c.email,...Object.values(c.extra||{})].join(" ").toLowerCase().includes(q))
    .sort((a,b)=>a[1].name.localeCompare(b[1].name));
  if(!Object.keys(state.customers).length){ $("#custList").innerHTML = `<div class="empty"><p>Add your first customer and their ${esc(eqLower())} to start booking jobs.</p><button class="btn primary" data-newcust>Add customer</button></div>`; return; }
  if(!list.length){ $("#custList").innerHTML = `<div class="empty"><p>No customers match “${esc(q)}”.</p></div>`; return; }
  $("#custList").innerHTML = `<div class="list">${list.map(([id,c])=>{
    const gen = [c.brand,c.model,sizeTxt(c),c.fuel].filter(Boolean).join(", ");
    const nd = nextDue(c);
    const plan = c.plan && c.plan!=="none" ? (nd ? `<span class="pill">Next service ${esc(fmtDate(nd))}</span>` : `<span class="pill">On plan</span>`) : "";
    const mapsQ = encodeURIComponent(hasLoc(c) ? `${c.lat},${c.lng}` : [c.address,c.town,"ON"].filter(Boolean).join(", "));
    return `<div class="row"><div class="main"><div class="name">${esc(c.name)}${hasLoc(c)?"":` <span class="tag" title="Open the customer to place them on the map">No map pin</span>`}</div><div class="sub">${esc([c.town,gen].filter(Boolean).join(" — ")||`No ${eqLower()} details yet`)}</div>
      <div class="sub">${c.phone?`<a href="tel:${esc(c.phone.replace(/[^0-9+]/g,""))}">${esc(c.phone)}</a>`:""}${c.phone&&c.address?" · ":""}${c.address?`<a href="https://www.google.com/maps/search/?api=1&query=${mapsQ}" target="_blank" rel="noopener">${esc(c.address)}</a>`:""}</div></div>
      <div class="acts">${plan}<button class="btn ghost" data-bookany="${id}">Book job</button><button class="btn ghost" data-editcust="${id}">Edit</button></div></div>`;
  }).join("")}</div>`;
}

/* ================= someone-else-is-editing warnings ================= */
const TAB_ID = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,"") : newId()+newId());
const locks = { jobs:{id:null,version:null,timer:null,banner:"#jLock",noun:"item"}, customers:{id:null,version:null,timer:null,banner:"#cLock",noun:"customer"} };
function showLockBanner(coll, others){
  const L = locks[coll], el = $(L.banner);
  if(!others || !others.length){ el.hidden = true; return; }
  const since = fmtClock(Math.min(...others.map(o=>o.since)));
  const people = others.filter(o=>!o.self).map(o=>o.name);
  let title = people.length ? `${people.join(" and ")} ${people.length>1?"have":"has"} this ${L.noun} open right now` : `You have this ${L.noun} open in another window or device`;
  if(people.length && others.some(o=>o.self)) title += " (and you do in another window)";
  el.querySelector("b").textContent = title;
  el.querySelector("span:not(.ico)").textContent = `If you both make changes, any information you add may be lost when the other person saves. ${people.length?"Check with them before editing.":"Close the other one before editing."} (Opened at ${since})`;
  el.hidden = false;
}
async function lockOpen(coll, id, noun){
  const L = locks[coll]; await lockClose(coll);
  L.id = id; L.version = null; if(noun) L.noun = noun; $(L.banner).hidden = true;
  if(!id) return;
  try{ const r = await api("POST", `/api/locks/${coll}/${id}`, { tab:TAB_ID, open:true }); if(L.id !== id) return; L.version = r.version; showLockBanner(coll, r.others); }catch(e){}
  L.timer = setInterval(async ()=>{ try{ const r = await api("POST", `/api/locks/${coll}/${id}`, { tab:TAB_ID }); if(L.id===id) showLockBanner(coll, r.others); }catch(e){} }, 15000);
}
async function lockClose(coll){
  const L = locks[coll];
  if(L.timer){ clearInterval(L.timer); L.timer = null; }
  const id = L.id; L.id = null; L.version = null;
  if(id){ try{ await api("DELETE", `/api/locks/${coll}/${id}?tab=${TAB_ID}`); }catch(e){} }
}
window.addEventListener("pagehide", ()=>{
  for(const [coll,L] of Object.entries(locks)) if(L.id && navigator.sendBeacon) navigator.sendBeacon(`/api/locks/${coll}/${L.id}/release?tab=${TAB_ID}`);
});
async function confirmNoConflict(coll, id){
  const L = locks[coll];
  if(!id || L.id!==id) return true;
  let r; try{ r = await api("POST","/api/check-conflict",{ coll, id, version:L.version }); }catch(e){ return true; }
  if(!r.changed) return true;
  if(r.deleted) return confirm(`This ${L.noun} was deleted by someone else while you had it open.\n\nSave it anyway? It will be put back with your changes.`);
  return confirm(`Someone else saved changes to this ${L.noun} while you had it open.\n\nIf you save now, their changes will be replaced with yours and lost.\n\nPress OK to save yours anyway, or Cancel to close without saving so you can reopen it and see their version.`);
}

/* ================= job dialog ================= */
let editingJob = null;
const jobDlg = $("#jobDlg");
function fillCustomerSelect(selected){
  const opts = Object.entries(state.customers).sort((a,b)=>a[1].name.localeCompare(b[1].name));
  $("#jCustomer").innerHTML = `<option value="">Choose a customer…</option>` + opts.map(([id,c])=>`<option value="${id}"${id===selected?" selected":""}>${esc(c.name)}${c.town?" — "+esc(c.town):""}</option>`).join("");
  showCustCard();
}
function formRecs(f){ if(!f) return ""; if(f.snapshot){ const fl = allFields(f.snapshot).find(x=>x.id==="recommendations"||/recommend/i.test(x.label)); return fl ? String(f.values?.[fl.id]||"") : ""; } return f.recommendations||""; }
function genLine(c){ return [c.equipmentType,c.brand,c.model,sizeTxt(c),c.fuel].filter(Boolean).join(", "); }
function showCustCard(){
  const c = state.customers[$("#jCustomer").value]; const el = $("#jCustCard");
  if(!c || selectedType()==="personal"){ el.hidden = true; return; }
  el.innerHTML = `<b>${esc(c.name)}</b><br>${esc([c.address,c.town].filter(Boolean).join(", "))}${c.phone?" · "+esc(c.phone):""}<br>${esc(genLine(c)||`No ${eqLower()} details`)}${c.serial?" · S/N "+esc(c.serial):""}${c.notes?"<br>"+esc(c.notes):""}`;
  el.hidden = false;
}
function selectedType(){ return (document.querySelector('#jType input:checked')||{}).value || "pm"; }
function syncTypeFields(){
  const isEdit = !!editingJob, t = selectedType(), personal = t === "personal";
  $("#jTitleWrap").hidden = !personal; $("#jCustWrap").hidden = personal; $("#jPriorityWrap").hidden = personal;
  $("#jAllDayWrap").hidden = !personal;
  $("#jNotesLabel").textContent = personal ? "Notes (optional)" : "What’s the job?";
  $("#jNotes").placeholder = personal ? "" : "Symptoms, parts to bring, gate code…";
  $("#jStatusWrap").hidden = !isEdit || personal;
  $("#jStageWrap").hidden = t!=="portable";
  $("#jReportWrap").hidden = !isEdit || personal;
  $("#jFormBox").hidden = !isEdit || personal;
  $("#jTime").disabled = jobReadOnly || (personal && $("#jAllDay").checked);
  showCustCard();
  if(!$("#jFormBox").hidden) syncFormBox();
}
function syncFormBox(){
  const j = state.jobs[editingJob] || {};
  let txt = "Not started";
  if(j.formCompletedAt) txt = `Finished ${fmtLongDate(j.formCompletedAt.slice(0,10))}` + (j.formSentAt ? ` · emailed to ${j.formSentTo}` : " · not emailed");
  else if(j.form) txt = "Draft saved";
  $("#jFormStatus").textContent = txt;
  $("#jFormBtn").textContent = j.formCompletedAt ? "Open form" : (j.form ? "Continue form" : "Start service form");
  const link = $("#jPdfLink"); link.hidden = !j.form; link.href = `/api/jobs/${editingJob}/report.pdf`;
}
let jobReadOnly = false;
function openJob(id, preset={}){
  editingJob = id || null;
  jobReadOnly = false;
  const base = {type: "pm", date:todayIso(), time:"09:00", duration: 2, priority:"normal", notes:"", status:"booked", stage:"pickup", report:"", title:""};
  const j = id ? state.jobs[id] : Object.assign(base, preset);
  $("#jobDlgTitle").textContent = jobReadOnly ? "Appointment" : j.type==="personal" ? (id ? "Personal time" : "Add personal time") : (id ? "Edit job" : "New job");
  $("#jTypeWrap").hidden = false;
  fillCustomerSelect(j.customerId);
  if(![...document.querySelectorAll('#jType input')].some(r=>r.value===j.type) && j.type){ $("#jType").insertAdjacentHTML("afterbegin", `<label><input type="radio" name="type" value="${j.type}"> ${esc(TYPES[j.type]?.label||j.type)}</label>`); }
  document.querySelectorAll('#jType input').forEach(r=>r.checked = r.value===j.type);
  $("#jTitle").value = j.title || "";
  $("#jDate").value = j.date; $("#jAllDay").checked = j.type==="personal" && !j.time;
  $("#jTime").value = j.time || "09:00"; $("#jDur").value = j.duration||"";
  $("#jPriority").value = j.priority||"normal"; $("#jNotes").value = j.notes||"";
  $("#jStatus").value = j.status||"booked"; $("#jStage").value = j.stage||"pickup"; $("#jReport").value = j.report||"";
  $("#jDelete").hidden = !id || jobReadOnly;
  $("#jSave").hidden = jobReadOnly;
  jobDlg.querySelectorAll(".dlg-body input, .dlg-body select, .dlg-body textarea").forEach(el=>{ el.disabled = jobReadOnly; });
  $("#jAddCust").parentElement.hidden = false;
  syncTypeFields();
  if(jobReadOnly){ $("#jReportWrap").hidden = true; $("#jFormBox").hidden = true; }
  jobDlg.showModal();
  if(!jobReadOnly) lockOpen("jobs", editingJob, j.type==="personal" ? "personal time" : "job");
}
jobDlg.addEventListener("close", ()=>lockClose("jobs"));
$("#jType").addEventListener("change", ()=>{ $("#jobDlgTitle").textContent = selectedType()==="personal" ? "Personal time" : (editingJob?"Edit job":"New job"); syncTypeFields(); });
$("#jAllDay").addEventListener("change", syncTypeFields);
$("#jCustomer").addEventListener("change", showCustCard);

// Validates and saves the job dialog. Returns the id, or null if it didn't save.
async function saveJobDialog(){
  const type = selectedType();
  const personal = type === "personal";
  const customerId = personal ? null : $("#jCustomer").value;
  if(!personal && !customerId){ $("#jCustomer").focus(); toast("Choose a customer for this job."); return null; }
  if(personal && !$("#jTitle").value.trim()){ $("#jTitle").focus(); toast("Say what the personal time is for."); return null; }
  if(!$("#jDate").value){ $("#jDate").focus(); return null; }
  const prev = editingJob ? state.jobs[editingJob] : null;
  const job = Object.assign({}, prev || {}, {
    type, date:$("#jDate").value, time: personal && $("#jAllDay").checked ? "" : $("#jTime").value,
    duration:Number($("#jDur").value)||0, notes:$("#jNotes").value.trim(), createdAt: prev?.createdAt || Date.now()
  });
  if(personal){
    Object.assign(job, { title:$("#jTitle").value.trim(), status:"booked", priority:"normal" });
    delete job.customerId; delete job.stage;
    if(!prev) job.createdBy = state.user?.name || state.user?.username;
  } else {
    Object.assign(job, { customerId, priority:$("#jPriority").value, status: editingJob ? $("#jStatus").value : "booked",
      stage: type==="portable" ? $("#jStage").value : null, report: editingJob ? $("#jReport").value.trim() : "" });
    delete job.title;
    if(type==="portable" && job.stage==="returned" && job.status!=="cancelled") job.status = "done";
  }
  if(editingJob && !(await confirmNoConflict("jobs", editingJob))){ jobDlg.close(); return null; }
  const id = editingJob || newId();
  await put("jobs", id, job);
  if(!personal && job.type==="pm" && job.status==="done" && (!prev || prev.status!=="done")){
    const c = state.customers[customerId];
    if(c && (!c.lastService || c.lastService < job.date)) put("customers", customerId, Object.assign({}, c, {lastService: job.date}));
  }
  return id;
}
$("#jobForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const wasEdit = !!editingJob, personal = selectedType()==="personal";
  const id = await saveJobDialog(); if(!id) return;
  jobDlg.close();
  toast(personal ? "Personal time saved" : (wasEdit ? "Job saved" : "Job booked"));
});
$("#jDelete").addEventListener("click", ()=>{
  if(!editingJob) return;
  const busy = !$("#jLock").hidden;
  if(!confirm((busy ? "Someone else has this open right now. " : "") + "Delete it? This can’t be undone.")) return;
  remove("jobs", editingJob); jobDlg.close(); toast("Deleted");
});
$("#jAddCust").addEventListener("click", e=>{ e.preventDefault(); openCust(null, true); });
$("#jFormBtn").addEventListener("click", async ()=>{
  const id = await saveJobDialog(); if(!id) return;
  jobDlg.close(); openForm(id);
});

/* ================= service form ================= */
const formDlg = $("#formDlg");
let fJob = null, fNextTouched = false, fPdfBlob = null, fTpl = null;
const tplFor = type => { const F = state.forms; if(!F) return null; return F.templates.find(t=>t.id===F.assign?.[type]) || F.templates[0]; };
const allFields = tpl => (tpl?.sections||[]).flatMap(sec=>sec.fields);
// Older forms (saved before custom forms) are mapped onto the current design.
function legacyValues(f, tpl){
  const v = {};
  for(const k of ["runHours","batteryVoltage","outputVoltage","frequency","workDone","parts","recommendations"]) if(f[k]) v[k] = f[k];
  for(const it of f.items||[]){ const fl = allFields(tpl).find(x=>x.type==="check" && x.label===it.label); if(fl) v[fl.id] = { result:it.result||"", note:it.note||"" }; }
  return v;
}
function fieldHtml(f, v){
  const req = f.required ? ' <span aria-hidden="true" style="color:var(--outage)">*</span>' : "";
  const id = `ff_${f.id}`, help = f.help ? `<span class="hint">${esc(f.help)}</span>` : "";
  if(f.type === "check"){
    const val = v || {};
    return `<div class="chk-row" data-fid="${esc(f.id)}"><label for="${id}">${esc(f.label)}${req}</label>
      <select id="${id}" data-kind="result">${["","OK","Done","Needs attention","N/A"].map(r=>`<option value="${r}"${val.result===r?" selected":""}>${r||"—"}</option>`).join("")}</select>
      <input data-kind="note" value="${esc(val.note||"")}" placeholder="Note" aria-label="Note for ${esc(f.label)}"></div>`;
  }
  if(f.type === "textarea") return `<div class="field full" data-fid="${esc(f.id)}"><label for="${id}">${esc(f.label)}${req}</label><textarea id="${id}">${esc(v||"")}</textarea>${help}</div>`;
  let input;
  if(f.type === "select") input = `<select id="${id}"><option value="">—</option>${f.options.map(o=>`<option${v===o?" selected":""}>${esc(o)}</option>`).join("")}</select>`;
  else if(f.type === "yesno") input = `<select id="${id}"><option value="">—</option><option${v==="Yes"?" selected":""}>Yes</option><option${v==="No"?" selected":""}>No</option></select>`;
  else if(f.type === "date") input = `<input type="date" id="${id}" value="${esc(v||"")}">`;
  else if(f.type === "number") input = `<input id="${id}" inputmode="decimal" value="${esc(v||"")}">`;
  else input = `<input id="${id}" value="${esc(v||"")}">`;
  return `<div class="field" data-fid="${esc(f.id)}"><label for="${id}">${esc(f.label)}${f.unit?` (${esc(f.unit)})`:""}${req}</label>${input}${help}</div>`;
}
function renderFormFields(tpl, values){
  fTpl = tpl;
  $("#fDyn").innerHTML = (tpl?.sections||[]).map((sec,si)=>{
    if(!sec.fields.length) return "";
    const hasChecks = sec.fields.some(f=>f.type==="check");
    // keep short fields in pairs: pad with an empty cell before full-width items when needed
    let html = `<h3 class="sub-h">${esc(sec.title||"")}</h3>` + (hasChecks ? `<div class="quick"><button type="button" class="btn ghost" data-allok="${si}">Mark the rest OK</button></div>` : "");
    let col = 0;
    for(const f of sec.fields){
      const full = f.type === "check" || f.type === "textarea";
      if(full && col % 2 === 1){ html += `<div class="field"></div>`; col++; }
      html += fieldHtml(f, values[f.id]);
      if(!full) col++;
    }
    return html;
  }).join("");
  colorSelects();
}
function readFormValues(){
  const out = {};
  for(const f of allFields(fTpl)){
    const el = $("#fDyn").querySelector(`[data-fid="${CSS.escape(f.id)}"]`); if(!el) continue;
    if(f.type === "check"){ const r = el.querySelector('[data-kind="result"]').value, n = el.querySelector('[data-kind="note"]').value.trim(); if(r||n) out[f.id] = { result:r, note:n }; }
    else { const x = el.querySelector("input,select,textarea").value.trim(); if(x) out[f.id] = x; }
  }
  return out;
}
function openForm(id){
  const j = state.jobs[id]; if(!j) return;
  fJob = id; fNextTouched = false; fPdfBlob = null;
  const c = state.customers[j.customerId] || {};
  const f = j.form || {};
  const tpl = f.snapshot || tplFor(j.type);
  if(!tpl){ toast("Service forms aren’t loaded yet. Try again in a moment."); return; }
  $("#formTitle").textContent = tpl.title || `${TYPES[j.type]?.label || "Service"} form`;
  $("#fCustCard").innerHTML = `<b>${esc(c.name||"Unknown customer")}</b><br>${esc([c.address,c.town].filter(Boolean).join(", "))}<br>${esc(genLine(c)||`No ${eqLower()} details`)}${c.serial?" · S/N "+esc(c.serial):""}`;
  const done = !!j.formCompletedAt;
  const choices = state.forms?.templates || [];
  $("#fTplWrap").hidden = done || choices.length < 2;
  $("#fTpl").innerHTML = choices.map(t=>`<option value="${esc(t.id)}"${t.id===tpl.id?" selected":""}>${esc(t.name)}</option>`).join("") + (f.snapshot && !choices.some(t=>t.id===tpl.id) ? `<option value="__saved" selected>${esc(tpl.name||"Saved form")}</option>` : "");
  $("#fDate").value = f.serviceDate || (j.date <= todayIso() ? j.date : todayIso());
  $("#fNext").value = f.nextService || calcNext(c, $("#fDate").value);
  $("#fEmail").value = f.emailTo || c.email || "";
  renderFormFields(tpl, f.snapshot ? (f.values||{}) : legacyValues(f, tpl));
  $("#fSend").checked = !done && !!state.mail?.configured;
  $("#fSend").disabled = !state.mail?.configured;
  $("#fMailHint").textContent = state.mail?.configured ? `Sent through Outlook from ${state.mail.from}, with a copy to that mailbox.` : "Outlook email isn’t connected yet. When you finish, you can open, download or share the PDF from your phone.";
  $("#fFinish").textContent = done ? "Update report" : "Finish";
  $("#fError").textContent = "";
  $("#fDone").hidden = true; $("#formFoot").hidden = false;
  $("#formBody").classList.remove("is-done");
  formDlg.showModal();
  if(done) showDonePanel({ completed:true, sent:!!j.formSentAt, already:true });
}
$("#fTpl").addEventListener("change", ()=>{
  const t = state.forms.templates.find(x=>x.id===$("#fTpl").value); if(!t) return;
  const keep = readFormValues(); renderFormFields(t, keep); $("#formTitle").textContent = t.title || t.name;
});
function calcNext(c, serviceDate){ return c.plan && c.plan!=="none" && serviceDate ? addMonths(serviceDate, Number(c.plan)) : ""; }
function colorSelects(){ document.querySelectorAll('#fDyn [data-kind="result"]').forEach(s=>{ s.classList.toggle("attn", s.value==="Needs attention"); s.classList.toggle("good", s.value==="OK"||s.value==="Done"); }); }
$("#fDyn").addEventListener("change", colorSelects);
$("#fDyn").addEventListener("click", e=>{
  const b = e.target.closest("[data-allok]"); if(!b) return;
  const sec = fTpl.sections[Number(b.dataset.allok)];
  for(const f of sec.fields.filter(x=>x.type==="check")){ const s = $("#fDyn").querySelector(`[data-fid="${CSS.escape(f.id)}"] [data-kind="result"]`); if(s && !s.value) s.value = "OK"; }
  colorSelects();
});
$("#fNext").addEventListener("input", ()=>{ fNextTouched = true; });
$("#fDate").addEventListener("change", ()=>{ if(fNextTouched) return; const j = state.jobs[fJob]; $("#fNext").value = calcNext(state.customers[j?.customerId]||{}, $("#fDate").value); });
function collectForm(){
  return { templateId:fTpl.id, snapshot:fTpl, values:readFormValues(), serviceDate:$("#fDate").value, nextService:$("#fNext").value, emailTo:$("#fEmail").value.trim() };
}
$("#fDraft").addEventListener("click", async ()=>{
  $("#fError").textContent = "";
  try{ await api("POST", `/api/jobs/${fJob}/report`, { form:collectForm(), complete:false }); toast("Draft saved"); await refresh(); }
  catch(err){ $("#fError").textContent = err.error; }
});
$("#svcForm").addEventListener("submit", async e=>{
  e.preventDefault(); $("#fError").textContent = "";
  const form = collectForm(), send = $("#fSend").checked && !!state.mail?.configured;
  const missing = allFields(fTpl).filter(f=>f.required && !form.values[f.id]);
  if(missing.length){
    $("#fError").textContent = `Fill in the required field${missing.length>1?"s":""}: ${missing.slice(0,5).map(f=>f.label).join(", ")}${missing.length>5?"…":""}`;
    $("#fDyn").querySelector(`[data-fid="${CSS.escape(missing[0].id)}"] input, [data-fid="${CSS.escape(missing[0].id)}"] select, [data-fid="${CSS.escape(missing[0].id)}"] textarea`)?.focus();
    return;
  }
  if(send && !form.emailTo){ $("#fEmail").focus(); $("#fError").textContent = "Enter the customer’s email, or untick “Email the PDF report”."; return; }
  if(!Object.keys(form.values).length && !confirm("Nothing on the form is filled in. Finish anyway?")) return;
  $("#fFinish").disabled = true; $("#fFinish").textContent = send ? "Sending…" : "Saving…";
  try{
    const r = await api("POST", `/api/jobs/${fJob}/report`, { form, complete:true, send });
    await refresh();
    showDonePanel(r);
    if(r.sent) toast(`Report emailed to ${form.emailTo}`);
  }catch(err){ $("#fError").textContent = err.error; }
  finally{ $("#fFinish").disabled = false; $("#fFinish").textContent = "Update report"; }
});
async function showDonePanel(r){
  const j = state.jobs[fJob] || {}, c = state.customers[j.customerId] || {};
  const pdfUrl = `/api/jobs/${fJob}/report.pdf`;
  const canShare = !!(navigator.canShare && window.File);
  const msg = r.already ? (j.formSentAt ? `This report was finished and emailed to ${esc(j.formSentTo)} on ${esc(fmtLongDate(j.formSentAt.slice(0,10)))}.` : "This report is finished but hasn’t been emailed.")
    : r.sent ? `Done. The job is marked complete and the report was emailed to <b>${esc($("#fEmail").value)}</b>.`
    : r.sendError ? `The job is marked complete, but the email didn’t go out: ${esc(r.sendError)}`
    : "Done. The job is marked complete" + (j.type==="pm" ? " and the next service date is updated." : ".");
  const el = $("#fDone");
  el.innerHTML = `<div>${msg}</div>
    <div class="acts">
      <a class="btn primary" href="${pdfUrl}" target="_blank" rel="noopener" style="text-decoration:none">Open PDF</a>
      ${canShare ? `<button type="button" class="btn ghost" id="fShare">Share PDF…</button>` : `<a class="btn ghost" href="${pdfUrl}?download=1" style="text-decoration:none">Download PDF</a>`}
      ${state.mail?.configured ? `<button type="button" class="btn ghost" id="fResendBtn">${j.formSentAt||r.sent?"Send again":"Email it now"}</button>` : ""}
      <button type="button" class="btn ghost" id="fEditAgain">Edit form</button>
    </div>
    <div id="fResendBox" hidden style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div class="field" style="flex:1;min-width:180px"><label for="fResendTo">Send to</label><input id="fResendTo" type="email" multiple value="${esc($("#fEmail").value || c.email || "")}"></div>
      <button type="button" class="btn primary" id="fResendGo">Send</button>
    </div>
    ${canShare ? `<p class="hint" style="margin:0">On a phone, “Share PDF” lets you pick Outlook or Mail to send it yourself.</p>` : ""}`;
  $("#formBody").classList.add("is-done");
  el.hidden = false; $("#formFoot").hidden = true;
  $("#fEditAgain").onclick = ()=>{ $("#formBody").classList.remove("is-done"); el.hidden = true; $("#formFoot").hidden = false; $("#fSend").checked = false; $("#fTplWrap").hidden = true; };
  const rb = $("#fResendBtn");
  if(rb){
    rb.onclick = ()=>{ const b = $("#fResendBox"); b.hidden = !b.hidden; b.style.display = b.hidden ? "none" : "flex"; $("#fResendTo").focus(); };
    $("#fResendBox").style.display = "none";
    $("#fResendGo").onclick = async ()=>{
      $("#fResendGo").disabled = true;
      try{ await api("POST", `/api/jobs/${fJob}/report/send`, { to:$("#fResendTo").value }); toast(`Report emailed to ${$("#fResendTo").value}`); await refresh(); $("#fResendBox").style.display = "none"; }
      catch(err){ toast(err.error); }
      finally{ $("#fResendGo").disabled = false; }
    };
  }
  if(canShare){
    // Fetch the PDF now so the share sheet opens straight from the tap (phones require that).
    try{ const res = await fetch(pdfUrl, { credentials:"same-origin" }); if(res.ok) fPdfBlob = await res.blob(); }catch(e){}
    const sb = $("#fShare");
    if(sb) sb.onclick = async ()=>{
      if(!fPdfBlob){ window.open(pdfUrl, "_blank"); return; }
      const name = `Service-report-${(c.name||"customer").replace(/[^a-z0-9]+/gi,"-")}-${(j.form?.serviceDate||j.date)}.pdf`;
      const file = new File([fPdfBlob], name, { type:"application/pdf" });
      if(!navigator.canShare({ files:[file] })){ window.open(pdfUrl, "_blank"); return; }
      try{ await navigator.share({ files:[file], title:"Service report", text:`Your service report from ${appName()}.` }); }
      catch(e){ /* user cancelled */ }
    };
  }
}

/* ================= customer dialog ================= */
let editingCust = null, returnToJob = false, cGeo = null, cMap = null, cMarker = null;
const custDlg = $("#custDlg");
const CF = {name:"#cName",phone:"#cPhone",email:"#cEmail",address:"#cAddress",town:"#cTown",equipmentType:"#cEtype",brand:"#cBrand",model:"#cModel",serial:"#cSerial",kw:"#cKw",fuel:"#cFuel",plan:"#cPlan",lastService:"#cLast",notes:"#cNotes"};
function homeBase(){
  const h = state.settings?.homeBase;
  if(h && isFinite(h.lat)) return { lat:Number(h.lat), lng:Number(h.lng), label:h.label||"Home base" };
  const pts = Object.values(state.customers).filter(hasLoc);   // not set yet: centre on customers, or a default
  if(pts.length) return { lat:pts.reduce((a,c)=>a+Number(c.lat),0)/pts.length, lng:pts.reduce((a,c)=>a+Number(c.lng),0)/pts.length, label:"not set — add it in Account" };
  return { lat:43.6532, lng:-79.3832, label:"not set — add it in Account" };
}
function tileLayer(){
  const custom = state.mapTiles;
  if(custom && custom.url) return L.tileLayer(custom.url, { maxZoom:19, attribution:custom.attribution || "", referrerPolicy:"strict-origin-when-cross-origin" });
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:19, referrerPolicy:"strict-origin-when-cross-origin", attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
}
function setCustPin(lat, lng, status){
  cGeo = { lat, lng };
  if(!cMarker){ cMarker = L.marker([lat,lng], { draggable:true }).addTo(cMap); cMarker.on("dragend", ()=>{ const p = cMarker.getLatLng(); cGeo = { lat:+p.lat.toFixed(6), lng:+p.lng.toFixed(6) }; $("#cGeoStatus").textContent = "Pin placed by hand"; }); }
  else cMarker.setLatLng([lat,lng]);
  $("#cGeoStatus").textContent = status || "On the map";
}
function initCustMap(){
  if(cMap || !window.L) return;
  L.Icon.Default.imagePath = "/vendor/leaflet/images/";
  cMap = L.map("cMap", { scrollWheelZoom:false }); tileLayer().addTo(cMap);
  cMap.on("click", e=>{ setCustPin(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6), "Pin placed by hand"); });
}
async function geocodeCustomer(){
  const addr = $("#cAddress").value.trim(), town = $("#cTown").value.trim();
  if(!addr && !town){ toast("Enter an address or town first."); return false; }
  $("#cGeoStatus").textContent = "Looking up…";
  try{
    const postal = editingCust ? (state.customers[editingCust]?.postal || "") : "";
    let r = await api("GET", `/api/geocode?q=${encodeURIComponent([addr, town, postal, "Ontario"].filter(Boolean).join(", "))}`);
    if(r.results.length){ const g = r.results[0]; setCustPin(g.lat, g.lng, "Found — check the pin is on the right property"); cMap?.setView([g.lat,g.lng], 15); return true; }
    if(town){
      r = await api("GET", `/api/geocode?q=${encodeURIComponent(town + ", Ontario")}`);
      if(r.results.length){ const g = r.results[0]; setCustPin(g.lat, g.lng, "Couldn’t find the street address — placed in the town. Drag the pin to the exact spot."); cMap?.setView([g.lat,g.lng], 13); return true; }
    }
    $("#cGeoStatus").textContent = `Address not found. Click the map where the ${eqLower()} is.`;
  }catch(e){ $("#cGeoStatus").textContent = e.error || "Lookup failed. Click the map to place the pin."; }
  return false;
}
$("#cGeoBtn").addEventListener("click", geocodeCustomer);
function openCust(id, fromJob=false){
  editingCust = id || null; returnToJob = fromJob;
  const c = id ? state.customers[id] : {plan:"none"};
  $("#custDlgTitle").textContent = id ? "Edit customer" : "Add customer";
  for(const [k,s] of Object.entries(CF)) $(s).value = c[k] ?? (k==="plan"?"none":"");
  $("#cDelete").hidden = !id;
  const extra = Object.entries(c.extra || {});
  $("#cExtraTitle").hidden = !extra.length && !c.postal; $("#cExtra").hidden = !extra.length && !c.postal;
  $("#cExtra").innerHTML = (c.postal ? `<dt>Postal code</dt><dd>${esc(c.postal)}</dd>` : "") + extra.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  // history
  const hist = id ? Object.entries(state.jobs).filter(([,j])=>j.customerId===id && j.type!=="personal").sort((a,b)=>b[1].date.localeCompare(a[1].date)) : [];
  $("#cHistTitle").hidden = !hist.length; $("#cHistory").hidden = !hist.length;
  $("#cHistory").innerHTML = hist.map(([jid,j])=>`<div class="row"><div class="main"><div class="name">${esc(fmtLongDate(j.date))} · ${esc(TYPES[j.type]?.label||"")}</div><div class="sub">${esc(j.status==="done"?"Done":j.status==="cancelled"?"Cancelled":"Booked")}${formRecs(j.form)?" · "+esc(formRecs(j.form).slice(0,80)):""}</div></div><div class="acts">${j.form?`<a class="btn ghost" href="/api/jobs/${jid}/report.pdf" target="_blank" rel="noopener" style="text-decoration:none">Report</a>`:""}<button type="button" class="btn ghost" data-histjob="${jid}">Open</button></div></div>`).join("");
  custDlg.showModal(); $("#cName").focus();
  initCustMap();
  cGeo = null; if(cMarker){ cMarker.remove(); cMarker = null; }
  if(cMap){
    setTimeout(()=>{
      cMap.invalidateSize();
      if(hasLoc(c)){ setCustPin(Number(c.lat), Number(c.lng)); cMap.setView([c.lat,c.lng], 15); }
      else { const h = homeBase(); cMap.setView([h.lat,h.lng], 10); $("#cGeoStatus").textContent = "Not on the map yet"; }
    }, 60);
  }
  lockOpen("customers", editingCust, "customer");
}
$("#cHistory").addEventListener("click", e=>{ const b = e.target.closest("[data-histjob]"); if(!b) return; custDlg.close(); openJob(b.dataset.histjob); });
custDlg.addEventListener("close", ()=>lockClose("customers"));
$("#custForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const name = $("#cName").value.trim(); if(!name){ $("#cName").focus(); return; }
  const prev = editingCust ? state.customers[editingCust] : {};
  const c = Object.assign({}, prev, {createdAt: prev.createdAt || Date.now()});
  for(const [k,s] of Object.entries(CF)) c[k] = k==="kw" ? (Number($(s).value)||"") : $(s).value.trim();
  c.name = name;
  const addrChanged = (prev.address||"") !== c.address || (prev.town||"") !== c.town;
  if(!cGeo && (c.address || c.town) && (addrChanged || !hasLoc(prev))) await geocodeCustomer();
  if(cGeo){ c.lat = cGeo.lat; c.lng = cGeo.lng; } else { delete c.lat; delete c.lng; }
  if(editingCust && !(await confirmNoConflict("customers", editingCust))){ custDlg.close(); return; }
  const id = editingCust || newId();
  put("customers", id, c);
  custDlg.close(); toast(editingCust ? "Customer saved" : "Customer added" + (cGeo ? "" : " — not on the map yet"));
  if(returnToJob){ fillCustomerSelect(id); }
});
$("#cDelete").addEventListener("click", ()=>{
  if(!editingCust) return;
  const n = Object.values(state.jobs).filter(j=>j.customerId===editingCust).length;
  const busy = !$("#cLock").hidden ? "Someone else has this customer open right now. " : "";
  if(!confirm(busy + (n ? `Delete this customer? Their ${n} job${n>1?"s":""} will stay on the schedule as “Unknown customer”.` : "Delete this customer?"))) return;
  remove("customers", editingCust); custDlg.close(); toast("Customer deleted");
});

/* ================= map ================= */
const mapState = { map:null, layer:null, mode:"plan", candidates:[], route:null, baseDirty:false };
function initMap(){
  if(mapState.map || !window.L) return;
  mapState.map = L.map("map"); tileLayer().addTo(mapState.map);
  mapState.layer = L.layerGroup().addTo(mapState.map);
  const h = homeBase(); mapState.map.setView([h.lat,h.lng], 10);
  $("#dDate").value = todayIso();
}
function fillStartSelect(keep){
  const sel = $("#pStart"), cur = keep ?? sel.value;
  const t = todayIso(), until = addDays(t, 30);
  const jobs = Object.entries(state.jobs).filter(([,j])=>j.type!=="personal" && j.status!=="done" && j.status!=="cancelled" && j.date>=t && j.date<=until && hasLoc(state.customers[j.customerId])).sort((a,b)=>a[1].date.localeCompare(b[1].date));
  const custs = Object.entries(state.customers).filter(([,c])=>hasLoc(c)).sort((a,b)=>a[1].name.localeCompare(b[1].name));
  sel.innerHTML = `<option value="home">Home base — ${esc(homeBase().label)}</option>`
    + (jobs.length ? `<optgroup label="A booked job (next 30 days)">${jobs.map(([id,j])=>`<option value="job:${id}">${esc(fmtDate(j.date))} — ${esc(custName(j.customerId))}${state.customers[j.customerId]?.town?", "+esc(state.customers[j.customerId].town):""}</option>`).join("")}</optgroup>` : "")
    + (custs.length ? `<optgroup label="A customer">${custs.map(([id,c])=>`<option value="cust:${id}">${esc(c.name)}${c.town?" — "+esc(c.town):""}</option>`).join("")}</optgroup>` : "");
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
}
function startPoint(){
  const v = $("#pStart").value || "home";
  if(v.startsWith("job:")){ const id = v.slice(4), j = state.jobs[id], c = state.customers[j?.customerId]; if(j && hasLoc(c)) return { kind:"job", id, custId:j.customerId, ...loc(c), label:c.name, date:j.date, time:j.time, duration:j.duration }; }
  if(v.startsWith("cust:")){ const id = v.slice(5), c = state.customers[id]; if(hasLoc(c)) return { kind:"cust", custId:id, ...loc(c), label:c.name }; }
  const h = homeBase(); return { kind:"home", ...h };
}
function pinFor(id, c, weeks){
  const st = custStatus(id, c, weeks);
  const m = L.circleMarker([c.lat, c.lng], { radius:8, color:"#1D2125", weight:1, fillColor:PIN[st], fillOpacity:.95 });
  const booked = upcomingPm(id);
  m.bindPopup(`<b>${esc(c.name)}</b><br>${esc([c.address,c.town].filter(Boolean).join(", "))}<br>${esc(genLine(c))}<br><i>${booked ? "Booked "+esc(fmtDate(booked.date)) : esc(dueText(c))}</i>
    <div class="pop-acts">${booked?"":`<button class="btn primary" data-book="${id}">Book visit</button>`}<button class="btn ghost" data-planfrom="${id}">Plan from here</button><button class="btn ghost" data-editcust="${id}">Open</button></div>`);
  return m;
}
function numIcon(n, home){ return L.divIcon({ className:"pin-num"+(home?" pin-home":""), html: home ? "⌂" : String(n), iconSize:[24,24] }); }
function renderMap(){
  if(!mapState.map) return;
  const layer = mapState.layer; layer.clearLayers();
  const weeks = $("#pDue").value === "all" ? 8 : Number($("#pDue").value);
  const missing = Object.values(state.customers).filter(c=>!hasLoc(c)).length;
  $("#mapMissing").textContent = missing ? `${missing} customer${missing>1?"s aren’t":" isn’t"} on the map yet. Open them under Customers and use “Find address on map”.` : "";
  const h = homeBase();
  L.marker([h.lat,h.lng], { icon:numIcon(0,true), title:"Home base" }).addTo(layer).bindPopup(`<b>Home base</b><br>${esc(h.label)}`);
  if(mapState.mode === "plan"){
    const inRoute = new Set((mapState.route?.stops||[]).map(s=>s.custId));
    for(const [id,c] of Object.entries(state.customers)) if(hasLoc(c) && !inRoute.has(id)) pinFor(id, c, weeks).addTo(layer);
    drawRoute(mapState.route);
  } else renderDay();
}
function drawRoute(route){
  if(!route || !route.stops.length) return;
  const h = homeBase(), pts = [[h.lat,h.lng], ...route.stops.map(s=>[s.lat,s.lng]), [h.lat,h.lng]];
  L.polyline(pts, { color:"#1D2125", weight:3, opacity:.75, dashArray:"6 6" }).addTo(mapState.layer);
  route.stops.forEach((s,i)=>{
    const c = state.customers[s.custId];
    L.marker([s.lat,s.lng], { icon:numIcon(i+1) }).addTo(mapState.layer).bindPopup(`<b>${i+1}. ${esc(s.label)}</b><br>${esc(c?.town||"")}${s.fixed?"<br><i>Already booked</i>":""}<br>${esc(c?dueText(c):"")}`);
  });
}
// Visit order: nearest-neighbour from home, then 2-opt clean-up. Distances are straight-line.
function orderStops(stops, fixedFirst){
  const h = homeBase();
  let rest = stops.filter(s=>s !== fixedFirst), order = fixedFirst ? [fixedFirst] : [], cur = fixedFirst || h;
  while(rest.length){ rest.sort((a,b)=>km(cur,a)-km(cur,b)); cur = rest.shift(); order.push(cur); }
  const len = arr => { let d = 0, p = h; for(const s of arr){ d += km(p,s); p = s; } return d + km(p,h); };
  let improved = true, guard = 0;
  while(improved && guard++ < 50){
    improved = false;
    for(let i = fixedFirst ? 1 : 0; i < order.length-1; i++) for(let k = i+1; k < order.length; k++){
      const cand = order.slice(0,i).concat(order.slice(i,k+1).reverse(), order.slice(k+1));
      if(len(cand) + 0.01 < len(order)){ order = cand; improved = true; }
    }
  }
  return { stops:order, km:len(order) };
}
function findCandidates(){
  const sp = startPoint(), radius = Number($("#pRadius").value), dueSel = $("#pDue").value, t = todayIso();
  const list = [];
  for(const [id,c] of Object.entries(state.customers)){
    if(!hasLoc(c)) continue;
    if(sp.custId === id) continue;
    if(upcomingPm(id)) continue;
    const d = km(sp, loc(c)); if(d > radius) continue;
    if(dueSel !== "all"){
      if(!c.plan || c.plan === "none") continue;
      const nd = nextDue(c);
      if(nd && daysBetween(t, nd) > Number(dueSel)*7) continue;
    }
    list.push({ custId:id, ...loc(c), label:c.name, dist:d, status:custStatus(id, c, dueSel==="all"?8:Number(dueSel)) });
  }
  list.sort((a,b)=> (a.status==="overdue")===(b.status==="overdue") ? a.dist-b.dist : (a.status==="overdue"?-1:1));
  return { sp, list };
}
function renderCandidates(){
  const box = $("#pResults"), { sp, list } = mapState.found || { list:[] };
  if(!mapState.found){ box.innerHTML = ""; return; }
  const fixed = sp.kind === "job" ? `<div class="cand"><input type="checkbox" checked disabled aria-label="Already booked"><div><b>${esc(sp.label)}</b><div class="sub">Already booked ${esc(fmtDate(sp.date))} — trip starts here</div></div><span class="pill ok">Booked</span></div>` : "";
  const anchorCust = sp.kind === "cust" ? `<div class="cand"><input type="checkbox" data-cand="anchor" ${mapState.anchorOn!==false?"checked":""}><div><b>${esc(sp.label)}</b><div class="sub">Starting customer · ${esc(dueText(state.customers[sp.custId]))}</div></div><span class="pill">0 km</span></div>` : "";
  if(!list.length && !fixed && !anchorCust){ box.innerHTML = `<p class="hint">No customers match. Try a bigger distance or a longer due window.</p>`; return; }
  const pillFor = s => s==="overdue"?`<span class="pill over">Overdue</span>`:s==="soon"?`<span class="pill soon">Due soon</span>`:"";
  box.innerHTML = `<div class="list" style="padding:0 8px">${fixed}${anchorCust}${list.map((c,i)=>`<div class="cand"><input type="checkbox" data-cand="${i}" ${mapState.checked.has(c.custId)?"checked":""} aria-label="Include ${esc(c.label)}">
      <div><b>${esc(c.label)}</b><div class="sub">${Math.round(c.dist)} km away · ${esc(dueText(state.customers[c.custId]))}</div></div>${pillFor(c.status)}</div>`).join("")}</div>
    <div id="pRoute" style="margin-top:10px"></div>`;
  renderRouteBox();
}
function selectedStops(){
  const { sp, list } = mapState.found;
  const stops = list.filter(c=>mapState.checked.has(c.custId)).map(c=>({ ...c }));
  let fixedFirst = null;
  if(sp.kind === "job"){ fixedFirst = { custId:sp.custId, lat:sp.lat, lng:sp.lng, label:sp.label, fixed:true }; stops.unshift(fixedFirst); }
  if(sp.kind === "cust" && mapState.anchorOn !== false){ fixedFirst = { custId:sp.custId, lat:sp.lat, lng:sp.lng, label:sp.label }; stops.unshift(fixedFirst); }
  return { stops, fixedFirst };
}
function renderRouteBox(){
  const { stops, fixedFirst } = selectedStops();
  const box = $("#pRoute"); if(!box) return;
  if(!stops.length){ mapState.route = null; box.innerHTML = `<p class="hint">Tick the customers you want to visit.</p>`; renderMap(); return; }
  const route = orderStops(stops, fixedFirst); mapState.route = route;
  const toBook = route.stops.filter(s=>!s.fixed);
  const sp = mapState.found.sp;
  const defDate = sp.kind === "job" ? sp.date : ($("#pBookDate")?.value || nextWeekday());
  const startTime = sp.kind === "job" && sp.time ? sp.time : "08:30";
  box.innerHTML = `<p style="margin:0 0 6px"><b>Visit order</b> · about ${Math.round(route.km)} km round trip <span class="hint">(straight-line; roads add roughly 25–40%)</span></p>
    <ol style="margin:0 0 10px;padding-left:20px">${route.stops.map(s=>`<li>${esc(s.label)}${s.fixed?" <span class=\"hint\">(booked)</span>":""}</li>`).join("")}</ol>
    ${toBook.length ? `<div class="field-row"><div class="field"><label for="pBookDate">Book on</label><input type="date" id="pBookDate" value="${defDate}"></div>
      <div class="field"><label for="pBookTime">First visit</label><input type="time" id="pBookTime" value="${startTime}" step="900"></div>
      <div class="field"><label for="pBookHrs">Hours each</label><input type="number" id="pBookHrs" value="1.5" min="0.25" step="0.25"></div></div>
      <p class="hint" style="margin:6px 0">Visits are spaced with 30 minutes of travel between them. You can adjust any job afterwards.</p>
      <button class="btn primary" id="pBook" style="width:100%">Book ${toBook.length} maintenance visit${toBook.length>1?"s":""}</button>` : ""}
    <a class="btn ghost" id="pNav" href="${gmapsUrl(route.stops)}" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:8px;text-decoration:none">Open route in Google Maps</a>
    ${route.stops.length > 9 ? `<p class="hint">Google Maps takes up to 9 stops at once, so only the first 9 are sent.</p>` : ""}`;
  const bb = $("#pBook"); if(bb) bb.onclick = bookRoute;
  renderMap();
}
function gmapsUrl(stops){
  const h = homeBase(), pts = stops.slice(0,9).map(s=>`${s.lat},${s.lng}`);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${h.lat},${h.lng}${pts.length?`&waypoints=${encodeURIComponent(pts.join("|"))}`:""}`;
}
async function bookRoute(){
  const route = mapState.route; if(!route) return;
  const date = $("#pBookDate").value; if(!date){ $("#pBookDate").focus(); return; }
  const hrs = Number($("#pBookHrs").value) || 1.5;
  let [hh, mm] = ($("#pBookTime").value || "08:30").split(":").map(Number);
  let minutes = hh*60 + mm;
  const sp = mapState.found.sp;
  if(sp.kind === "job"){ minutes += Math.round((Number(sp.duration)||1)*60) + 30; }
  let n = 0;
  for(const s of route.stops){
    if(s.fixed) continue;
    const t = `${pad(Math.floor(minutes/60)%24)}:${pad(Math.round(minutes%60/15)*15%60)}`;
    await put("jobs", newId(), { customerId:s.custId, type:"pm", date, time:t, duration:hrs, priority:"normal", notes:"Booked from trip planner", status:"booked", stage:null, report:"", createdAt:Date.now() });
    minutes += Math.round(hrs*60) + 30; n++;
  }
  toast(`Booked ${n} visit${n>1?"s":""} on ${fmtDate(date)}`);
  mapState.found = null; mapState.route = null; mapState.checked = new Set();
  renderCandidates(); renderMap();
}
$("#pFind").addEventListener("click", ()=>{
  mapState.found = findCandidates();
  mapState.checked = new Set(mapState.found.list.slice(0,6).map(c=>c.custId));
  mapState.anchorOn = true;
  renderCandidates();
  const sp = mapState.found.sp;
  mapState.map.setView([sp.lat, sp.lng], Number($("#pRadius").value) > 60 ? 9 : 10);
});
$("#pResults").addEventListener("change", e=>{
  const cb = e.target.closest("[data-cand]"); if(!cb) return;
  if(cb.dataset.cand === "anchor") mapState.anchorOn = cb.checked;
  else { const c = mapState.found.list[Number(cb.dataset.cand)]; if(cb.checked) mapState.checked.add(c.custId); else mapState.checked.delete(c.custId); }
  renderRouteBox();
});
["#pStart","#pRadius","#pDue"].forEach(s=>$(s).addEventListener("change", ()=>{ if(mapState.found) $("#pFind").click(); else renderMap(); }));
document.querySelector(".mode-seg").addEventListener("click", e=>{
  const b = e.target.closest("[data-mode]"); if(!b) return;
  mapState.mode = b.dataset.mode;
  document.querySelectorAll(".mode-seg button").forEach(x=>x.setAttribute("aria-pressed", String(x===b)));
  $("#planPane").hidden = mapState.mode !== "plan"; $("#dayPane").hidden = mapState.mode !== "day";
  renderMap();
});
$("#dDate").addEventListener("change", renderMap);
function renderDay(){
  const date = $("#dDate").value || todayIso();
  const jobs = jobsOn(date).filter(([,j])=>j.type!=="personal" && j.type!=="busy");
  const personal = jobsOn(date).filter(([,j])=>j.type==="personal");
  const withLoc = jobs.filter(([,j])=>hasLoc(state.customers[j.customerId]));
  const noLoc = jobs.filter(([,j])=>!hasLoc(state.customers[j.customerId]));
  const stops = withLoc.map(([id,j])=>({ id, custId:j.customerId, ...loc(state.customers[j.customerId]), label:custName(j.customerId), time:j.time }));
  const h = homeBase();
  if(stops.length){
    L.polyline([[h.lat,h.lng], ...stops.map(s=>[s.lat,s.lng]), [h.lat,h.lng]], { color:"#1D2125", weight:3, opacity:.75, dashArray:"6 6" }).addTo(mapState.layer);
    stops.forEach((s,i)=>L.marker([s.lat,s.lng], { icon:numIcon(i+1) }).addTo(mapState.layer).bindPopup(`<b>${i+1}. ${esc(s.label)}</b><br>${esc(fmtTime(s.time))}<div class="pop-acts"><button class="btn ghost" data-job="${s.id}">Open job</button></div>`));
    mapState.map.fitBounds(L.latLngBounds([[h.lat,h.lng], ...stops.map(s=>[s.lat,s.lng])]).pad(0.2));
  }
  let total = 0, p = h; for(const s of stops){ total += km(p,s); p = s; } if(stops.length) total += km(p,h);
  $("#dResults").innerHTML = !jobs.length ? `<p class="hint">No customer jobs on ${esc(fmtDate(date))}.</p>` :
    `<div class="list" style="padding:0 8px">${withLoc.map(([id,j],i)=>`<div class="cand"><span class="stopnum">${i+1}</span><div><b>${esc(custName(j.customerId))}</b><div class="sub">${esc(fmtTime(j.time)||"No time")} · ${esc(TYPES[j.type]?.label||"")} · ${esc(state.customers[j.customerId]?.town||"")}</div></div><button class="btn ghost" data-job="${id}" style="padding:4px 8px;font-size:12px">Open</button></div>`).join("")}
     ${noLoc.map(([id,j])=>`<div class="cand"><span class="stopnum" style="background:var(--outage)">!</span><div><b>${esc(custName(j.customerId))}</b><div class="sub">No map pin — open the customer to add one</div></div><button class="btn ghost" data-editcust="${j.customerId}" style="padding:4px 8px;font-size:12px">Fix</button></div>`).join("")}</div>
     ${stops.length ? `<p class="hint">About ${Math.round(total)} km round trip, straight-line, in appointment order.</p><a class="btn primary" href="${gmapsUrl(stops)}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">Navigate in Google Maps</a>` : ""}
     ${personal.length ? `<p class="hint" style="margin-top:10px">Personal time that day: ${personal.map(([,j])=>esc((j.time?fmtTime(j.time)+" ":"")+j.title)).join(", ")}</p>` : ""}`;
}
function planFrom(custId){
  showView("map");
  mapState.mode = "plan";
  document.querySelectorAll(".mode-seg button").forEach(x=>x.setAttribute("aria-pressed", String(x.dataset.mode==="plan")));
  $("#planPane").hidden = false; $("#dayPane").hidden = true;
  fillStartSelect(`cust:${custId}`);
  $("#pFind").click();
}

/* ================= navigation + delegation ================= */
const VIEWS = ["schedule","map","due","shop","customers"];
const currentView = () => VIEWS.find(v=>!$("#view-"+v).hidden) || "schedule";
function showView(v){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected", String(b.dataset.view===v)));
  document.querySelectorAll(".view").forEach(s=>s.hidden = s.id!=="view-"+v);
  if(location.hash.slice(1)!==v) history.replaceState(null,"","#"+v);
  if(v === "map"){
    initMap(); fillStartSelect();
    setTimeout(()=>{ mapState.map?.invalidateSize(); if(mapState.baseDirty){ const h = homeBase(); mapState.map.setView([h.lat,h.lng],10); mapState.baseDirty = false; } renderMap(); }, 30);
  }
}
document.querySelector("nav.tabs").addEventListener("click", e=>{ const b = e.target.closest("button[data-view]"); if(b) showView(b.dataset.view); });
window.addEventListener("hashchange", ()=>{ const h = location.hash.slice(1); if(VIEWS.includes(h)) showView(h); });

$("#prevWeek").onclick = ()=>{ state.weekStart.setDate(state.weekStart.getDate()-7); renderWeek(); };
$("#nextWeek").onclick = ()=>{ state.weekStart.setDate(state.weekStart.getDate()+7); renderWeek(); };
$("#thisWeek").onclick = ()=>{ state.weekStart = mondayOf(new Date()); renderWeek(); };
$("#newJobBtn").onclick = ()=>openJob(null);
$("#newCustBtn").onclick = ()=>openCust(null);
$("#acctBtn").onclick = ()=>openAccount(false);
$("#custSearch").addEventListener("input", renderCustomers);
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click", ()=>b.closest("dialog").close()));

document.addEventListener("click", e=>{
  const t = e.target.closest("button,a"); if(!t || !t.dataset) return;
  const d = t.dataset;
  if(d.job){ mapState.map?.closePopup(); openJob(d.job); }
  else if(d.add) openJob(null,{date:d.add});
  else if(d.book){ mapState.map?.closePopup(); const nd = nextDue(state.customers[d.book]); const t0 = todayIso(); openJob(null,{customerId:d.book,type:"pm",date: nd && nd>t0 ? nd : t0}); }
  else if(d.bookany) openJob(null,{customerId:d.bookany});
  else if(d.editcust){ mapState.map?.closePopup(); openCust(d.editcust); }
  else if(d.planfrom){ mapState.map?.closePopup(); planFrom(d.planfrom); }
  else if("newcust" in d) openCust(null);
  else if(d.goto) showView(d.goto);
  else if(d.stage){
    const j = state.jobs[d.stage]; if(!j) return;
    const upd = Object.assign({}, j, {stage:d.to}); if(d.to==="returned") upd.status = "done";
    put("jobs", d.stage, upd); toast(STAGES[d.to]);
  }
});

/* ================= trade and job types (owner) ================= */
const SLOTS = [["pm","Recurring maintenance","Rolls each customer’s next-due date forward"],["repair","Service / repair call",""],["install","Installation",""],["assess","Estimate or site visit",""],["shop","Shop or bring-in work","Tracked on its own board"]];
function renderTradeForm(ind){
  if(!ind) return;
  $("#iPreset").innerHTML = (state.presets||[]).map(p=>`<option value="${p.id}"${p.id===ind.preset?" selected":""}>${esc(p.name)}</option>`).join("");
  $("#iTypes").innerHTML = SLOTS.map(([k,name,hint])=>{
    const t = ind.jobTypes[k] || {}, fixed = k==="pm" || k==="repair";
    return `<label class="check" title="${esc(hint)}"><input type="checkbox" data-slot-on="${k}"${t.on!==false?" checked":""}${fixed?" disabled":""}> <span class="k">${esc(name)}</span></label>
      <input type="text" data-slot-label="${k}" value="${esc(t.label||"")}" aria-label="Name for ${esc(name)}">
      ${k==="shop" ? `<input type="text" class="board" data-slot-board value="${esc(t.board||"")}" placeholder="Board name, e.g. Shop repairs" aria-label="Shop board name">` : `<span></span>`}`;
  }).join("");
  $("#iEquip").value = ind.equipment || ""; $("#iUnit").value = ind.sizeUnit || "";
  $("#iEtypes").value = (ind.equipmentTypes||[]).join(", "); $("#iFuels").value = (ind.fuels||[]).join(", "); $("#iBrands").value = (ind.brands||[]).join(", ");
  $("#iApplyForms").checked = false; $("#iError").textContent = "";
}
$("#iLoadPreset").addEventListener("click", async ()=>{
  try{ const r = await api("GET", `/api/industry/preset/${encodeURIComponent($("#iPreset").value)}`); renderTradeForm(r.industry); $("#iApplyForms").checked = r.industry.preset !== state.industry?.preset; toast("Defaults loaded. Review them, then save."); }
  catch(err){ $("#iError").textContent = err.error; }
});
$("#indForm").addEventListener("submit", async e=>{
  e.preventDefault(); $("#iError").textContent = "";
  const jobTypes = {};
  for(const [k] of SLOTS){
    jobTypes[k] = { label:$(`[data-slot-label="${k}"]`).value.trim(), on:$(`[data-slot-on="${k}"]`).checked };
    if(k==="shop") jobTypes[k].board = $("[data-slot-board]").value.trim();
  }
  const industry = { preset:$("#iPreset").value, equipment:$("#iEquip").value, sizeUnit:$("#iUnit").value, equipmentTypes:$("#iEtypes").value, fuels:$("#iFuels").value, brands:$("#iBrands").value, jobTypes };
  const applyForms = $("#iApplyForms").checked;
  if(applyForms && !confirm("Replace your service forms with this trade’s default forms? Reports already finished keep their answers.")) return;
  try{
    const r = await api("PUT","/api/industry",{ industry, applyForms });
    state.industry = r.industry; if(r.forms) state.forms = r.forms;
    applyIndustry(); render(); renderTradeForm(state.industry);
    toast(applyForms ? "Trade settings and forms saved" : "Trade settings saved");
  }catch(err){ $("#iError").textContent = err.error; }
});

/* ================= service form builder + logo (owner) ================= */
const fbDlg = $("#fbDlg");
const JOB_TYPE_LABELS = new Proxy({}, { ownKeys:()=>enabledTypes(), getOwnPropertyDescriptor:()=>({ enumerable:true, configurable:true }), get:(t,k)=>TYPES[k]?.label });
const FIELD_TYPES = { check:"Checklist item (OK / Needs attention)", number:"Number", text:"Short text", textarea:"Long text", select:"Drop-down", yesno:"Yes / No", date:"Date" };
const fb = { cfg:null, i:0, dirty:false };
const fbId = p => p + Math.random().toString(36).slice(2,8);
function fbOpen(){
  fb.cfg = JSON.parse(JSON.stringify(state.forms)); fb.i = 0; fb.dirty = false;
  fbRender(); fbDlg.showModal();
}
function fbTpl(){ return fb.cfg.templates[fb.i]; }
function fbRender(){
  const t = fbTpl(), C = fb.cfg;
  $("#fbBody").innerHTML = `
    <div class="fb-top">
      <div class="field"><label for="fbPick">Form</label><select id="fbPick">${C.templates.map((x,i)=>`<option value="${i}"${i===fb.i?" selected":""}>${esc(x.name)}</option>`).join("")}</select></div>
      <button type="button" class="btn ghost" data-fb="new">New form</button>
      <button type="button" class="btn ghost" data-fb="dup">Duplicate</button>
      <button type="button" class="btn ghost" data-fb="deltpl"${C.templates.length<2?" disabled":""}>Delete form</button>
    </div>
    <div class="fb-grid">
      <div class="field"><label for="fbName">Form name</label><input id="fbName" value="${esc(t.name)}" data-bind="name"></div>
      <div class="field"><label for="fbTitleIn">Title printed on the report</label><input id="fbTitleIn" value="${esc(t.title||"")}" data-bind="title"></div>
    </div>
    <div class="field"><label>Use this form for</label><div class="fb-assign">${Object.entries(JOB_TYPE_LABELS).map(([k,v])=>`<label class="check"><input type="checkbox" data-assign="${k}"${C.assign[k]===t.id?" checked":""}> ${v}</label>`).join("")}</div>
      <span class="hint">Each job type uses one form. Ticking a job type here moves it from its current form.</span></div>
    ${t.sections.map((sec,si)=>`<div class="fb-sec">
      <div class="fb-sec-head"><input value="${esc(sec.title)}" placeholder="Section title" data-sec="${si}" aria-label="Section title">
        <span class="fb-icons"><button type="button" title="Move section up" data-fb="secup" data-si="${si}">↑</button><button type="button" title="Move section down" data-fb="secdown" data-si="${si}">↓</button><button type="button" class="del" title="Delete section" data-fb="secdel" data-si="${si}">✕</button></span></div>
      <div>${sec.fields.map((f,fi)=>`<div class="fb-field">
        <input value="${esc(f.label)}" placeholder="Question or item" data-flabel="${si}.${fi}" aria-label="Field label">
        <select data-ftype="${si}.${fi}" aria-label="Field type">${Object.entries(FIELD_TYPES).map(([k,v])=>`<option value="${k}"${f.type===k?" selected":""}>${v}</option>`).join("")}</select>
        ${f.type==="number" ? `<input value="${esc(f.unit||"")}" placeholder="Unit (e.g. V, Hz, hrs)" data-funit="${si}.${fi}" aria-label="Unit">`
          : f.type==="select" ? `<input value="${esc((f.options||[]).join(", "))}" placeholder="Choices, separated by commas" data-fopts="${si}.${fi}" aria-label="Choices">` : `<span></span>`}
        <label class="check fb-req"><input type="checkbox" data-freq="${si}.${fi}"${f.required?" checked":""}> Required</label>
        <span class="fb-icons"><button type="button" title="Move up" data-fb="fup" data-si="${si}" data-fi="${fi}">↑</button><button type="button" title="Move down" data-fb="fdown" data-si="${si}" data-fi="${fi}">↓</button><button type="button" class="del" title="Delete field" data-fb="fdel" data-si="${si}" data-fi="${fi}">✕</button></span>
      </div>`).join("")}</div>
      <div class="fb-add"><button type="button" class="btn ghost" data-fb="fadd" data-si="${si}">+ Add field</button></div>
    </div>`).join("")}
    <div><button type="button" class="btn ghost" data-fb="secadd">+ Add section</button></div>
    <div class="field"><label for="fbFooter">Footer line on every report</label><input id="fbFooter" value="${esc(C.footer||"")}" placeholder="Thank you for choosing ${esc(appName())}."><span class="hint">Leave blank to use the default thank-you line.</span></div>
    <p class="err" id="fbErr" role="alert"></p>`;
}
$("#fbBody").addEventListener("input", e=>{
  const t = fbTpl(), el = e.target, d = el.dataset; fb.dirty = true;
  const at = v => v.split(".").map(Number);
  if(d.bind) t[d.bind] = el.value;
  else if(d.sec !== undefined) t.sections[Number(d.sec)].title = el.value;
  else if(d.flabel){ const [a,b] = at(d.flabel); t.sections[a].fields[b].label = el.value; }
  else if(d.funit){ const [a,b] = at(d.funit); t.sections[a].fields[b].unit = el.value; }
  else if(d.fopts){ const [a,b] = at(d.fopts); t.sections[a].fields[b].options = el.value.split(",").map(x=>x.trim()).filter(Boolean); }
  else if(el.id === "fbFooter") fb.cfg.footer = el.value;
  if(d.bind === "name") $("#fbPick").options[fb.i].textContent = el.value || "Untitled form";
});
$("#fbBody").addEventListener("change", e=>{
  const t = fbTpl(), el = e.target, d = el.dataset; fb.dirty = true;
  const at = v => v.split(".").map(Number);
  if(el.id === "fbPick"){ fb.i = Number(el.value); fbRender(); return; }
  if(d.ftype){ const [a,b] = at(d.ftype); const f = t.sections[a].fields[b]; f.type = el.value; if(f.type==="select" && !f.options) f.options = []; fbRender(); }
  else if(d.freq){ const [a,b] = at(d.freq); t.sections[a].fields[b].required = el.checked; }
  else if(d.assign){
    if(el.checked) fb.cfg.assign[d.assign] = t.id;
    else { el.checked = true; toast("Each job type needs a form. Tick it on another form to move it."); }
  }
});
$("#fbBody").addEventListener("click", e=>{
  const b = e.target.closest("[data-fb]"); if(!b) return;
  const t = fbTpl(), C = fb.cfg, si = Number(b.dataset.si), fi = Number(b.dataset.fi); fb.dirty = true;
  const swap = (arr, i, j) => { if(j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
  switch(b.dataset.fb){
    case "new": C.templates.push({ id:fbId("form"), name:"New form", title:"Service Report", sections:[{ id:fbId("sec"), title:"Details", fields:[{ id:fbId("f"), label:"Work performed", type:"textarea" }] }] }); fb.i = C.templates.length - 1; break;
    case "dup": { const c = JSON.parse(JSON.stringify(t)); c.id = fbId("form"); c.name = t.name + " (copy)"; C.templates.push(c); fb.i = C.templates.length - 1; break; }
    case "deltpl": {
      if(C.templates.length < 2 || !confirm(`Delete the “${t.name}” form? Reports already finished with it keep their answers.`)) return;
      C.templates.splice(fb.i, 1); fb.i = 0;
      for(const k of Object.keys(C.assign)) if(!C.templates.some(x=>x.id===C.assign[k])) C.assign[k] = C.templates[0].id;
      break; }
    case "secadd": t.sections.push({ id:fbId("sec"), title:"New section", fields:[] }); break;
    case "secup": swap(t.sections, si, si-1); break;
    case "secdown": swap(t.sections, si, si+1); break;
    case "secdel": if(t.sections[si].fields.length && !confirm(`Delete the section “${t.sections[si].title}” and its ${t.sections[si].fields.length} field(s)?`)) return; t.sections.splice(si,1); break;
    case "fadd": t.sections[si].fields.push({ id:fbId("f"), label:"", type:"check" }); break;
    case "fup": swap(t.sections[si].fields, fi, fi-1); break;
    case "fdown": swap(t.sections[si].fields, fi, fi+1); break;
    case "fdel": t.sections[si].fields.splice(fi,1); break;
  }
  fbRender();
  if(b.dataset.fb === "fadd"){ const ins = $("#fbBody").querySelectorAll(`[data-flabel^="${si}."]`); ins[ins.length-1]?.focus(); }
});
$("#fbClose").addEventListener("click", ()=>{ if(fb.dirty && !confirm("Close without saving your changes?")) return; fbDlg.close(); });
fbDlg.addEventListener("cancel", e=>{ if(fb.dirty && !confirm("Close without saving your changes?")) e.preventDefault(); });
$("#fbSave").addEventListener("click", async ()=>{
  $("#fbErr").textContent = "";
  try{ const r = await api("PUT","/api/forms", fb.cfg); state.forms = r.forms; fb.dirty = false; fbDlg.close(); toast("Service forms saved"); }
  catch(err){ $("#fbErr").textContent = err.error; }
});
$("#fbReset").addEventListener("click", async ()=>{
  if(!confirm("Reset all service forms to the original maintenance and service forms? Your custom forms will be removed. Reports already finished keep their answers.")) return;
  try{ const r = await api("POST","/api/forms/reset"); state.forms = r.forms; fb.cfg = JSON.parse(JSON.stringify(r.forms)); fb.i = 0; fb.dirty = false; fbRender(); toast("Forms reset"); }
  catch(err){ $("#fbErr").textContent = err.error; }
});
$("#fbPreview").addEventListener("click", async ()=>{
  $("#fbErr").textContent = "";
  const win = window.open("", "_blank");
  try{
    const res = await fetch("/api/forms/preview", { method:"POST", credentials:"same-origin", headers:{ "X-Requested-With":"fielora", "Content-Type":"application/json" }, body:JSON.stringify({ template:fbTpl(), footer:fb.cfg.footer }) });
    if(!res.ok){ const d = await res.json().catch(()=>({})); throw { error:d.error || "Couldn’t build the preview." }; }
    const url = URL.createObjectURL(await res.blob());
    if(win) win.location = url; else window.open(url, "_blank");
  }catch(err){ if(win) win.close(); $("#fbErr").textContent = err.error || "Couldn’t build the preview."; }
});
$("#fbOpen").addEventListener("click", ()=>{ if(!state.forms){ toast("Forms are still loading."); return; } fbOpen(); });
function renderLogo(){
  const box = $("#logoBox"); if(!box) return;
  box.innerHTML = state.branding?.logo ? `<img src="/api/branding/logo?v=${Date.now()}" alt="Your logo">` : `<span class="hint">No logo</span>`;
  $("#logoRemove").hidden = !state.branding?.logo;
}
$("#logoFile").addEventListener("change", async e=>{
  const file = e.target.files[0]; e.target.value = ""; if(!file) return;
  try{
    const img = await new Promise((res, rej)=>{ const i = new Image(); i.onload = ()=>res(i); i.onerror = ()=>rej(); i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, 900 / img.width, 300 / img.height);
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    await api("POST","/api/branding/logo",{ data: cv.toDataURL("image/png") });
    state.branding = { ...(state.branding||{}), logo:true, v:Date.now() }; renderLogo(); applyIndustry(); toast("Logo saved. It now appears on service reports.");
  }catch(err){ toast(err?.error || "Couldn’t use that image. Try a PNG or JPG."); }
});
$("#logoRemove").addEventListener("click", async ()=>{
  if(!confirm("Remove the logo from service reports?")) return;
  try{ await api("DELETE","/api/branding/logo"); state.branding = { ...(state.branding||{}), logo:false }; renderLogo(); applyIndustry(); toast("Logo removed"); }catch(err){ toast(err.error); }
});
$("#zipLink").addEventListener("click", e=>{ if(!Object.values(state.jobs).some(j=>j.form)){ e.preventDefault(); toast("There are no service forms to export yet."); } });

/* ================= import (SharePoint / Excel / CSV) ================= */
const impDlg = $("#impDlg");
const imp = { step:1, data:null, mapping:{}, mode:"update", history:true, file:null, spUrl:"", busy:false, stopGeo:false };
function impSteps(n){ return `<div class="imp-steps">${["Choose source","Match columns","Preview","Import"].map((t,i)=>`<span class="${i+1===n?"on":""}">${i+1}. ${t}</span>`).join("")}</div>`; }
function impFoot(html){ $("#impFoot").innerHTML = html; }
function openImport(){ Object.assign(imp, { step:1, data:null, mapping:{}, file:null, busy:false }); impStep1(); impDlg.showModal(); }
$("#impClose").addEventListener("click", ()=>{ if(imp.busy && !confirm("Stop finding map locations?")) return; imp.stopGeo = true; impDlg.close(); });
impDlg.addEventListener("cancel", e=>{ if(imp.busy){ e.preventDefault(); } });

function impStep1(err){
  const sp = state.sharepoint?.configured;
  $("#impBody").innerHTML = `${impSteps(1)}
    <p style="margin:0">Bring in customer and equipment details from SharePoint, Excel or CSV. You’ll check how each column is matched before anything is saved.</p>
    <div class="src-grid">
      <div class="src-card"><h3>Upload a file</h3>
        <p class="hint" style="margin:0">In SharePoint, open the list and choose <b>Export → Export to CSV</b> (or download the Excel file). Then choose it here.</p>
        <input type="file" id="impFile" accept=".csv,.xlsx,.xlsm,.txt">
        <button type="button" class="btn primary" id="impFileGo">Read file</button></div>
      <div class="src-card"><h3>Read straight from SharePoint</h3>
        ${sp ? `<p class="hint" style="margin:0">Paste the link to your SharePoint customer or equipment list, or to an Excel or CSV file stored in SharePoint.</p>
        <input type="url" id="impUrl" placeholder="https://yourcompany.sharepoint.com/sites/…/Lists/…" value="${esc(imp.spUrl)}">
        <button type="button" class="btn primary" id="impUrlGo">Read from SharePoint</button>`
        : `<p class="hint" style="margin:0">Not connected yet. Once Microsoft 365 is connected (see “Connect SharePoint” in the README), you can paste a SharePoint link here instead of exporting a file.</p>`}</div>
    </div>
    <p class="err" id="impErr" role="alert">${esc(err||"")}</p>`;
  impFoot(`<span class="spacer"></span><button type="button" class="btn ghost" id="impCancel">Cancel</button>`);
  $("#impCancel").onclick = ()=>impDlg.close();
  $("#impFileGo").onclick = async ()=>{
    const f = $("#impFile").files[0]; if(!f){ $("#impErr").textContent = "Choose a file first."; return; }
    if(f.size > 18*1024*1024){ $("#impErr").textContent = "That file is too large (over 18 MB)."; return; }
    const b64 = await new Promise((res,rej)=>{ const r = new FileReader(); r.onload = ()=>res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
    imp.file = { filename:f.name, data:b64 }; imp.spUrl = "";
    await impLoad(()=>api("POST","/api/import/file", imp.file), "#impFileGo");
  };
  const ug = $("#impUrlGo");
  if(ug) ug.onclick = async ()=>{ imp.spUrl = $("#impUrl").value.trim(); imp.file = null; await impLoad(()=>api("POST","/api/import/sharepoint",{ url:imp.spUrl }), "#impUrlGo"); };
}
async function impLoad(fn, btnSel){
  const b = $(btnSel); const label = b?.textContent; if(b){ b.disabled = true; b.textContent = "Reading…"; }
  try{ const d = await fn(); imp.data = d; imp.mapping = { ...d.mapping }; impStep2(); }
  catch(e){ const el = $("#impErr"); if(el) el.textContent = e.error || "Couldn’t read that."; else impStep1(e.error); }
  finally{ if(b && document.body.contains(b)){ b.disabled = false; b.textContent = label; } }
}
function impStep2(err){
  const d = imp.data;
  const ex = col => d.sample.map(r=>r[col]).filter(v=>String(v).trim()).slice(0,2).join(" · ");
  const opts = sel => Object.entries(d.fields).map(([k,v])=>`<option value="${k}"${sel===k?" selected":""}>${esc(v)}</option>`).join("");
  $("#impBody").innerHTML = `${impSteps(2)}
    <p style="margin:0">Found <b>${d.rowCount}</b> row${d.rowCount===1?"":"s"} in ${esc(d.label)}. Check what each column should become. Columns marked <b>Keep as extra detail</b> are saved and shown under “Other details” on the customer.</p>
    ${d.sheets && d.sheets.length > 1 ? `<div class="field" style="max-width:320px"><label for="impSheet">Sheet</label><select id="impSheet">${d.sheets.map(n=>`<option${n===d.sheet?" selected":""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
    <div class="map-table" role="table">
      <div class="map-row" role="row"><span>Column</span><span>Example</span><span>Import as</span></div>
      ${d.columns.map((c,i)=>`<div class="map-row" role="row"><b>${esc(c)}</b><span class="ex" title="${esc(ex(c))}">${esc(ex(c))||"<i>empty</i>"}</span>
        <select data-col="${i}" aria-label="Import ${esc(c)} as" class="${imp.mapping[c]==="ignore"?"skip":""}">${opts(imp.mapping[c])}</select></div>`).join("")}
    </div>
    <p class="err" id="impErr" role="alert">${esc(err||"")}</p>`;
  impFoot(`<button type="button" class="btn ghost" id="impBack">Back</button><span class="spacer"></span><button type="button" class="btn primary" id="impNext">Preview import</button>`);
  $("#impBody").querySelectorAll("select[data-col]").forEach(sel=>sel.addEventListener("change", ()=>{
    const col = d.columns[Number(sel.dataset.col)], v = sel.value;
    // a field (other than extra/ignore) can only come from one column
    if(!["extra","ignore"].includes(v)) for(const [k,f] of Object.entries(imp.mapping)) if(f===v && k!==col){ imp.mapping[k] = "extra"; }
    imp.mapping[col] = v; impStep2();
  }));
  const sh = $("#impSheet");
  if(sh) sh.onchange = ()=> impLoad(()=> imp.file ? api("POST","/api/import/file",{ ...imp.file, sheet:sh.value }) : api("POST","/api/import/sharepoint",{ url:imp.spUrl, sheet:sh.value }), "#impNext");
  $("#impBack").onclick = ()=>impStep1();
  $("#impNext").onclick = ()=>impStep3();
}
async function impStep3(){
  $("#impFoot").querySelectorAll("button").forEach(b=>b.disabled = true);
  let p;
  try{ p = await api("POST","/api/import/preview",{ importId:imp.data.importId, mapping:imp.mapping, mode:imp.mode }); }
  catch(e){ if(e.status === 410){ impStep1(e.error); } else impStep2(e.error); return; }
  const c = p.counts, w = p.warn, total = c.create + c.update;
  const warns = [];
  if(c.noName) warns.push(`${c.noName} row${c.noName>1?"s have":" has"} no customer name and will be left out.`);
  if(c.inFileDupes) warns.push(`${c.inFileDupes} row${c.inFileDupes>1?"s repeat":" repeats"} a customer already in the file (same serial number, or same name and address), so ${c.inFileDupes>1?"they were":"it was"} combined.`);
  if(w.ambiguous) warns.push(`${w.ambiguous} date${w.ambiguous>1?"s":""} like 05/01/2026 could be read two ways. They were read as month/day (May 1). Check a few customers after importing.`);
  if(w.badDates) warns.push(`${w.badDates} date${w.badDates>1?"s weren’t":" wasn’t"} recognised and ${w.badDates>1?"were":"was"} left blank.`);
  if(w.assumedYearly) warns.push(`${w.assumedYearly} customer${w.assumedYearly>1?"s":""} only had a next service date and no interval, so a yearly plan was assumed to work out the last service.`);
  const planTxt = v => ({ "12":"Yearly","6":"6 months","3":"3 months" }[v] || "—");
  $("#impBody").innerHTML = `${impSteps(3)}
    <div class="counts"><span class="pill ok-pill">${c.create} new</span>${c.update?`<span class="pill soon">${c.update} update${c.update>1?"s":""}</span>`:""}${c.skip?`<span class="pill">${c.skip} skipped (already in the app)</span>`:""}</div>
    <div class="radio-list" role="radiogroup" aria-label="Customers already in the app">
      <label class="check"><input type="radio" name="impMode" value="update"${imp.mode==="update"?" checked":""}> Update customers already in the app with the SharePoint details (matched by serial number, or name and address)</label>
      <label class="check"><input type="radio" name="impMode" value="skip"${imp.mode==="skip"?" checked":""}> Leave customers already in the app as they are</label>
      <label class="check"><input type="radio" name="impMode" value="new"${imp.mode==="new"?" checked":""}> Add every row as a new customer</label>
      <label class="check" style="margin-top:6px"><input type="checkbox" id="impHist"${imp.history?" checked":""}> Add each customer’s last service date to their service history</label>
    </div>
    ${warns.length ? `<div class="warn-box">${warns.map(x=>`<p>${esc(x)}</p>`).join("")}</div>` : ""}
    <p style="margin:0"><b>Preview</b> <span class="hint">(first ${p.preview.length} of ${total + c.skip})</span></p>
    <div class="prev-wrap"><table class="prev-table"><thead><tr><th>Customer</th><th>Town</th><th>${esc(IND().equipment)}</th><th>Plan</th><th>Last service</th><th></th></tr></thead><tbody>
      ${p.preview.map(r=>`<tr><td><b>${esc(r.name)}</b>${r.phone?`<br><span class="hint">${esc(r.phone)}</span>`:""}</td><td>${esc(r.town||"")}</td><td>${esc([r.brand,r.model,r.kw?r.kw+" kW":"",r.fuel].filter(Boolean).join(", "))}${r.serial?`<br><span class="hint">S/N ${esc(r.serial)}</span>`:""}</td><td>${planTxt(r.plan)}</td><td>${r.lastService?esc(fmtLongDate(r.lastService)):"—"}</td><td>${r._match==="new"?`<span class="pill ok-pill">New</span>`:r._match==="update"?`<span class="pill soon">Update</span>`:`<span class="pill">Skip</span>`}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="err" id="impErr" role="alert"></p>`;
  $("#impBody").querySelectorAll("input[name=impMode]").forEach(r=>r.onchange = ()=>{ imp.mode = r.value; impStep3(); });
  $("#impHist").onchange = e=>{ imp.history = e.target.checked; };
  impFoot(`<button type="button" class="btn ghost" id="impBack">Back</button><span class="spacer"></span><button type="button" class="btn primary" id="impGo"${total?"":" disabled"}>Import ${total} customer${total===1?"":"s"}</button>`);
  $("#impBack").onclick = ()=>impStep2();
  $("#impGo").onclick = impCommit;
}
async function impCommit(){
  const b = $("#impGo"); b.disabled = true; b.textContent = "Importing…"; $("#impBack").disabled = true;
  let r;
  try{ r = await api("POST","/api/import/commit",{ importId:imp.data.importId, mapping:imp.mapping, mode:imp.mode, addHistory:imp.history }); }
  catch(e){ $("#impErr").textContent = e.error; b.disabled = false; b.textContent = "Try again"; $("#impBack").disabled = false; return; }
  await refresh();
  const need = r.needLocation.length;
  $("#impBody").innerHTML = `${impSteps(4)}
    <p style="margin:0;font-size:17px"><b>Import complete.</b> ${r.created} added${r.updated?`, ${r.updated} updated`:""}${r.skipped?`, ${r.skipped} skipped`:""}${r.history?`, and ${r.history} past service${r.history>1?"s":""} added to history`:""}.</p>
    ${need ? `<div class="warn-box"><p><b>${need} customer${need>1?"s need":" needs"} a map location.</b> The app can look up each address now. It does one per second (about ${Math.ceil(need*1.2/60)} minute${need>72?"s":""}), so keep this window open.</p></div>
      <div class="progress" aria-hidden="true"><div id="geoBar"></div></div><p class="hint" id="geoStatus" style="margin:0"></p>` : `<p class="hint" style="margin:0">Everyone is already on the map.</p>`}`;
  impFoot(`<span class="spacer"></span>${need?`<button type="button" class="btn ghost" id="geoGo">Find map locations</button>`:""}<button type="button" class="btn primary" id="impDone">Done</button>`);
  $("#impDone").onclick = ()=>{ imp.stopGeo = true; impDlg.close(); showView("customers"); };
  const g = $("#geoGo"); if(g) g.onclick = ()=>impGeocode(r.needLocation);
}
async function impGeocode(ids){
  imp.busy = true; imp.stopGeo = false;
  const g = $("#geoGo"); g.textContent = "Stop"; g.onclick = ()=>{ imp.stopGeo = true; };
  let found = 0, town = 0, missed = 0;
  for(let i = 0; i < ids.length && !imp.stopGeo; i++){
    const c = state.customers[ids[i]]; if(!c) continue;
    $("#geoStatus").textContent = `Looking up ${c.name}… (${i+1} of ${ids.length})`;
    const tries = [[c.address, c.town, c.postal, "Ontario"], [c.postal, "Ontario"], [c.town, "Ontario"]].map(a=>a.filter(Boolean)).filter(a=>a.length > 1);
    let hit = null, k = 0;
    for(; k < tries.length && !hit; k++){
      try{ const res = await api("GET", `/api/geocode?q=${encodeURIComponent(tries[k].join(", "))}`); if(res.results.length) hit = res.results[0]; }catch(e){}
    }
    if(hit){
      await put("customers", ids[i], Object.assign({}, state.customers[ids[i]], { lat:hit.lat, lng:hit.lng }));
      if(c.address && tries[k-1].includes(c.address)) found++; else town++;
    }
    else missed++;
    $("#geoBar").style.width = `${Math.round((i+1)/ids.length*100)}%`;
  }
  imp.busy = false;
  $("#geoStatus").textContent = `${imp.stopGeo?"Stopped. ":""}Placed ${found} at their address` + (town?`, ${town} at their town or postal code (drag those pins to the exact spot)`:"") + (missed?`, couldn’t find ${missed}`:"") + ". Customers without a pin are listed under the map.";
  g.remove();
}
$("#importBtn").addEventListener("click", openImport);

/* ================= install as an app ================= */
let installPrompt = null;
const SHARE_ICON = `<svg class="share-ico" viewBox="0 0 16 18" aria-hidden="true"><path d="M8 1v10M4.5 4.5 8 1l3.5 3.5M3 7.5H1.5v9h13v-9H13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
const isEdge = /Edg\//.test(ua), isFirefox = /Firefox|FxiOS/.test(ua);
const inAppBrowser = /FBAN|FBAV|Instagram|Outlook|GSA\/|Line\//i.test(ua);
const isPhoneOrTablet = isIOS || isAndroid;

function installStepsHtml(){
  if(isStandalone()) return `<p style="margin:0">You’re using the installed app. Nothing else to do.</p>`;
  if(installPrompt) return `<p style="margin:0 0 12px">Your browser can install this app directly. It gets its own icon and opens in its own window.</p><button type="button" class="btn primary" data-doinstall>Install now</button>`;
  if(isIOS){
    if(inAppBrowser) return `<p style="margin:0">This page is open inside another app. Tap the menu and choose <b>Open in Safari</b> first, then come back to these steps.</p>`;
    return `<ol class="steps">
      <li>Tap the <b>Share</b> button ${SHARE_ICON} ${/iPad/.test(ua)||navigator.maxTouchPoints>1&&!/iPhone/.test(ua)?"at the top of the screen":"at the bottom of the screen (or in the <span class=\"kbd\">⋯</span> menu)"}.</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
      <li>Make sure <b>Open as Web App</b> is on if you see it, then tap <b>Add</b>.</li>
    </ol><p class="hint" style="margin:12px 0 0">The installed app keeps its own sign-in, so you’ll sign in once more the first time you open it.</p>`;
  }
  if(isAndroid) return `<ol class="steps"><li>Tap the <span class="kbd">⋮</span> menu at the top right of Chrome.</li><li>Tap <b>Add to home screen</b> or <b>Install app</b>.</li><li>Tap <b>Install</b>.</li></ol>`;
  if(isMacSafari) return `<ol class="steps"><li>In the menu bar, choose <b>File → Add to Dock</b>.</li><li>Click <b>Add</b>. The app appears in your Dock and Launchpad.</li></ol>`;
  if(isFirefox) return `<p style="margin:0">Firefox on computers can’t install web apps. Open this page in <b>Microsoft Edge</b> or <b>Google Chrome</b> and install it from there.</p>`;
  if(isEdge) return `<ol class="steps"><li>Click the <span class="kbd">⋯</span> menu at the top right of Edge.</li><li>Choose <b>Apps → Install this site as an app</b>.</li><li>Click <b>Install</b>. You can pin it to the taskbar and Start menu when asked.</li></ol>`;
  return `<ol class="steps"><li>Look for the install icon at the right end of the address bar and click it.</li><li>No icon? Click the <span class="kbd">⋮</span> menu, then <b>Cast, save and share → Install page as app</b>.</li><li>Click <b>Install</b>.</li></ol>`;
}
function renderInstallUI(){
  const standalone = isStandalone();
  $("#installBtn").hidden = standalone || !installPrompt || !state.user;
  const sec = $("#installSec");
  if(sec) sec.innerHTML = standalone ? `<p style="margin:0"><span class="role-pill ok-pill">Installed</span> You’re using the app version.</p>`
    : `<p class="hint" style="margin:0 0 10px">Put the app on your home screen, Dock or taskbar so it opens like a normal app. Works on phones, tablets and computers.</p><button type="button" class="btn primary" data-showinstall>${installPrompt ? "Install app" : "Show me how"}</button>`;
  let dismissed = false; try{ dismissed = localStorage.getItem("fielora-install-dismissed") === "1"; }catch(e){}
  $("#installTip").hidden = standalone || dismissed || !state.user || !(installPrompt || isPhoneOrTablet);
  $("#installTipBtn").textContent = installPrompt ? "Install" : "Show me";
}
async function doInstall(){
  if(!installPrompt){ $("#installSteps").innerHTML = installStepsHtml(); if(!$("#installDlg").open) $("#installDlg").showModal(); return; }
  const p = installPrompt; installPrompt = null;
  p.prompt();
  try{ const { outcome } = await p.userChoice; if(outcome === "accepted") toast("Installing the app…"); }catch(e){}
  if($("#installDlg").open) $("#installDlg").close();
  renderInstallUI();
}
window.addEventListener("beforeinstallprompt", e=>{ e.preventDefault(); installPrompt = e; renderInstallUI(); });
window.addEventListener("appinstalled", ()=>{ installPrompt = null; toast("Installed. Open it from your home screen or apps."); renderInstallUI(); });
$("#installBtn").addEventListener("click", doInstall);
$("#installTipBtn").addEventListener("click", doInstall);
$("#installTipClose").addEventListener("click", ()=>{ try{ localStorage.setItem("fielora-install-dismissed","1"); }catch(e){} renderInstallUI(); });
document.addEventListener("click", e=>{
  if(e.target.closest("[data-showinstall]")) doInstall();
  else if(e.target.closest("[data-doinstall]")) doInstall();
});
$("#installDlg").querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click", ()=>$("#installDlg").close()));
if("serviceWorker" in navigator) window.addEventListener("load", ()=>{ navigator.serviceWorker.register("/sw.js").catch(()=>{}); });

/* ================= show / hide password ================= */
const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
function setPwVisible(input, show){
  input.type = show ? "text" : "password";
  const b = input.parentElement.querySelector(".pw-toggle"); if(!b) return;
  b.innerHTML = show ? EYE_OFF : EYE;
  b.setAttribute("aria-pressed", String(show));
  b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  b.title = show ? "Hide password" : "Show password";
}
function enhancePasswords(root=document){
  root.querySelectorAll('input[type="password"]:not([data-pw])').forEach(input=>{
    input.dataset.pw = "1";
    const wrap = document.createElement("span"); wrap.className = "pw-wrap";
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const b = document.createElement("button"); b.type = "button"; b.className = "pw-toggle";
    b.addEventListener("click", ()=>{ setPwVisible(input, input.type === "password"); input.focus(); });
    wrap.appendChild(b); setPwVisible(input, false);
  });
}
// Hide passwords again whenever a dialog closes, so they're never left showing.
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("close", ()=>d.querySelectorAll("input[data-pw]").forEach(i=>setPwVisible(i, false))));
enhancePasswords();

/* ================= start ================= */
(async function init(){
  render();
  try{ if(await loadMe()) await refresh(); }
  catch(e){ if(e.status !== 401 && e.code !== "2fa_required") setStatus(); }
  { const h = location.hash.slice(1); if(VIEWS.includes(h)) showView(h); }
  setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) refresh(); });
  window.addEventListener("online", refresh);
})();
})();
