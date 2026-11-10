// Example customer-only browser code: adds a "Print today's jobs" button to the header.
(() => {
  if (!window.Fielora) return;
  const { esc } = Fielora;
  Fielora.on("ready", () => {
    if (document.getElementById("daySheetBtn")) return;
    const btn = document.createElement("button");
    btn.id = "daySheetBtn"; btn.type = "button"; btn.className = "btn acct"; btn.textContent = "Print today’s jobs";
    document.getElementById("acctBtn").before(btn);
    btn.addEventListener("click", async () => {
      try {
        const d = await Fielora.api("GET", "/api/custom/day-sheet");
        const w = window.open("", "_blank"); if (!w) return Fielora.toast("Allow pop-ups to print the job sheet.");
        w.document.write(`<!doctype html><title>Jobs for ${esc(d.date)}</title><style>body{font:14px Arial;margin:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}</style>
          <h1>${esc(Fielora.label("jobs"))} for ${esc(d.date)}</h1><table><tr><th>Time</th><th>${esc(Fielora.label("customer"))}</th><th>Address</th><th>Phone</th><th>Notes</th></tr>
          ${d.jobs.map(j => `<tr><td>${esc(j.time)}</td><td>${esc(j.customer?.name || "")}</td><td>${esc([j.customer?.address, j.customer?.town].filter(Boolean).join(", "))}</td><td>${esc(j.customer?.phone || "")}</td><td>${esc(j.notes)}${j.customer?.notes ? "<br><i>" + esc(j.customer.notes) + "</i>" : ""}</td></tr>`).join("") || '<tr><td colspan="5">No jobs.</td></tr>'}</table>`);
        w.document.close(); w.focus(); w.print();
      } catch (e) { Fielora.toast(e.error || "Couldn’t load the job sheet."); }
    });
  });
})();
