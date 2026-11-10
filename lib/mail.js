"use strict";
// Sends email from the business's own Microsoft 365 / Outlook mailbox through Microsoft Graph.
// Needs the Mail.Send application permission on the app registration.
const graph = require("./graph");
const { MAIL_FROM } = process.env;
const configured = () => graph.configured() && !!MAIL_FROM && MAIL_FROM !== "none";

async function sendMail({ to, subject, html, attachments = [], bccSelf = true, saveCopy = true }) {
  if (!configured()) throw Object.assign(new Error("Outlook email isn’t set up yet."), { code: "not_configured" });
  const message = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients: to.map(address => ({ emailAddress: { address } })),
    attachments: attachments.map(a => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.contentType, contentBytes: a.content.toString("base64") })),
  };
  if (bccSelf) message.bccRecipients = [{ emailAddress: { address: MAIL_FROM } }];
  try { await graph.post(`/users/${encodeURIComponent(MAIL_FROM)}/sendMail`, { message, saveToSentItems: !!saveCopy }); }
  catch (e) { throw new Error(e.status ? `Outlook couldn’t send the email: ${e.message}` : e.message); }
}
module.exports = { configured, sendMail, mailFrom: () => MAIL_FROM || "" };
