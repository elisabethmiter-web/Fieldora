# Field Service Scheduler

A scheduling and service-report app for field service businesses: equipment service, HVAC, plumbing, electrical, or any trade that visits customers to install, repair and maintain equipment. Built for use on a phone. Weekly schedule, personal time, a map with trip planning, maintenance plans coming due, customer and equipment records, digital service forms that email a PDF report through Outlook, SharePoint/Excel import, and exports. Runs on Render as one web service plus one PostgreSQL database.

Each business gets its own copy (its own Render app and database), set up for its trade on first sign-in.

## What's in this folder

| File | What it does |
|---|---|
| `server.js` | The server: sign-in, two-step login, accounts and access, saving data, address lookup, service reports and email |
| `lib/totp.js` | Authenticator-app codes for two-step login |
| `lib/industries.js` | Trade presets: job types, equipment details, brands and default service forms for each trade |
| `lib/forms.js` | Service form designs: the defaults, checking custom forms, and reading older reports |
| `lib/report-pdf.js` | Builds the PDF service report from the form design, with your logo |
| `lib/graph.js` | Connection to Microsoft 365 (used for Outlook email and SharePoint) |
| `lib/mail.js` | Sends email from the business's Outlook mailbox |
| `lib/importer.js` | Reads SharePoint lists, Excel and CSV files and converts them into customers |
| `public/index.html`, `public/app.js` | The app people use in their browser |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icons/` | Make it installable as an app, with a calendar icon (the installed app is named after the business) |
| `package.json`, `package-lock.json` | The packages the server needs |
| `render.yaml` | Tells Render what to create: the web service and the database |

## Deploy to Render (first time)

You need a GitHub account and a Render account.

1. **Put the code on GitHub.** Create a private repository called the repository and upload everything in this folder (keep the `lib` and `public` folders as folders). Don't upload `node_modules`.
2. **Create the app on Render.** Open `https://dashboard.render.com/blueprint/new?repo=https://github.com/YOUR-GITHUB-NAME/YOUR-REPOSITORY`, connect GitHub if asked, and click **Apply**. Render creates the web service (web service) and the database (database). When asked for the four `MS_…` / `MAIL_FROM` values, leave them blank for now.
3. **Set up the business.** Open the web service's address. On **Set up your scheduler**, enter the business name, choose the **trade**, enter the home base town (where trips start), and create the first account. This account is the **Owner**. The trade sets up job types, equipment details and service forms; everything can be changed later.

## Updating an existing deployment

Upload the new and changed files to the GitHub repo (`server.js`, `package.json`, `package-lock.json`, `render.yaml`, `README.md`, the whole `lib` folder, and the whole `public` folder). Render redeploys automatically and adds the new database columns by itself. Jobs and customers are kept.

**Check everyone's access afterwards.** Check each person's access under **Account → Team** after updating.

## Install as an app (phone, tablet, laptop)

The app installs straight from the browser. There's no app store, and every device shares the same schedule. Once installed it has the app's calendar icon, opens full screen in its own window, and loads instantly.

- **Android phones and tablets, and Chrome or Edge on Windows and Mac:** an **Install app** button appears in the app's header (and a reminder at the bottom on phones). Tap it, then **Install**.
- **iPhone and iPad:** a reminder at the bottom of the screen shows the steps: in Safari, tap **Share**, then **Add to Home Screen**, then **Add**. The installed app keeps its own sign-in, so you sign in once more the first time.
- **Safari on a Mac:** **File → Add to Dock**.
- The steps for whatever device you're on are always under **Account → Install as an app**.
- On Android and computers, a long-press or right-click on the icon offers shortcuts to Schedule, Map and Maintenance due.

The installed app still needs an internet connection for data. Without signal it still opens and shows "Offline", and nothing is saved until the connection is back. Customer and job data is never stored in the app's offline copy; only the app itself is.

**When releasing an update:** change `VERSION` at the top of `public/sw.js` (e.g. `fieldservice-v2`) so installed apps clear their old saved copy.

## Customize service forms and add your logo

The owner can change what's on the service forms under **Account → Service forms and logo**.

**Logo:** tap **Upload logo** and choose a PNG or JPG. It appears at the top of every service report, with the business name and contact details beside it (set under **Business settings**). A wide logo on a white or transparent background works best. **Remove** goes back to a header with your business name.

**Forms:** tap **Customize service forms**. The app starts with two forms: the starting forms for your trade (see **Trades and job types**). You can:
- **Add, rename, reorder or delete sections and fields.** Use ↑ ↓ to reorder and ✕ to delete.
- **Choose each field's type:** checklist item (OK / Done / Needs attention / N/A, with a note), number (with a unit like V, Hz, hrs or %), short text, long text, drop-down (type the choices separated by commas), yes/no, or date.
- **Mark fields as required.** The form can't be finished until they're filled in.
- **Create new forms or duplicate existing ones,** then choose which job types use each form under **Use this form for**.
- **Change the report title and footer line.**
- **Preview PDF** shows a sample report with your design and logo before you save.

The service date, next service date and customer email are always on every form. A field called "Recommendations" (or any field with "recommend" in its name) is also included in the email to the customer and shown in their service history.

Changing a form only affects forms started afterwards. Reports already finished keep the questions and answers they were filled in with, so old reports always print exactly as they were sent. **Reset to default** brings back your trade's starting forms.

## Export your data

Owners and staff can download everything under **Account → Export data**:
- **Everything in Excel:** one workbook with a **Customers** sheet (every field, including extra details imported from SharePoint and the next service due date), a **Jobs and appointments** sheet (every job and personal appointment, with status, notes and whether the report was emailed), and one sheet per service form with every answer in its own column.
- **All service reports (PDF):** every service report as a PDF, in a folder per customer, in one zip file.
- **Full backup:** everything (customers, jobs, form designs, logo and business settings) in one file for safekeeping. Two-step login secrets and passwords are never included.

## Import customers from SharePoint, Excel or CSV

Bring in existing customer and equipment records (for example a customer or equipment list in SharePoint) instead of typing them in. Open **Customers → Import**. Owners and staff can import.

**1. Choose the source**
- **Upload a file:** in SharePoint, open the list and choose **Export → Export to CSV** (or **Export to Excel**), or download the Excel file if the data is in a spreadsheet. Then choose the file. CSV and Excel (.xlsx) both work; title rows above the column headings are skipped automatically.
- **Read straight from SharePoint:** paste the link to the list (e.g. `https://yourcompany.sharepoint.com/sites/Operations/Lists/Customers/AllItems.aspx`) or to an Excel/CSV file stored in SharePoint (a "Copy link" sharing link works). This needs Microsoft 365 connected; see **Connect SharePoint** below.

**2. Match the columns.** The app guesses what each column is (customer name, address, town, postal code, phone, email, equipment type, brand, model, serial number, size, fuel, service interval, last and next service dates, notes). Change any guess from the drop-down. Anything that doesn't fit a field, such as transfer switch size or an assigned tech, is kept as an **extra detail** and shown under **Other details** when you open the customer. Choose **Don't import** to leave a column out.

**3. Preview.** See how many customers are new and how many are already in the app, plus a sample of exactly how they'll look. Choose what happens to customers already in the app:
- **Update them** with the SharePoint details (the default). Matching uses the serial number, or the name plus address when there's no serial number.
- **Leave them as they are.**
- **Add every row as new.**

Tick **Add each customer's last service date to their service history** to create a past maintenance entry for each one, so the history and due dates start out correct.

**4. Import and place on the map.** Imported customers need map locations for the Map tab. **Find map locations** looks up each address at about one per second; keep the window open until it finishes. Anyone it can't find is listed under the map, and you can place their pin by hand.

How values are converted:
- **Service interval:** "Annual", "Yearly" or "12" become a yearly plan; "Semi-annual" or "6 months" become every 6 months; "Quarterly" becomes every 3 months.
- **Next service date only:** the app works out the last service date from it. If there's no interval column, it assumes a yearly plan and says so in the preview.
- **Dates:** Excel dates, `2025-11-20`, `11/20/2025` and `Nov 20, 2025` are all understood. A date like `05/01/2026` that could mean either May 1 or January 5 is read as month/day, and the preview warns you how many there were.
- **Fuel:** "NG", "Nat gas" and "LP" become Natural gas and Propane.
- **Names:** separate first and last name columns are combined. If there's also a company or customer column, the person becomes the **Contact person** detail.
- **More than one piece of equipment:** each customer holds one equipment. Rows with different serial numbers become separate customer entries.

Importing the same list again later is safe: with **Update them** selected, existing customers are updated rather than duplicated.

### Connect SharePoint (optional)

Uses the same Microsoft 365 app registration as Outlook email (see **Connect Outlook email**). If that's already set up, only step 2 is new.

1. If you haven't already, follow steps 1, 3 and 5 of **Connect Outlook email** to register the app and add `MS_TENANT_ID`, `MS_CLIENT_ID` and `MS_CLIENT_SECRET` to Render. (`MAIL_FROM` is only needed for email.)
2. In the app registration, open **API permissions → Add a permission → Microsoft Graph → Application permissions**, tick **Sites.Read.All**, click **Add permissions**, then **Grant admin consent**.
3. Restart the app in Render (**Manual Deploy → Restart service**, or just save the environment variables). **Customers → Import** then shows **Read from SharePoint**.

Sites.Read.All lets the app *read* every SharePoint site in the organisation; it can't change anything. To limit it to one site, an administrator can use the **Sites.Selected** permission instead and grant it read access to just the Operations site (search Microsoft's docs for "Sites.Selected"). If reading a file link (rather than a list) is refused, also add **Files.Read.All**.

## Trades and job types

The trade chosen at setup decides the starting point. The owner can change any of it under **Account → Trade and job types**.

| Trade | Job types | Equipment details | Starting service forms |
|---|---|---|---|
| Generator service | Maintenance, Repair, Install, Sizing visit, Portable pickup (with a "Portables in shop" board) | Equipment type, brand, kW, fuel | Maintenance (14-item checklist), Service call, Sizing visit |
| HVAC | Tune-up, Service call, Installation, Estimate | Furnace / AC / heat pump / boiler etc., brand, tons, fuel | Heating tune-up, Cooling tune-up, Service call, Estimate |
| Plumbing | Maintenance, Service call, Installation, Estimate | Water heater / sump pump / softener etc., brand, gallons, fuel | Water heater maintenance, Service call, Estimate |
| Electrical | Inspection, Service call, Installation, Estimate | Panel / EV charger / surge protection etc., brand, amps | Electrical inspection, Service call, Estimate |
| General field service | Maintenance, Service call, Installation, Estimate | Equipment type, brand, size | Maintenance, Service call, Estimate |

Under **Trade and job types** you can:
- **Rename job types** (for example "Tune-up" instead of "Maintenance") and turn installation, estimate and shop work on or off. The first job type is always the recurring maintenance visit: finishing its service form moves the customer's next-due date forward.
- **Turn on shop work** for jobs where equipment is brought in or picked up. It gets its own board (to pick up → in the shop → ready to return → returned) with a name you choose.
- **Change what the equipment is called,** the size unit (kW, tons, gallons, amps…), the equipment types, the fuel or energy choices (leave blank to hide the field), and the brand suggestions.
- **Use this trade's defaults** to load another trade's settings, review them, then save. Tick **Also replace my service forms** to load that trade's default forms too; reports already finished keep their answers.

The business name (set at setup or in **Business settings**) appears in the app header, the installed app's name, report headers when there's no logo, and the emails sent to customers.

## Accounts and access

The owner adds people under **Account → Team** and gives each one of two access levels:

| Access | Can do |
|---|---|
| **Owner** | Everything, plus manage the team, business settings, and two-step login rules |
| **Staff** | Jobs, customers, map, service forms and emails, backups |

The server enforces these rules, not just the screen.

The owner can also reset someone's password or two-step login (for example, if they lose their phone), change their access, or remove them. There always has to be at least one Owner.

## Two-step login

Each person can turn it on under **Account → Two-step login**: scan the QR code with an authenticator app (Microsoft Authenticator, Google Authenticator, Authy, 1Password, etc.), type the 6-digit code, and save the 8 recovery codes somewhere safe. After that, signing in asks for the password and then a code from the app.

- **Require it for everyone:** the owner turns on two-step login for their own account first, then ticks **Account → Business settings → Require two-step login for everyone**. Anyone without it is taken straight to setup the next time they open the app and can't see any data until it's done.
- **Lost phone:** sign in with a recovery code (each works once), or ask the owner to **Reset two-step** for that account.
- Two-step secrets are stored encrypted using `SESSION_SECRET`. **Don't change `SESSION_SECRET`** on Render, or everyone's two-step login stops working and has to be reset (and everyone is signed out).

## Personal time

Tap **New job → Personal time**. Give it a title, date, and a time or **All day**. Personal time appears on everyone's schedule, striped, so nobody gets booked over a dentist appointment or school pickup.

## Map and trip planning

The **Map** tab shows every customer with a map location, coloured by maintenance status: overdue, due soon, booked, on a plan, or no plan.

**Getting customers on the map:** open a customer and tap **Find address on map**. Rural addresses sometimes land in the wrong place or only find the town, so check the pin and drag it to the right property, or tap the map where the equipment is. Saving a customer with a new address looks it up automatically. Customers without a pin are listed under the map.

**Plan a trip:**
1. Choose where to start: home base, an already-booked job (e.g. a repair in Kincardine next Tuesday), or a customer.
2. Choose a distance and how soon service needs to be due. Overdue customers are always included; customers already booked are left out.
3. **Find customers** lists the matches. Tick the ones to visit; the app puts them in a sensible driving order and draws the route.
4. **Book** creates the maintenance visits on one day, spaced out with travel time, or **Open route in Google Maps** for turn-by-turn directions.

**Day route** shows one day's jobs in appointment order with a **Navigate in Google Maps** button.

Notes:
- Distances are straight-line estimates; road distance is usually 25–40% more.
- Google Maps accepts up to 9 stops in one link.
- The map uses OpenStreetMap, which is free. Address lookups use OpenStreetMap's Nominatim service, which allows about one lookup per second; the app respects that automatically.
- The home base (where trips start and end) is set under **Account → Business settings**. If it isn't set, the map centres on your customers.

### If the map shows "Access blocked" (403)

OpenStreetMap's free map servers are run by volunteers and block apps that break their usage policy. The app follows that policy: it identifies itself and loads only the map squares on screen. If the map still shows **Access blocked**, OpenStreetMap is limiting traffic, and the fix is to use a commercial map provider instead (most have a free tier that easily covers a small business):

1. Sign up with a provider such as **MapTiler** (maptiler.com), **Stadia Maps** (stadiamaps.com) or **Thunderforest** (thunderforest.com) and create an API key.
2. In Render, open **the web service → Environment** and add:
   - `MAP_TILES_URL` — the provider's raster tile address with your key, e.g. `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY`
   - `MAP_TILES_ATTRIBUTION` — the credit line the provider asks for, e.g. `© MapTiler © OpenStreetMap contributors`
3. Click **Save changes**. Render restarts the app, and the map uses the new provider.

Address lookups ("Find address on map") are separate and keep working either way.

## Service form and emailed reports

Open a job and tap **Start service form**. Maintenance jobs get a 14-item checklist (each item OK / Done / Needs attention / N/A, plus a note), with **Mark the rest OK** to speed things up. Every job type has fields for engine hours, battery and output voltage, frequency, work performed, parts used, recommendations, and the next service date (filled in automatically from the customer's plan).

- **Save draft** keeps it if you're interrupted.
- **Finish** marks the job done, updates the customer's last-serviced date (so the next due date moves forward), creates the PDF report and, if ticked, emails it to the customer from the business's Outlook mailbox. A copy goes to that mailbox too, and it appears in Sent Items.
- Afterwards you can open the PDF, share it from a phone, send it again, or edit the form.
- Every finished report stays in the customer's **Service history** (open the customer), so you can always check what was done and when.

The business name, phone, email and website on the report come from **Account → Business settings**.

## Connect Outlook email (Microsoft 365)

Until this is done, finished reports can still be opened, downloaded, or shared from a phone. Connecting it needs someone with admin rights to the business's Microsoft 365. It takes about 15 minutes.

1. **Register the app.** Go to entra.microsoft.com → **Applications → App registrations → New registration**. Name it "Field Service Scheduler", keep the defaults, and click **Register**. Copy the **Application (client) ID** and the **Directory (tenant) ID** from the overview page.
2. **Allow it to send mail.** Open **API permissions → Add a permission → Microsoft Graph → Application permissions**, tick **Mail.Send**, and click **Add permissions**. Then click **Grant admin consent** and confirm.
3. **Create a secret.** Open **Certificates & secrets → New client secret**, choose an expiry (24 months is the maximum), and copy the secret **Value** right away; it's only shown once. Put a reminder in the calendar to renew it before it expires.
4. **Limit it to one mailbox (strongly recommended).** By default, Mail.Send lets the app send as any mailbox in the organisation. Restrict it to the business mailbox with an Exchange Online application access policy or RBAC for Applications. Microsoft's guide: search "Limiting application permissions to specific Exchange Online mailboxes."
5. **Add the values to Render.** In the Render dashboard, open **the web service → Environment** and set:
   - `MS_TENANT_ID` — the Directory (tenant) ID
   - `MS_CLIENT_ID` — the Application (client) ID
   - `MS_CLIENT_SECRET` — the secret value
   - `MAIL_FROM` — the mailbox to send from, e.g. `office@yourbusiness.com`

   Save. Render restarts the app. **Account → Email** in the app then shows which mailbox reports are sent from.

## Editing at the same time

If someone else has the same job, personal time or customer open, a yellow banner says who and when they opened it. If they save first, you're asked before your save replaces their changes. Closing the tab releases the warning straight away; otherwise it clears after 90 seconds.

## Use your own web address (optional)

To use something like `schedule.yourbusiness.com`: in Render, open the web service → **Settings → Custom Domains**, add the address, then add the CNAME record Render shows wherever the yourbusiness.com domain's DNS is managed. Render issues the HTTPS certificate automatically.

## Costs, data location and backups

- `render.yaml` uses Render's **Starter** web service and **Basic 256 MB** database. Check render.com/pricing for current rates. Avoid the free plans for real use (the free web service sleeps, and free databases are deleted after a trial period). OpenStreetMap maps and address lookups are free. Microsoft Graph email is included with Microsoft 365.
- Render hosts in the United States; this uses the **Ohio** region, the closest to Ontario. Customer names, addresses and phone numbers are stored there. If the data must stay in Canada, host on a Canadian region instead (e.g. Azure Canada Central or AWS Montréal).
- Render takes daily database backups on paid plans. Staff and owners can also download everything under **Account → Export data**.

## If something goes wrong

- **Deploy failed:** open the web service in Render and check **Logs**. The most common cause is a missing file or folder (`lib` and `public` must be in the top level of the repo).
- **Owner locked out of two-step login with no recovery codes:** if another owner exists, they can reset it. Otherwise, in Render open the database → **Connect**, run the PSQL command shown, and run `UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE username = 'your-username';` (and `DELETE FROM settings WHERE key = 'require2fa';` if it's required for everyone).
- **Forgot the only password:** same PSQL access, then `DELETE FROM users;` brings back the setup screen. Jobs and customers are not affected.
- **Emails not sending:** **Account → Email** shows whether Outlook is connected. Check the four values in Render's **Environment** tab, that admin consent was granted, and that the client secret hasn't expired. The exact reason appears in the app when a send fails.
- **"Can't reach the server":** check the internet connection, then check the web service is **Live** in Render.

## Running it on your own computer (developers)

Requires Node 22+ and a PostgreSQL database.

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/fieldservice SESSION_SECRET=any-long-random-string npm start
```

Then open http://localhost:3000. To connect to the Render database from your computer, use its **External** connection string and add `PGSSL=1`.
