"use strict";
// Example customer-only server code. Copy this folder to custom/<customer-name>/ and
// set FIELORA_CUSTOM=<customer-name> on that customer's Render service.
module.exports = {
  name: "Example: printable daily job sheet",
  version: "1.0.0",
  register({ app, pool, auth, workers, wrap }) {
    // GET /api/custom/day-sheet?date=YYYY-MM-DD — the day's jobs with customer details, in time order.
    app.get("/api/custom/day-sheet", auth, workers, wrap(async (req, res) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : new Date().toISOString().slice(0, 10);
      const { rows } = await pool.query(
        `SELECT j.id, j.data AS job, c.data AS customer FROM jobs j LEFT JOIN customers c ON c.id = j.data->>'customerId'
         WHERE j.data->>'date' = $1 AND j.data->>'type' <> 'personal' AND coalesce(j.data->>'status','') <> 'cancelled'
         ORDER BY coalesce(j.data->>'time', '99:99')`, [date]);
      res.json({ date, jobs: rows.map(r => ({ id: r.id, time: r.job.time || "", duration: r.job.duration || "", notes: r.job.notes || "",
        customer: r.customer ? { name: r.customer.name, address: r.customer.address, town: r.customer.town, phone: r.customer.phone, notes: r.customer.notes } : null })) });
    }));
  },
};
