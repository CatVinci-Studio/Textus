# textus-feedback

The Worker behind **Help › Report a Problem**: the app posts a report to
`https://textus.catvinci.com/api/feedback`, and the Worker files it as an
issue on CatVinci-Studio/Textus, as the Textus Feedback GitHub App, with
labels for what it is (`bug`, `enhancement`, `question`), the part of the
app (`area: …`) and, for a bug, how bad it is (`severity: …`).

- No GitHub account is needed to send one.
- A contact the sender leaves is mailed to the team and never goes in the
  public issue.
- Five reports a day from one address, 300 a day in all (KV `LIMITS`).

`issue.ts` checks a report and builds the issue; `worker.ts` does the rest.
The tests run with the app's unit tests (`npx vitest run services`).

## Setting up

1. Create a GitHub App in the CatVinci-Studio organisation with **Issues:
   read and write** on repositories, no webhook, and install it on
   `CatVinci-Studio/Textus` only.
2. `wrangler secret put APP_ID` with its App ID, and `APP_KEY` with its
   private key converted to PKCS#8:
   `openssl pkcs8 -topk8 -nocrypt -in key.pem | npx wrangler@4 secret put APP_KEY`.
3. `npx wrangler@4 deploy` from this folder.

To check it without filing a public issue, set a `TEST_KEY` secret and send
it in an `x-textus-test` header: the report is checked and a contact
mailed, and nothing goes to GitHub.
