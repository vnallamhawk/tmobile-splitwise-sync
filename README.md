# tmobile-splitwise-sync

Automates a recurring monthly chore: T-Mobile emails a family-plan bill, and someone has to
manually split it across everyone on the plan and post it to Splitwise. This reads the bill
PDF straight from Gmail, works out who owes what, shows a dry-run preview, and (only after
you confirm) posts the expenses to Splitwise.

## How the split works

T-Mobile's bill PDF includes a "THIS BILL SUMMARY" table that already breaks Plans, Equipment,
Services, and One-time charges out per phone line — that table is parsed directly rather than
the prose bullet points, since it's far more reliable.

For each of those four categories:

1. Any phone line with its own itemized (non-"Included") charge is billed 100% to that line's
   owner.
2. The shared account-level base charge (e.g. the base Plan cost) is split evenly across every
   line marked "Included" for that category.
3. Certain lines can be configured to always fold into another person's share instead of being
   billed separately (e.g. a spouse's line that one person always covers).
4. A wearable line (e.g. a paired smartwatch) always folds into the bill-payer's own share.
5. If a category ends up 100% owned by the bill-payer, it's shown in the dry run but not posted
   to Splitwise — no point in it being both "paid by" and "owed by" the same person.

See `src/splitCalculator.ts` for the implementation and `test/splitCalculator.test.ts` /
`test/fixtures/sample-bill.ts` for a fully worked (fake-data) example of every rule.

## Setup

```
npm install
cp config/people.example.json config/people.json   # then fill in your real phone/name/email mapping
cp .env.example .env                                 # then fill in your Splitwise API key
```

`config/people.json` and `.env` are gitignored — they hold real names, emails, and API keys and
are never committed. `config/people.example.json` documents the shape with fake data.

### Splitwise

1. Register a personal app at https://secure.splitwise.com/apps to get an API key.
2. Put it in `.env` as `SPLITWISE_API_KEY`.
3. The script resolves your group by name (`"T-Mobile"` by default, see `GROUP_NAME` in
   `src/cli.ts`) and matches its members by email against `config/people.json`.

### Gmail

1. In Google Cloud Console, create a project, enable the Gmail API, and create an OAuth
   **Desktop app** client. Download its JSON and save it as `client_secret.json` in the project
   root (gitignored).
2. Run `npm run gmail:auth` once — it opens a browser for you to sign in and saves a refresh
   token to `token.json` (gitignored).
3. `src/gmail.ts` searches for `filename:BillSummary.pdf newer_than:45d` by default — adjust the
   query there if your bill emails don't match.

## Usage

```
npm run sync -- --file test/fixtures/2026-07-BillSummary.pdf --dry-run   # preview only, no APIs needed except parsing
npm run sync -- --dry-run                                                # fetch from Gmail, preview only
npm run sync                                                             # fetch, preview, confirm, then post to Splitwise
```

Every run prints exactly what would be posted (title, total, and each person's share) before
anything touches Splitwise, and asks for a y/n confirmation before posting for real.

## Tests

```
npm test
```

Runs entirely against the synthetic fixture in `test/fixtures/sample-bill.ts` (safe, fake data).
If you've placed a real bill PDF at `test/fixtures/2026-07-BillSummary.pdf` for local testing
(gitignored — never commit a real bill, it contains your account number and address), an
additional PDF-parsing test runs against it too.
