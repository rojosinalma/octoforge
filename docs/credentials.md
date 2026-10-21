# Credentials

Octoforge creates a GitHub credential for a tool and hands it to every running instance of that
tool. It never stores the credential: the private key, webhook secret or token lives in Octoforge's
memory for at most `secretTtlMin` minutes (15 by default) and is dropped as soon as every instance
you picked took it.

Before you start:

1. Set `OCTOFORGE_TOKEN` in Octoforge and the same value in each tool's `.env`, and restart them.
2. Add the tools' instances on the Settings page. If GitHub cannot reach an instance at its base
   URL, give it a public URL ([configuration](configuration.md#instances)).
3. To create a GitHub App, set `PUBLIC_URL` to the address your browser uses for Octoforge.

Every tool that can use a GitHub App uses **one shared App**: one key, one set of installations,
one place to change permissions. A token is for the tools that act as a person; an App for one tool
only is the alternative when the shared App does not fit.

## The shared GitHub App

Open **GitHub App** in the top bar.

### Use an existing App

1. Enter the App id, paste the private key (the `.pem` file; a one-line value with `\n` works too)
   and, if the App sends webhooks, its webhook secret.
2. Press **Check with GitHub**. Octoforge signs a JWT with the key and reads `GET /app` (name, owner,
   permissions, events) and `GET /app/installations` (each account and the permissions it accepted).
3. The key stays in memory only, for `secretTtlMin` minutes or until it is delivered. Octoforge
   keeps the App's id, slug, owner, permissions and installations in its settings, so the page still
   shows the App after the key is gone. It never stores the key or the webhook secret.

### Create the shared App

When there is no App yet, **Create the shared App** builds a manifest from every tool's needs:

- the permissions are the union of what the tools ask for; when two ask for different levels, the
  higher one wins (`write` over `read`);
- the events are the union of their events;
- the webhook goes to the one tool that names a `webhook_path`. One App has one webhook URL: when
  several tools name one, the page lists them and does not create the App.

Pick the name (`Octoforge` by default, unique across GitHub), the owner and the instance that
receives the webhooks, then press **Create on GitHub** and confirm there. GitHub sends you back to
the GitHub App page with the App in memory. Install it with **Install on another account**.

### Permissions

The table has one row per permission and one column for the App (what it grants), one per
installation (what that account accepted) and one per tool (what it needs). A red cell is a gap.
Under **Credentials** each tool shows `missing: …` when it needs a permission the App lacks, next
to the gaps the tool reports itself.

GitHub has no API to change an App's permissions, so a gap is closed on GitHub, without a new App:

1. **Edit permissions on GitHub** opens the App's permission page
   (`https://github.com/settings/apps/<slug>/permissions`, or
   `https://github.com/organizations/<org>/settings/apps/<slug>/permissions` for an organisation's
   App). Add the permissions the page lists and save.
2. Each installation must accept the new permissions. The page links each one
   (`https://github.com/settings/installations/<id>` for a personal account,
   `https://github.com/organizations/<org>/settings/installations/<id>` for an organisation).
3. Press **Re-check**: Octoforge reads `GET /app` again. Re-check needs the key in memory.

### Deliver

Under **Deliver to members**, every instance of every tool that can use an App is listed with the
credential it uses now; the instances that answer are ticked. Pick an installation, or let each tool
find its own, and press **Deliver**. Each instance checks the App against GitHub and stores it. When
every instance took it, Octoforge forgets the key; when one fails, the key stays for a retry until
it expires. Every delivery appears on the **Log** page. A tool without the member API reads the
App from its own `.env` (id, key, webhook secret); the GitHub App page has no `.env` block.

## An App for one tool only


On the tool's Credentials page:

1. Under **Create an App for this member only**, check the name (it must be unique across GitHub),
   pick the owner (your account or the organisation from Settings) and the instance that receives
   the webhooks.
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
