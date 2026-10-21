# Credentials

Octoforge creates a GitHub credential for a tool and hands it to every running instance of that
tool. It never stores the credential: the private key, webhook secret or token lives in Octoforge's
memory for at most `secretTtlMin` minutes (15 by default) and is dropped as soon as every instance
you picked took it.

Before you start:

1. Set `OCTOFORGE_TOKEN` in Octoforge and the same value in each tool's `.env`, and restart them.
2. Add the tool's instances on the Settings page. If GitHub cannot reach an instance at its base
   URL, give it a public URL ([configuration](configuration.md#instances)).
3. For a GitHub App, set `PUBLIC_URL` to the address your browser uses for Octoforge.

Open **Members → Credentials** on the tool's card. The page lists every instance with the
credential it uses now (`from .env`, `from Octoforge` or none). It never shows a secret.

## GitHub App

1. Under **Create a GitHub App**, check the name (it must be unique across GitHub), pick the owner
   (your account or the organisation from Settings) and the instance that receives the webhooks.
   Under **Webhooks go to**, the page shows the webhook URL and where its address comes from: the
   instance setting, the member's own report, or the base URL.
2. Press **Create on GitHub**. Your browser posts the App manifest to GitHub: the permissions and
   events the tool asks for, the webhook URL on that instance, and Octoforge's callback.
3. Confirm on GitHub. GitHub sends you back to Octoforge with a one-time code; Octoforge exchanges it
   at once for the App id, private key and webhook secret, and keeps them in memory.
4. Press **Install the App** and choose the repositories. Back in Octoforge, **Find installations**
   lists where it is installed; pick one, or let the tool find it.
5. Tick the instances and press **Deliver**. Each instance checks the App against GitHub and stores
   it. When every instance took it, Octoforge forgets the key. When one fails, the key stays for a
   retry until it expires.

The callback only works for a manifest flow you started in the same Octoforge in the last
`secretTtlMin` minutes, and each one only once.

## Personal access token

1. Under **Use a personal access token**, pick the owner and press **Fine-grained token** or
   **Classic token**. GitHub opens its token form with the name, description, expiry and the
   permissions or scopes the tool needs already filled in.
2. Generate the token on GitHub, copy it and paste it into **Paste the token**, then press Enter.
3. Octoforge checks it with GitHub (`GET /user`). For a classic token it compares the granted scopes
   with the required ones and names what is missing. GitHub does not list a fine-grained token's
   permissions; the tool checks them when it receives the token.
4. Tick the instances and press **Deliver**.

Some tools act as the person (an App cannot replace the token); the page says so.

## Without the member API

**Show as .env block** builds the lines for the tool's `.env` with the variable names the tool
publishes in its manifest. The block is shown once; Octoforge forgets the credential at the same
moment, so copy it before you close the dialog. Paste it into the tool's `.env` and restart it.

## Taking a credential back

**Drop** on an instance that runs on a delivered credential tells it to go back to the value in its
own `.env`. To revoke the credential on GitHub, delete the App or the token there.

## The log

Every delivery, every `.env` block and every database adoption appears on the **Log** page: when,
which tool, where, and the answer. The log never holds a secret.
