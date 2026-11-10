"use strict";
// Microsoft Graph access for the business's Microsoft 365 (app-only sign-in).
// Used for Outlook email (Mail.Send) and reading SharePoint (Sites.Read.All).
const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
const configured = () => !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MS_TENANT_ID !== "none");

async function call(url, opts) {
  try { return await fetch(url, opts); }
  catch { throw new Error("Couldn’t reach Microsoft 365. Check the internet connection and try again."); }
}
let token = null, tokenExp = 0;
async function getToken() {
  if (!configured()) throw Object.assign(new Error("Microsoft 365 isn’t connected yet."), { code: "not_configured" });
  if (token && Date.now() < tokenExp - 60000) return token;
  const res = await call(`https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error || res.status}`);
  token = data.access_token; tokenExp = Date.now() + (data.expires_in || 3600) * 1000;
  return token;
}
function friendly(status, msg) {
  if (status === 403 || status === 401) return "Microsoft 365 refused access. The app registration needs the Sites.Read.All permission with admin consent (see the README).";
  if (status === 404) return "Couldn’t find that SharePoint list or file. Check the link and that it’s in this organisation’s SharePoint.";
  return `Microsoft 365 error: ${msg || status}`;
}
async function get(path, { raw = false } = {}) {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await call(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(friendly(res.status, d.error?.message)); }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}
async function post(path, body) {
  const res = await call(`https://graph.microsoft.com/v1.0${path}`, { method: "POST", headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw Object.assign(new Error(d.error?.message || String(res.status)), { status: res.status }); }
  return res;
}

/* ---------- SharePoint ---------- */
const SYSTEM_COLS = new Set(["ContentType", "Attachments", "Edit", "LinkTitle", "LinkTitleNoMenu", "DocIcon", "ItemChildCount", "FolderChildCount",
  "_ComplianceFlags", "_ComplianceTag", "_ComplianceTagWrittenTime", "_ComplianceTagUserId", "AppAuthor", "AppEditor", "_UIVersionString",
  "Modified", "Created", "Author", "Editor", "ID", "_ColorTag", "ComplianceAssetId", "_IsRecord"]);

function flat(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(flat).filter(Boolean).join(", ");
  if (typeof v === "object") return v.LookupValue || v.Email || v.Description || v.Url || v.displayName || v.Label || JSON.stringify(v);
  return v;
}

// Reads a SharePoint list from its URL (…/sites/Name/Lists/ListName/AllItems.aspx).
async function readList(urlStr) {
  const u = new URL(urlStr);
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const li = segs.findIndex(s => s.toLowerCase() === "lists");
  if (li < 0 || !segs[li + 1]) return null;
  const sitePath = segs.slice(0, li).join("/"), listUrlName = segs[li + 1];
  const site = await get(sitePath ? `/sites/${u.hostname}:/${sitePath.split("/").map(encodeURIComponent).join("/")}` : `/sites/${u.hostname}`);
  const lists = await get(`/sites/${site.id}/lists?$select=id,displayName,webUrl&$top=200`);
  const list = lists.value.find(l => decodeURIComponent(l.webUrl || "").toLowerCase().endsWith(`/lists/${listUrlName.toLowerCase()}`))
    || lists.value.find(l => l.displayName.toLowerCase() === listUrlName.toLowerCase());
  if (!list) throw new Error(`Couldn’t find a list called “${listUrlName}” on that SharePoint site.`);
  const cols = (await get(`/sites/${site.id}/lists/${list.id}/columns?$top=200`)).value
    .filter(c => !SYSTEM_COLS.has(c.name) && (c.name === "Title" || (!c.hidden && !c.readOnly)));
  const columns = cols.map(c => c.displayName);
  const records = [];
  let next = `/sites/${site.id}/lists/${list.id}/items?expand=fields&$top=500`;
  while (next && records.length < 10000) {
    const page = await get(next);
    for (const it of page.value) records.push(Object.fromEntries(cols.map(c => [c.displayName, flat(it.fields?.[c.name])])));
    next = page["@odata.nextLink"];
  }
  return { columns, records, label: `SharePoint list “${list.displayName}”` };
}

// Downloads a file (Excel or CSV) from any SharePoint/OneDrive link, including "Copy link" sharing links.
async function readFileFromLink(urlStr) {
  const share = "u!" + Buffer.from(urlStr).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const item = await get(`/shares/${share}/driveItem`);
  if (item.folder) throw new Error("That link points to a folder. Open the file itself and copy its link.");
  const buf = await get(`/drives/${item.parentReference.driveId}/items/${item.id}/content`, { raw: true });
  return { name: item.name, buffer: buf };
}

module.exports = { configured, getToken, get, post, readList, readFileFromLink };
