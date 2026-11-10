"use strict";
const PDFDocument = require("pdfkit");
const { upgradeLegacy, display } = require("./forms");

const INK = "#1D2125", GREY = "#555C62", LINE = "#CDD2CC", YELLOW = "#F4C20D", ZEBRA = "#F2F3F0";
const RESULT_COLORS = { OK: "#2F6B46", Done: "#2F6B46", "Needs attention": "#B4472B", "N/A": "#777F85" };

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y) return String(iso);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}
const clean = v => (v === undefined || v === null) ? "" : String(v);

// Returns a Promise<Buffer>. logo: { buffer } PNG/JPEG or null. footer: custom footer line.
const customLib = require("./custom");
function buildReport({ job, customer = {}, form = {}, business = {}, logo = null, footer = "", industry = {}, custom = null }) {
  const cz = custom || customLib.merge({}), prov = customLib.provinceCode(cz.region);
  form = upgradeLegacy(form) || {};
  const tpl = form.snapshot || { title: "Service Report", sections: [] };
  const values = form.values || {};
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", bufferPages: true, margins: { top: 50, bottom: 60, left: 50, right: 50 }, info: { Title: tpl.title, Author: business.name || "Service report" } });
    const chunks = [];
    doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = h => { if (doc.y + h > bottom()) doc.addPage(); };
    const name = business.name || "Service Report";
    const contact = [business.phone, business.email, business.website].filter(Boolean);

    // ---- header ----
    if (logo && logo.buffer) {
      try { doc.image(logo.buffer, L, 32, { fit: [220, 62], align: "left", valign: "center" }); }
      catch { doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(name, L, 50); }
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(name, L, 36, { width: W, align: "right" });
      doc.font("Helvetica").fontSize(9).fillColor(GREY);
      contact.forEach((c, i) => doc.text(c, L, 51 + i * 12, { width: W, align: "right" }));
      doc.rect(L, 102, W, 3).fill(YELLOW);
      doc.y = 120;
    } else {
      doc.rect(0, 0, doc.page.width, 78).fill(INK);
      doc.rect(0, 78, doc.page.width, 5).fill(YELLOW);
      doc.font("Helvetica-Bold").fontSize(20).fillColor("#FFFFFF").text(name, L, 24, { width: W * 0.62, height: 26, ellipsis: true });
      if (contact.length) doc.font("Helvetica").fontSize(9).fillColor("#FFFFFF").text(contact.join("   "), L, 54, { width: W, align: "right" });
      doc.y = 104;
    }
    doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(tpl.title || "Service Report", L);
    doc.font("Helvetica").fontSize(10).fillColor(GREY).text(`Service date: ${fmtDate(form.serviceDate || job.date)}`);
    doc.moveDown(0.8);

    // ---- customer / equipment ----
    const colW = (W - 20) / 2, top = doc.y;
    const block = (x, title, lines) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text(title.toUpperCase(), x, top, { width: colW, characterSpacing: 0.5 });
      doc.moveDown(0.3); doc.font("Helvetica").fontSize(10.5).fillColor(INK);
      lines.filter(Boolean).forEach(t => doc.text(t, x, doc.y, { width: colW }));
      return doc.y;
    };
    const y1 = block(L, "Customer", [customer.name, customer.address, [customer.town, prov, customer.postal].filter(Boolean).join(", "), customer.phone, customer.email]);
    const unit = industry.sizeUnit === undefined ? "kW" : industry.sizeUnit;
    const gen = [customer.equipmentType, [customer.brand, customer.model].filter(Boolean).join(" "), customer.serial ? `Serial: ${customer.serial}` : "", [customer.kw ? `${customer.kw}${unit ? " " + unit : ""}` : "", customer.fuel].filter(Boolean).join(" · ")];
    const y2 = block(L + colW + 20, industry.equipment || "Equipment", gen.some(Boolean) ? gen : ["Not recorded"]);
    doc.y = Math.max(y1, y2) + 14;

    // ---- sections from the form template ----
    const sectionTitle = t => { if (!t) return; ensure(40); doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(t, L); doc.moveDown(0.4); };
    const tiles = list => { // short answers as a grid of tiles, 4 per row
      const per = 4, tw = W / per;
      for (let i = 0; i < list.length; i += per) {
        const row = list.slice(i, i + per);
        doc.font("Helvetica-Bold").fontSize(12);
        const h = Math.max(...row.map(([f, v]) => doc.heightOfString(display(f, v), { width: tw - 18 }))) + 30;
        ensure(h + 6); const ry = doc.y;
        doc.rect(L, ry, W, h).fill(ZEBRA);
        row.forEach(([f, v], k) => {
          doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(f.label, L + k * tw + 10, ry + 7, { width: tw - 16, height: 11, ellipsis: true });
          doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(display(f, v), L + k * tw + 10, ry + 20, { width: tw - 18 });
        });
        doc.y = ry + h + 6;
      }
      doc.moveDown(0.5);
    };
    const checks = list => {
      const cItem = W * 0.45, cRes = W * 0.18, cNote = W - cItem - cRes;
      const head = () => {
        const hy = doc.y; doc.rect(L, hy, W, 18).fill(INK);
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF");
        doc.text("ITEM", L + 8, hy + 5, { width: cItem - 10 }); doc.text("RESULT", L + cItem + 4, hy + 5, { width: cRes - 8 }); doc.text("NOTES", L + cItem + cRes + 4, hy + 5, { width: cNote - 10 });
        doc.y = hy + 18;
      };
      ensure(40); head();
      list.forEach(([f, v], idx) => {
        doc.font("Helvetica").fontSize(9.5);
        const h = Math.max(doc.heightOfString(f.label, { width: cItem - 14 }), doc.heightOfString(clean(v?.note), { width: cNote - 12 })) + 10;
        if (doc.y + h > bottom()) { doc.addPage(); head(); }
        const ry = doc.y;
        if (idx % 2) doc.rect(L, ry, W, h).fill(ZEBRA);
        doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(f.label, L + 8, ry + 5, { width: cItem - 14 });
        doc.fillColor(RESULT_COLORS[v?.result] || GREY).font("Helvetica-Bold").text(v?.result || "—", L + cItem + 4, ry + 5, { width: cRes - 8 });
        doc.fillColor(INK).font("Helvetica").text(clean(v?.note), L + cItem + cRes + 4, ry + 5, { width: cNote - 12 });
        doc.y = ry + h;
      });
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.moveDown(1);
    };
    const para = (f, v) => {
      ensure(40);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(f.label, L);
      doc.moveDown(0.2); doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(String(v), L, doc.y, { width: W });
      doc.moveDown(0.8);
    };
    for (const sec of tpl.sections || []) {
      const answered = sec.fields.filter(f => values[f.id] !== undefined && values[f.id] !== "");
      if (!answered.length) continue;
      sectionTitle(sec.title);
      // keep the template's order, grouping runs of the same kind; checklist items always show (with "—" if blank)
      let run = [], kind = null;
      const flush = () => { if (!run.length) return; if (kind === "check") checks(run); else if (kind === "short") tiles(run); else run.forEach(([f, v]) => para(f, v)); run = []; };
      for (const f of sec.fields) {
        const v = values[f.id];
        const k = f.type === "check" ? "check" : f.type === "textarea" ? "long" : "short";
        if (k === "check") { if (k !== kind) { flush(); kind = k; } run.push([f, v || { result: "", note: "" }]); continue; }
        if (v === undefined || v === "") continue;
        if (k !== kind) { flush(); kind = k; }
        run.push([f, v]);
      }
      flush();
    }

    // ---- this business's own fields (only the ones marked "show on report") ----
    const extraRows = [
      ...cz.customerFields.filter(f => f.onReport).map(f => [f.label, customLib.display(f, customer.custom?.[f.id])]),
      ...cz.jobFields.filter(f => f.onReport).map(f => [f.label, customLib.display(f, job.custom?.[f.id])]),
    ].filter(([, v]) => v);
    if (extraRows.length) {
      sectionTitle("Job details");
      for (const [label, v] of extraRows) {
        ensure(22); const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(10).fillColor(GREY).text(clean(label), L, y, { width: W * 0.34 });
        const yl = doc.y;
        doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(clean(v), L + W * 0.36, y, { width: W * 0.64 });
        doc.y = Math.max(yl, doc.y) + 4;
      }
      doc.moveDown(0.6);
    }

    // ---- sign-off ----
    ensure(70);
    const by = doc.y + 4, half = W / 2;
    doc.rect(L, by, W, 54).lineWidth(0.75).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text("Next service due", L + 12, by + 10);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(fmtDate(form.nextService) || "—", L + 12, by + 24);
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text("Serviced by", L + half + 12, by + 10);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(clean(form.technician) || name, L + half + 12, by + 24, { width: half - 24 });
    doc.y = by + 70;
    if (cz.reportNote) { ensure(40); doc.font("Helvetica").fontSize(9).fillColor(GREY).text(clean(cz.reportNote), L, doc.y, { width: W }); doc.moveDown(0.5); }

    // ---- footer on every page ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const keep = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      const fy = doc.page.height - 40;
      doc.font("Helvetica").fontSize(8).fillColor(GREY)
        .text(footer || `Thank you for choosing ${name}.`, L, fy, { width: W * 0.75, lineBreak: false })
        .text(`Page ${i - range.start + 1} of ${range.count}`, L + W * 0.75, fy, { width: W * 0.25, align: "right", lineBreak: false });
      doc.page.margins.bottom = keep;
    }
    doc.end();
  });
}
module.exports = { buildReport };
