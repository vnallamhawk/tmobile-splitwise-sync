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
 *
 * The attachment is named e.g. "August 11, 2026BillSummary.pdf" -- the year and "BillSummary"
 * are glued together with no space, so Gmail's tokenizer treats "2026BillSummary" as a single
 * word and a search for "BillSummary" alone won't match it (confirmed empirically). The date
 * portion also changes every month, so we can't match on the literal filename anyway. Instead
 * this matches on what's stable every month: shared from the T-Mobile app to yourself (`from:me`),
 * with a PDF attachment, mentioning "t-mobile" somewhere in the message.
 */
export async function findLatestBill(
  query = "from:me has:attachment filename:pdf t-mobile newer_than:10d"
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
