# Customer-only code (`custom/`)

Every customer runs the **same Fielora code**, so fixes and new features reach everyone with one update. When one customer needs something that only makes sense for them, it goes in its own folder here and only switches on for their app.

**Try the no-code customizations first.** In **Fielora Admin → (customer) → Customize**, you can hide parts of the app, rename words like "Customers" or "Job", add their own fields to customers and jobs (and print them on reports), set a brand colour, add a note to every report, give the AI assistant notes about how they work, and add styling. Those apply instantly and need no code or redeploy. Only use this folder for things those can't do.

## How it works

1. Copy `custom/_example` to a folder named for the customer, in lowercase with dashes, e.g. `custom/plumbing-go`.
2. Edit the files (all optional):
   - `server.js`: adds server routes or logic. Exports `register(ctx)`, `name` and `version`.
   - `client.js`: runs in the browser after the main app. Use `window.Fielora` (below).
   - `client.css`: extra styles.
3. Commit and push. The code deploys to **every** customer's app, but stays switched off.
4. In Render, open **that customer's** Fielora service → **Environment** → add `FIELORA_CUSTOM` = `plumbing-go` → **Save changes**.

Only that app loads the folder. The Fielora Admin dashboard shows which custom code each customer runs (and if it failed to load). Remove `FIELORA_CUSTOM` to switch it off.

## Server side: `register(ctx)`

`ctx` gives you: `app` (Express), `pool` (Postgres), `auth` (signed-in users only), `allow("owner")`, `workers` (owners and staff), `wrap` (async error handling), `getSettings()`, `putSetting(key, value)`, `adminRouter` (adds routes under `/api/admin/v1/…`, protected by the admin key), and `adminLog(req, action, detail)`.

- Put routes under **`/api/custom/…`** so they never clash with Fielora's own.
- Always use `auth` (and `allow`/`workers` where needed) on routes that read or change data.
- Store extra data in its own table with a `custom_<name>_` prefix (create it with `CREATE TABLE IF NOT EXISTS` in `register`), or in a setting named `custom_<name>`.
- State-changing requests from the browser must send the header `X-Requested-With: fielora` (the `Fielora.api()` helper does this for you).

## Browser side: `window.Fielora`

- `Fielora.on("ready", state => …)` runs once the person is signed in and data has loaded.
- `Fielora.on("render", state => …)` runs after each refresh (about every 30 seconds and after changes).
- `Fielora.on("jobDialog", ({ id, job, dialog }) => …)` and `Fielora.on("customerDialog", ({ id, customer, dialog }) => …)` run when those windows open.
- `Fielora.on("customized", custom => …)` runs when the no-code settings are applied.
- `Fielora.api(method, url, body)`, `Fielora.toast(message)`, `Fielora.esc(text)` (escape before putting text into HTML), `Fielora.state` (current user, customers, jobs, settings), `Fielora.openJob(id)`, `Fielora.openCustomer(id)`, `Fielora.label(key)`.

Always escape customer data with `Fielora.esc()` before inserting it as HTML.

## Keep it safe to update

- Don't edit Fielora's own files for one customer. If several customers want the same thing, build it into Fielora properly (and maybe as a no-code option) instead.
- Use the hooks rather than relying on how Fielora's HTML happens to be laid out, so updates don't break custom code.
- After each Fielora update, open the customer's app and check their custom feature still works.

## Example

`custom/_example` adds a **Print today's jobs** button that opens a printable job sheet for the day, plus a small server route. It's a working template to copy.
