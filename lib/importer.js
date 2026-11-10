"use strict";
// Reads customer/equipment data from CSV or Excel (e.g. exported from SharePoint),
// guesses which column is which, and converts rows into customer records.
const ExcelJS = require("exceljs");

const FIELDS = {
  name: "Customer / company name", firstName: "First name", lastName: "Last name", contact: "Contact person",
  phone: "Phone", email: "Email", address: "Street address", town: "Town / city", postal: "Postal code",
  equipmentType: "Equipment type", brand: "Equipment brand", model: "Equipment model", serial: "Serial number", kw: "Size / capacity", fuel: "Fuel / energy",
  plan: "Maintenance interval", lastService: "Last service date", nextService: "Next service date", notes: "Notes",
  extra: "Keep as extra detail", ignore: "Don’t import",
};

/* ---------- reading files ---------- */
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(t => t.text).join("");
    if ("result" in v) return cellValue(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.error) return "";
  }
  return v;
}

async function parseXlsx(buffer, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets.map(s => s.name);
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets.find(s => s.actualRowCount > 1) || wb.worksheets[0];
  if (!ws) throw new Error("That workbook has no sheets.");
  const rows = [];
  ws.eachRow({ includeEmpty: false }, r => {
    const vals = []; for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(r.getCell(c).value));
    if (vals.some(v => String(v).trim() !== "")) rows.push(vals);
  });
  return { rows, sheets, sheet: ws.name };
}

// rows (array of arrays) -> { columns, records } using the first row that looks like headers
function toRecords(rows) {
  if (!rows.length) throw new Error("The file is empty.");
  let h = 0; // header = first row where at least half the cells are non-empty text
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const filled = rows[i].filter(v => typeof v === "string" && v.trim()).length;
    if (filled >= Math.max(1, rows[i].length / 2)) { h = i; break; }
  }
  const seen = {};
  const columns = rows[h].map((v, i) => {
    let name = String(v instanceof Date ? "" : v).trim() || `Column ${i + 1}`;
    if (seen[name]) name = `${name} (${++seen[name]})`; else seen[name] = 1;
    return name;
  });
  const records = rows.slice(h + 1).map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""])))
    .filter(r => Object.values(r).some(v => String(v).trim() !== ""));
  return { columns, records };
}

/* ---------- guessing columns ---------- */
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const EXACT = {
  name: ["title", "customer", "customername", "client", "clientname", "name", "company", "companyname", "business", "account", "accountname", "sitename"],
  firstName: ["first", "firstname", "givenname"], lastName: ["last", "lastname", "surname", "familyname"],
  contact: ["contact", "contactname", "contactperson", "primarycontact"],
  phone: ["phone", "phonenumber", "tel", "telephone", "cell", "mobile", "primaryphone", "homephone", "workphone"],
  email: ["email", "emailaddress", "mail"],
  address: ["address", "street", "streetaddress", "address1", "civicaddress", "location", "siteaddress", "serviceaddress"],
  town: ["town", "city", "municipality", "township", "community"],
  postal: ["postal", "postalcode", "postcode", "zip", "zipcode"],
  equipmentType: ["type", "equipmenttype", "unittype", "systemtype", "equipment", "system", "appliance"],
  brand: ["brand", "make", "manufacturer", "generatormake", "generatorbrand", "genmake", "unitmake", "equipmentmake"],
  model: ["model", "generatormodel", "modelnumber", "modelno", "unitmodel"],
  serial: ["serial", "serialnumber", "serialno", "sn", "generatorserial", "unitserial"],
  kw: ["kw", "size", "kva", "rating", "generatorsize", "capacity", "output", "kwrating", "tons", "tonnage", "btu", "btuh", "gallons", "amps", "amperage"],
  fuel: ["fuel", "fueltype"],
  plan: ["plan", "interval", "serviceinterval", "frequency", "maintenanceplan", "servicefrequency", "contract", "serviceplan"],
  lastService: ["lastservice", "lastserviced", "lastservicedate", "datelastserviced", "lastmaintenance", "lastpm", "servicedate", "lastvisit"],
  nextService: ["nextservice", "nextservicedate", "nextdue", "duedate", "nextpm", "nextmaintenance", "servicedue", "nextvisit"],
  notes: ["notes", "note", "comments", "comment", "remarks", "description", "details"],
};
const CONTAINS = [ // checked in order; first rule that fits wins
  ["nextService", n => n.includes("next") && /(serv|due|pm|maint|visit)/.test(n)],
  ["lastService", n => (n.includes("last") || n.includes("prev")) && /(serv|pm|maint|visit)/.test(n)],
  ["serial", n => n.includes("serial")],
  ["model", n => n.includes("model")],
  ["brand", n => /(make|brand|manufact)/.test(n)],
  ["fuel", n => n.includes("fuel")],
  ["kw", n => /(kw|kva|ton|btu|gallon|amp)/.test(n)],
  ["equipmentType", n => /(equipment|unit|system)type/.test(n)],
  ["plan", n => /(interval|frequency|plan)/.test(n)],
  ["email", n => n.includes("mail")],
  ["phone", n => /(phone|cell|mobile|tel)/.test(n)],
  ["postal", n => /(postal|zip)/.test(n)],
  ["town", n => /(city|town)/.test(n)],
  ["address", n => /(address|street)/.test(n)],
  ["firstName", n => n.includes("first") && n.includes("name")],
  ["lastName", n => (n.includes("last") || n.includes("sur")) && n.includes("name")],
  ["name", n => /(customer|client|company|owner)/.test(n) && !n.includes("contact")],
  ["contact", n => n.includes("contact")],
  ["notes", n => /(note|comment|remark)/.test(n)],
];
function guessMapping(columns) {
  const used = new Set(), map = {};
  for (const c of columns) {
    const n = norm(c);
    const f = Object.keys(EXACT).find(k => !used.has(k) && EXACT[k].includes(n));
    if (f) { map[c] = f; used.add(f); }
  }
  for (const c of columns) {
    if (map[c]) continue;
    const n = norm(c);
    const rule = CONTAINS.find(([k, test]) => !used.has(k) && test(n));
    if (rule) { map[c] = rule[0]; used.add(rule[0]); } else map[c] = "extra";
  }
  return map;
}

/* ---------- converting values ---------- */
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function toDate(v, warn) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return isNaN(v) ? "" : isoOf(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === "number" && v > 20000 && v < 80000) { // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return isoOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let mo, d;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { mo = a; d = b; if (a !== b && warn) warn.ambiguous++; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[2])}`;
  }
  if ((m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/i)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
  const t = Date.parse(s); if (!isNaN(t)) return isoOf(new Date(t));
  if (warn) warn.badDates++;
  return "";
}
function toPlan(v) {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return "";
  if (/(none|no plan|n\/a|^no$)/.test(s)) return "none";
  if (/(quarter|3\s*mo|every 3|^3$)/.test(s)) return "3";
  if (/(semi|bi-?annual|twice|6\s*mo|every 6|^6$|half)/.test(s)) return "6";
  if (/(annual|year|12\s*mo|every 12|^12$|^1$|once)/.test(s)) return "12";
  const n = parseInt(s, 10); if ([3, 6, 12].includes(n)) return String(n);
  return "";
}
function toFuel(v) {
  const s = String(v ?? "").toLowerCase();
  if (!s.trim()) return "";
  if (/(natural|\bng\b|nat gas|^gas$)/.test(s)) return "Natural gas";
  if (/(propane|lp|lpg)/.test(s)) return "Propane";
  if (/diesel/.test(s)) return "Diesel";
  if (/(gasoline|petrol|unleaded)/.test(s)) return "Gasoline (portable)";
  return String(v).trim();
}
function toKw(v) { const m = String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : ""; }
const txt = v => (v instanceof Date ? isoOf(v) : String(v ?? "")).trim();
function addMonths(iso, m) {
  const [y, mo, d] = iso.split("-").map(Number); const dt = new Date(y, mo - 1, 1); dt.setMonth(dt.getMonth() + m);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); dt.setDate(Math.min(d, last)); return isoOf(dt);
}

// One record -> customer object (+ any warnings)
function convert(record, mapping, warn) {
  const c = { plan: "none" }, extra = {}, first = [], notes = [];
  let next = "", contact = "";
  for (const [col, field] of Object.entries(mapping)) {
    const raw = record[col]; const val = txt(raw);
    if (field === "ignore" || (val === "" && !(raw instanceof Date))) continue;
    switch (field) {
      case "name": c.name = val; break;
      case "firstName": first[0] = val; break;
      case "lastName": first[1] = val; break;
      case "contact": contact = val; break;
      case "phone": c.phone = c.phone ? `${c.phone} / ${val}` : val; break;
      case "email": c.email = val.replace(/^mailto:/i, ""); break;
      case "address": c.address = val; break;
      case "town": c.town = val; break;
      case "postal": c.postal = val.toUpperCase(); break;
      case "equipmentType": c.equipmentType = val; break;
      case "brand": c.brand = val; break;
      case "model": c.model = val; break;
      case "serial": c.serial = val; break;
      case "kw": c.kw = toKw(val); break;
      case "fuel": c.fuel = toFuel(val); break;
      case "plan": { const p = toPlan(val); if (p) c.plan = p; else extra[col] = val; break; }
      case "lastService": c.lastService = toDate(raw, warn); break;
      case "nextService": next = toDate(raw, warn); break;
      case "notes": notes.push(val); break;
      case "extra": extra[col] = raw instanceof Date ? isoOf(raw) : val; break;
    }
  }
  const person = first.filter(Boolean).join(" ");
  if (!c.name) c.name = person || contact; else if (person && person !== c.name) contact = contact || person;
  if (contact && contact !== c.name) extra["Contact person"] = contact;
  if (notes.length) c.notes = notes.join("\n");
  // Work out last service from the next-service date when only that is known.
  if (next) {
    extra["Next service (from SharePoint)"] = next;
    if (!c.lastService) {
      if (c.plan === "none") { c.plan = "12"; if (warn) warn.assumedYearly++; }
      c.lastService = addMonths(next, -Number(c.plan));
    }
  }
  if (Object.keys(extra).length) c.extra = extra;
  c.importedAt = new Date().toISOString();
  return c;
}

// Key used to spot the same customer/equipment twice
function dedupeKey(c) {
  if (c.serial) return "s:" + norm(c.serial);
  return "n:" + norm(c.name) + "|" + norm(c.address || "") + "|" + norm(c.town || "");
}

module.exports = { FIELDS, parseCsv, parseXlsx, toRecords, guessMapping, convert, dedupeKey };
