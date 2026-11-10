# Fielora user guide (for the support assistant)

Fielora is a scheduling and service-report app for field service businesses (generator service, HVAC, plumbing, electrical and other trades). It works in a web browser on phones, tablets and computers, and can be installed like an app. Each business has its own private copy.

## Signing in
- Sign in with your username and password. If two-step login is on, you then enter the 6-digit code from your authenticator app.
- **Forgot password:** tap **Forgot password?** on the sign-in screen and enter your username. Your company's owners and managers (and the support team, if support access is on) are told. They set a **temporary password** and give it to you in person or by phone. You can also just ask an owner or manager directly. Password reset emails are not used.
- **Temporary passwords:** when you sign in with one, Fielora asks you to choose your own password before you can continue. New team members do this on their first sign-in too.
- **Lost your phone (two-step login):** sign in with one of your recovery codes (each works once), or ask an owner (or a manager, if you're Staff) to use **Reset two-step** in **Account → Team**.
- **Your email address** (optional, so your team can reach you): **Account → Your email**.
- **Change password:** **Account → Change your password**. Other devices are signed out.

## Access levels
- **Staff:** can see the schedule, customers and map; open jobs and customers (view only); fill in and finish service forms; and add, change or delete their **own personal time** (the **Personal time** button or the + on a day). Staff can't create, change or delete jobs or customers, change or delete a finished service form, design service forms, import, export, or manage the team.
- **Manager:** everything Staff can do, plus create, change and delete jobs and customers; book maintenance visits and plan trips; set up and customize service forms and the logo; change or **delete** service forms; import and export; and in **Account → Team**: add Staff, set a temporary password or reset two-step login for Staff, remove Staff, and handle Staff password requests.
- **Owner:** everything, including business settings, trade and job types, two-step login rules, adding or removing Managers and Owners, changing anyone's access, setting a temporary password for anyone, and **Account → Support access**. There must always be at least one Owner.
- **Password help requests** appear at the top of **Account → Team** for owners and managers (a red dot shows on **Account** when one is waiting). Check it's really the person, then tap **Set temporary password** (or **Dismiss**).

## The schedule
- The **Schedule** tab shows the week. Use **‹ Prev**, **Today** and **Next ›** to move between weeks. Jobs are colour-coded by job type (the legend is under the week). Urgent calls (marked as an outage/urgent priority) float to the top of the day.
- **New job:** tap **New job** (or the + on a day). Choose the customer, job type, date, time, how long it takes, priority and notes. Save.
- **Edit or complete a job:** tap the job. You can change details, mark it done, or open its service form.
- **Personal time:** create a job with the type **Personal time** (for example, a dentist appointment or day off). It shows striped on the schedule so nobody books over it. It can be all day.
- **Someone else editing:** if another person has the same job or customer open, a yellow banner says who. When you save, Fielora warns you if they changed it in the meantime.

## Customers and equipment
- The **Customers** tab lists customers. Tap one to see or edit contact details, address, equipment (type, brand, model, serial, size, fuel), maintenance plan, last service date, notes and service history (past jobs with links to their reports).
- **Add customer:** **Customers → Add customer**. The address is placed on the map automatically; if the pin is wrong, drag it to the right spot.
- **Maintenance plan:** choose how often the customer is serviced (every 3, 6 or 12 months). Fielora works out the next due date from the last service.

## Maintenance due
- The **Maintenance due** tab lists customers on a plan who are overdue or due in the next 45 days, most urgent first. **Book visit** creates a job. **Nearby** opens the map trip planner centred on that customer to find others close by.

## Map and trip planning
- The **Map** tab shows customers as pins coloured by maintenance status (overdue, due soon, booked, on plan, no plan).
- **Plan a trip:** choose where the trip starts (home base, a booked job or a customer), a distance, and how soon visits are due. **Find customers** lists nearby customers due for service; Fielora puts the stops in a sensible driving order. Tick the ones you want and book them all at once; times are spaced out automatically.
- **Day route:** pick a day to see that day's stops numbered in order, with a button to open turn-by-turn directions in Google Maps (up to 9 stops).
- The home base is set by an Owner in **Account → Business settings**.

## Service forms and reports
- Open a job and tap **Service form**. Fill in readings and the checklist (each item: OK, Done, Needs attention, or N/A, with an optional note). **Mark rest OK** fills the remaining checklist items. Required fields must be filled before finishing.
- **Save draft** keeps your progress. Once a form is finished, only a manager or owner can change it, and they can also **Delete form** (the job goes back to Booked). **Finish** marks the job complete, updates the customer's last service date and rolls the next due date forward.
- After finishing you can **Open PDF**, **Download PDF**, or on a phone **Share PDF…** to send it from Outlook or Mail yourself. If the business has connected Outlook, the report can also be emailed to the customer from the business mailbox.
- Reports include the business logo and details, the customer and equipment, readings, checklist results, recommendations and a sign-off area.
- **Customize forms (Managers and Owners):** **Account → Service forms and logo → Customize service forms**. Add, rename or reorder sections and questions (checklist items, numbers with units, text, drop-downs, yes/no, dates), mark questions required, choose which job types use each form, and preview the PDF. **Reset to default** restores the trade's standard forms.
- **Logo (Managers and Owners):** **Account → Service forms and logo → Upload logo** (PNG or JPG).

## Trade and job types (Owners)
- **Account → Trade and job types.** Choose a trade (generator service, HVAC, plumbing, electrical, general), rename job types, turn them on or off, and set what equipment is called, the size unit, equipment types, fuel choices and brand suggestions. There's an option to also replace the service forms with the trade's defaults.

## Importing and exporting
- **Import (Customers → Import, Managers and Owners):** bring customers in from a CSV or Excel file, or from SharePoint if the business has connected it. Fielora guesses which column is which (you can change it), previews the result, flags duplicates (by serial number or name and address), and lets you update existing customers, skip them, or add everything as new. Imported addresses are placed on the map afterwards.
- **Export (Account → Export data, Managers and Owners):** **Everything in Excel** (customers, jobs, and every form's answers), **All service reports (PDF)** in a zip with a folder per customer, or **Full backup** (one file with everything).

## Two-step login
- **Account → Two-step login:** scan the QR code with an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, etc.), enter the code, and save the 8 recovery codes.
- An Owner can require two-step login for everyone under **Account → Business settings** (they must turn it on for themselves first).

## Installing the app
- **Android / Chrome / Edge:** tap **Install app** in the header (or the browser's install option).
- **iPhone / iPad (Safari):** Share button → **Add to Home Screen**.
- **Mac (Safari):** File → **Add to Dock**.
- The installed app opens full screen and shows "Offline" if there's no connection; changes need a connection to save.

## Notices and support
- Your provider may post a notice banner at the top of the app (for example, planned maintenance). Tap × to hide it once you've read it.
- Owners can see **Account → Support access**: whether the support team can help from their dashboard, and everything they've done.
- **Help chat:** the **Help** button opens this chat. The assistant answers how-to questions; **Talk to a person** passes the chat to the support team.

## Things only the support team or an Owner can do (the assistant can't)
- Reset passwords or two-step login for someone, change access, add or remove people (owners, and managers for Staff, do these in Account → Team).
- Look at or change the business's data, recover deleted information, or restore a backup.
- Connect Outlook email or SharePoint, change the web address, billing or account questions, and fixing errors or bugs.
