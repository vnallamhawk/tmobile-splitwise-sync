import { google } from "googleapis";
import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CREDENTIALS_PATH = path.resolve("client_secret.json");
const TOKEN_PATH = path.resolve("token.json");
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(
      `Missing ${CREDENTIALS_PATH}.\n` +
        "Download your OAuth 'Desktop app' client's JSON from Google Cloud Console " +
        "(APIs & Services > Credentials) and save it as client_secret.json in the project root."
    );
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const { client_id, client_secret } = creds.installed ?? creds.web;

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("Opening your browser to sign in to Google. If it doesn't open, visit this URL:\n");
  console.log(authUrl, "\n");
  exec(`open "${authUrl}"`);

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "", redirectUri);
      const code = url.searchParams.get("code");
      res.end(code ? "Authorized -- you can close this tab and return to the terminal." : "Missing authorization code.");
      if (code) resolve(code);
      else reject(new Error("No authorization code in OAuth callback"));
    });
  });
  server.close();

  const { tokens } = await oAuth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nSaved refresh token to ${TOKEN_PATH}. You're ready to run \`npm run sync\`.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
