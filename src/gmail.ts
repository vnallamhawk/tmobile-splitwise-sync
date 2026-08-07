import { google, gmail_v1 } from "googleapis";
import fs from "node:fs";
import path from "node:path";

const CREDENTIALS_PATH = path.resolve("client_secret.json");
const TOKEN_PATH = path.resolve("token.json");

function getClient() {
  if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKEN_PATH)) {
    throw new Error("Gmail not authorized yet -- run `npm run gmail:auth` first.");
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const { client_id, client_secret } = creds.installed ?? creds.web;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(tokens);
  return google.gmail({ version: "v1", auth: oAuth2Client });
}

export interface BillEmail {
  messageId: string;
  pdfBuffer: Buffer;
  filename: string;
}

function findPdfAttachmentPart(
  payload: gmail_v1.Schema$MessagePart | undefined
): gmail_v1.Schema$MessagePart | undefined {
  if (!payload) return undefined;
  if (payload.filename?.toLowerCase().endsWith(".pdf") && payload.body?.attachmentId) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPdfAttachmentPart(part);
    if (found) return found;
  }
  return undefined;
}

/**
 * Finds the newest Gmail message matching `query` with a PDF attachment and downloads it.
 * Default query targets T-Mobile's monthly "BillSummary.pdf" attachment -- verify this matches
 * your inbox on the first real run (`gmail.users.messages.list` in the Gmail UI search bar uses
 * the same query syntax) and adjust here if T-Mobile's naming differs.
 */
export async function findLatestBill(
  query = "filename:BillSummary.pdf newer_than:45d"
): Promise<BillEmail | null> {
  const gmail = getClient();
  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 5 });
  const messages = list.data.messages ?? [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({ userId: "me", id: msg.id! });
    const attachmentPart = findPdfAttachmentPart(full.data.payload);
    if (!attachmentPart) continue;

    const attachmentData = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: msg.id!,
      id: attachmentPart.body!.attachmentId!,
    });
    const pdfBuffer = Buffer.from(attachmentData.data.data!, "base64url");
    return { messageId: msg.id!, pdfBuffer, filename: attachmentPart.filename ?? "bill.pdf" };
  }
  return null;
}
