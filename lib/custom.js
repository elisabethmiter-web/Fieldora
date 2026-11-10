"use strict";
// Per-customer customizations, set from the Fielora Admin dashboard and stored in this app's settings.
// Everything is validated here so a bad value can never break the app.
const FEATURES = { map: "Map", due: "Maintenance due", shop: "Shop board", import: "Import", help: "Help chat" };
const LABELS = { schedule: "Schedule", map: "Map", due: "Maintenance due", customers: "Customers", customer: "Customer", jobs: "Jobs", job: "Job", newJob: "New job" };
const FIELD_TYPES = ["text", "textarea", "number", "select", "yesno", "date"];
const PROVINCES = { "Ontario": "ON", "Quebec": "QC", "British Columbia": "BC", "Alberta": "AB", "Manitoba": "MB", "Saskatchewan": "SK", "Nova Scotia": "NS",
  "New Brunswick": "NB", "Newfoundland and Labrador": "NL", "Prince Edward Island": "PE", "Yukon": "YT", "Northwest Territories": "NT", "Nunavut": "NU" };
const DEFAULTS = { features: Object.fromEntries(Object.keys(FEATURES).map(k => [k, true])), labels: {}, accent: "", region: "Ontario",
  customerFields: [], jobFields: [], reportNote: "", assistantNotes: "", css: "" };

const str = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);
const slug = s => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 30) || "field";

function cleanFields(list, kind, errors) {
  if (!Array.isArray(list)) return [];
  const out = [], ids = new Set();
  for (const f of list.slice(0, 20)) {
    const label = str(f?.label, 40); if (!label) continue;
    const type = FIELD_TYPES.includes(f?.type) ? f.type : "text";
    let id = /^[a-z][a-z0-9_]{0,30}$/.test(f?.id || "") ? f.id : slug(label);
    while (ids.has(id)) id = `${id.slice(0, 27)}_${ids.size}`;
    ids.add(id);
    const field = { id, label, type, onReport: !!f?.onReport };
    if (type === "select") {
      field.options = [...new Set((Array.isArray(f.options) ? f.options : String(f.options || "").split(",")).map(o => str(o, 40)).filter(Boolean))].slice(0, 20);
      if (!field.options.length) errors.push(`Add choices for the ${kind} field “${label}”.`);
    }
    out.push(field);
  }
  return out;
}
function clean(input) {
  const errors = [], c = JSON.parse(JSON.stringify(DEFAULTS)), i = input || {};
  for (const k of Object.keys(FEATURES)) if (i.features && k in i.features) c.features[k] = !!i.features[k];
  for (const k of Object.keys(LABELS)) { const v = str(i.labels?.[k], 30); if (v) c.labels[k] = v; }
  if (i.accent) { if (/^#[0-9a-f]{6}$/i.test(i.accent)) c.accent = i.accent.toLowerCase(); else errors.push("The brand colour must look like #1a7f5a."); }
  c.region = str(i.region, 60) || DEFAULTS.region;
  c.customerFields = cleanFields(i.customerFields, "customer", errors);
  c.jobFields = cleanFields(i.jobFields, "job", errors);
  c.reportNote = str(i.reportNote, 1500);
  c.assistantNotes = str(i.assistantNotes, 3000);
  const css = String(i.css ?? "").slice(0, 8000);
  // CSS can restyle the app but must not load anything from elsewhere or escape the style tag.
  if (/@import|url\s*\(|expression\s*\(|javascript:|<\s*\/|behavior\s*:|-moz-binding/i.test(css)) errors.push("Custom CSS can’t use @import, url(), or anything that loads files. Use colours, sizes and spacing only.");
  else c.css = css.trim();
  return { custom: c, errors };
}
const merge = saved => clean(saved || {}).custom;   // fills defaults for anything missing
const provinceCode = region => PROVINCES[region] || (/^[A-Z]{2}$/.test(region || "") ? region : "");
// Formats a custom field value for reports and spreadsheets.
function display(field, v) {
  if (v === undefined || v === null || v === "") return "";
  if (field.type === "yesno") return v === true || v === "yes" || v === "Yes" ? "Yes" : v === false || v === "no" || v === "No" ? "No" : String(v);
  return String(v);
}
// Keeps only values for fields that exist, in the right shape.
function cleanValues(fields, values) {
  const out = {};
  for (const f of fields) {
    let v = values?.[f.id]; if (v === undefined || v === null || v === "") continue;
    if (f.type === "number") { v = Number(v); if (!isFinite(v)) continue; }
    else if (f.type === "yesno") { if (!["Yes", "No"].includes(v)) continue; }
    else if (f.type === "select") { if (!f.options.includes(v)) continue; }
    else if (f.type === "date") { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue; }
    else v = str(v, f.type === "textarea" ? 2000 : 200);
    out[f.id] = v;
  }
  return out;
}
module.exports = { FEATURES, LABELS, FIELD_TYPES, PROVINCES, DEFAULTS, clean, merge, provinceCode, display, cleanValues };
