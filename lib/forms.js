"use strict";
// Customizable service form templates.
// A template = { id, name, title, sections: [{ id, title, fields: [{ id, label, type, unit?, options?, required?, help? }] }] }
// Field types: check (OK / Done / Needs attention / N/A + note), number, text, textarea, select, yesno, date.

const TYPES = ["check", "number", "text", "textarea", "select", "yesno", "date"];
const JOB_TYPES = ["pm", "repair", "install", "assess", "portable"];
const RESULTS = ["OK", "Done", "Needs attention", "N/A"];

const CHECKS = [
  "Engine oil and filter changed", "Air filter inspected / replaced", "Spark plugs inspected / replaced",
  "Coolant level and hoses (liquid-cooled)", "Belts inspected", "Battery load-tested, terminals cleaned",
  "Fuel supply and connections checked for leaks", "Exhaust system inspected", "Wiring and connections inspected",
  "Enclosure, vents and air intake clear", "Controller alarms and event log reviewed", "Exercise schedule verified",
  "Transfer switch operation tested", "Run test under load",
];
const readings = () => ({ id: "readings", title: "Readings", fields: [
  { id: "runHours", label: "Engine hours", type: "number", unit: "hrs" },
  { id: "batteryVoltage", label: "Battery voltage", type: "number", unit: "V" },
  { id: "outputVoltage", label: "Output voltage", type: "number", unit: "V" },
  { id: "frequency", label: "Frequency", type: "number", unit: "Hz" },
] });
const closing = () => ({ id: "work", title: "Work and recommendations", fields: [
  { id: "workDone", label: "Work performed", type: "textarea" },
  { id: "parts", label: "Parts used", type: "textarea" },
  { id: "recommendations", label: "Recommendations for the customer", type: "textarea" },
] });
function defaults() {
  return {
    templates: [
      { id: "maintenance", name: "Maintenance", title: "Generator Maintenance Report", sections: [
        readings(),
        { id: "checklist", title: "Checklist", fields: CHECKS.map((label, i) => ({ id: `chk${i + 1}`, label, type: "check" })) },
        closing(),
      ] },
      { id: "service", name: "Service visit", title: "Generator Service Report", sections: [
        { id: "readings", title: "Readings", fields: readings().fields.slice(0, 2) },
        closing(),
      ] },
    ],
    assign: { pm: "maintenance", repair: "service", install: "service", assess: "service", portable: "service" },
    footer: "",
  };
}

const s = (v, n) => String(v ?? "").slice(0, n);
const slug = (v, fallback) => (String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || fallback);

// Validates a full forms configuration from the builder. Throws with a friendly message.
function sanitize(cfg) {
  if (!cfg || !Array.isArray(cfg.templates) || !cfg.templates.length) throw new Error("Keep at least one form.");
  if (cfg.templates.length > 20) throw new Error("Up to 20 forms are allowed.");
  const ids = new Set();
  const templates = cfg.templates.map((t, ti) => {
    let id = slug(t.id, `form${ti + 1}`); while (ids.has(id)) id += "x"; ids.add(id);
    const name = s(t.name, 60).trim(); if (!name) throw new Error("Every form needs a name.");
    const fieldIds = new Set();
    const sections = (Array.isArray(t.sections) ? t.sections : []).slice(0, 30).map((sec, si) => ({
      id: slug(sec.id, `sec${si + 1}`), title: s(sec.title, 80).trim(),
      fields: (Array.isArray(sec.fields) ? sec.fields : []).slice(0, 80).map((f, fi) => {
        const type = TYPES.includes(f.type) ? f.type : "text";
        let fid = slug(f.id, `f${si + 1}_${fi + 1}`); while (fieldIds.has(fid)) fid += "x"; fieldIds.add(fid);
        const label = s(f.label, 160).trim(); if (!label) throw new Error(`A field in “${name}” has no label.`);
        const out = { id: fid, label, type };
        if (type === "number" && f.unit) out.unit = s(f.unit, 12).trim();
        if (type === "select") {
          out.options = (Array.isArray(f.options) ? f.options : String(f.options || "").split(",")).map(o => s(o, 60).trim()).filter(Boolean).slice(0, 30);
          if (!out.options.length) throw new Error(`The drop-down “${label}” needs at least one choice.`);
        }
        if (f.required) out.required = true;
        if (f.help) out.help = s(f.help, 200).trim();
        return out;
      }),
    }));
    if (!sections.some(sec => sec.fields.length)) throw new Error(`The form “${name}” has no fields.`);
    return { id, name, title: s(t.title, 80).trim() || name, sections };
  });
  const assign = {};
  for (const jt of JOB_TYPES) assign[jt] = templates.some(t => t.id === cfg.assign?.[jt]) ? cfg.assign[jt] : templates[0].id;
  return { templates, assign, footer: s(cfg.footer, 200).trim() };
}

// Turns a form saved before templates existed into the new shape, so old reports still print.
function upgradeLegacy(form) {
  if (!form || form.snapshot) return form;
  const def = defaults();
  const isPm = Array.isArray(form.items) && form.items.length;
  const tpl = JSON.parse(JSON.stringify(def.templates[isPm ? 0 : 1]));
  const values = { runHours: form.runHours, batteryVoltage: form.batteryVoltage, outputVoltage: form.outputVoltage, frequency: form.frequency,
    workDone: form.workDone, parts: form.parts, recommendations: form.recommendations };
  if (isPm) {
    const chk = tpl.sections.find(x => x.id === "checklist");
    chk.fields = form.items.map((it, i) => ({ id: `chk${i + 1}`, label: it.label, type: "check" }));
    form.items.forEach((it, i) => { values[`chk${i + 1}`] = { result: it.result || "", note: it.note || "" }; });
  }
  return { templateId: tpl.id, snapshot: tpl, values, serviceDate: form.serviceDate, nextService: form.nextService, emailTo: form.emailTo,
    technician: form.technician };
}

// Cleans submitted form answers against the template snapshot the technician filled in.
function cleanAnswers(input, tpl) {
  const snap = sanitize({ templates: [tpl], assign: {} }).templates[0];
  const values = {};
  const fields = snap.sections.flatMap(x => x.fields);
  for (const f of fields) {
    const v = input?.values?.[f.id];
    if (v === undefined || v === null) continue;
    if (f.type === "check") {
      const result = RESULTS.includes(v.result) ? v.result : "";
      const note = s(v.note, 500).trim();
      if (result || note) values[f.id] = { result, note };
    } else if (f.type === "select") { const x = s(v, 60); if (f.options.includes(x)) values[f.id] = x; }
    else if (f.type === "yesno") { if (v === "Yes" || v === "No") values[f.id] = v; }
    else if (f.type === "date") { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) values[f.id] = v; }
    else { const x = s(v, f.type === "textarea" ? 4000 : 300).trim(); if (x) values[f.id] = x; }
  }
  return { snapshot: snap, values, missing: fields.filter(f => f.required && !values[f.id]).map(f => f.label) };
}

// Plain-text value for exports and emails.
function display(f, v) {
  if (v === undefined || v === null || v === "") return "";
  if (f.type === "check") return [v.result, v.note].filter(Boolean).join(" — ");
  if (f.type === "number" && f.unit) return `${v} ${f.unit}`;
  return String(v);
}
function recommendations(form) {
  const f = upgradeLegacy(form); if (!f?.snapshot) return "";
  const field = f.snapshot.sections.flatMap(x => x.fields).find(x => x.id === "recommendations" || /recommend/i.test(x.label));
  return field ? String(f.values?.[field.id] || "") : "";
}

module.exports = { TYPES, JOB_TYPES, RESULTS, defaults, sanitize, upgradeLegacy, cleanAnswers, display, recommendations };
