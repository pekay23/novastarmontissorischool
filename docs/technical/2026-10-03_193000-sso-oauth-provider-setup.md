# Setting up Google and Microsoft single sign-on for the school portal

**Who this is for:** whoever is asked to make the "Continue with Google" or
"Continue with Microsoft" button appear on the Novastar portal. You do not need
to write code. You will create one thing in each provider's own website, copy
two values out of it, and paste them into the portal's configuration.

**Time:** about 20 minutes for both providers, or about 10 minutes for one.

**What you need:** a Google account for the Google steps, and a Microsoft
account with administrator rights on your school's Microsoft 365 tenant for the
Microsoft steps. If you are not that administrator, you will need to ask for it —
this cannot be done by a normal member of staff.

---

## Before you start: how the portal decides whether to show a button

Read this section once. It explains why a button sometimes will not appear, and
it saves you pasting the same values in twice.

Two separate things must both be true for someone to sign in with Google or
Microsoft.

| | Who sets it | Where |
| --- | --- | --- |
| **1. The credentials** (a client id and a secret) | Somebody running the portal deployment | The portal's environment settings — the four variables named in `apps/portal/.env.example` |
| **2. The school switch** (`sso_google` or `sso_microsoft`) | The Head of School | Portal → System Config → Auth |

The rules are:

* **Credentials are the hard prerequisite.** If they are missing, the portal
  does not load that provider *at all*. No button appears for it, anywhere, for
  anybody. This is deliberate: a half-configured provider that appears and then
  fails would cost a member of staff a trip to Google's website before telling
  them anything.
* **The school switch is what you control.** With the credentials in place but
  the switch off, the button appears on the sign-in page, and choosing it returns
  the message *"Sign in with Google is not switched on for your school. Ask your
  Head of School to turn it on."*
* **Both of these must also be true:** the member of staff must already have a
  portal account, created by the Head of School or a platform operator, using
  the **same email address** they will sign in with. Nothing is created
  automatically. If nobody has made them an account, the portal says so and
  stops.

So, if a button is missing, it is always the credentials that are missing, and
only the person who runs the deployment can supply them. If a button is present
but refuses, it is the school switch or a missing account, and both of those are
yours.

> A note on personal addresses: a member of staff can sign in with any address
> their account was created with, including a personal Gmail or Outlook address,
> as long as the Head of School used that same address when creating the account.
> A personal Outlook address will only work through Microsoft, though, if you
> chose multi-tenant in [Step 2.3](#step-23-choose-the-supported-account-types) —
> and that is not the recommended default.

---

## Part 1 — Google

### Step 1.1: create a cloud project

1. Go to <https://console.cloud.google.com/>.
2. Sign in with the Google account that will **own** this application. Use a
   school-controlled account, not somebody's personal one — if that person
   leaves, the project goes with them.
3. At the top of the page, next to the Google Cloud project picker, click
   **Select a project**.
4. Click **New project**.
5. Fill in:
   * **Project name** — something the next administrator will recognise, e.g.
     `Novastar School Portal`.
   * **Organisation** — leave as *No organisation* unless your school already has
     a Google Cloud organisation set up.
   * **Location** — leave at *No organisation*.
6. Click **Create**.
7. Wait for the notification, then click **Go to project**. Make sure the
   project picker at the top now shows your new project. Everything below only
   works while it does.

### Step 1.2: no API needs enabling (read this so you do not go hunting)

For the three basic identity scopes in Step 1.3, **there is no API you have to
turn on.** The sign-in works once the OAuth consent screen and the client ID
exist. Skipping to Step 1.3 is correct.

Google's own setup guides tell you to enable an API — most often **Google
Identity Platform**, formerly **Google+ API** — and if your console shows that
screen, enabling it is harmless. But a service called "Google+ API" may no
longer appear at all, and that is not a problem: do not spend time looking for
it, and do not enable something you do not recognise.

### Step 1.3: configure the consent screen

1. Open the navigation menu (the ☰ at the top left) → **APIs & Services** →
   **OAuth consent screen**.

   Google has been moving this screen around. If you cannot see **OAuth consent
   screen**, look for **Google Auth Platform**, and then **Branding** inside it —
   that is the same screen under its newer name. Either route works; the
   questions asked are identical.
2. Choose **External**. (Use **Internal** instead if your school uses Google
   Workspace and every user is on your own domain — Internal skips the
   unverified-app warning described below, and needs no publishing at all.)
3. Fill in the fields Google asks for:
   * **App name** — `Novastar School Portal`
   * **User support email** — the Head of School's or an administrator's address
   * **Application logo** — optional
   * **Application contact email** — an address that will receive Google's
     warnings
   * **Developer contact information** — an address that will receive Google's
     warnings
4. Click **Save and Continue**.
5. On the **Scopes** step, click **Add or remove scopes**. Add only:
   * `.../auth/userinfo.email`
   * `.../auth/userinfo.profile`
   * `.../auth/openid`

   These three are what "basic identity scopes" means. Do not add Drive, Gmail,
   Calendar or anything else. See
   [Why only three scopes](#why-only-three-scopes) below — adding one
   changes the whole process.
6. Click **Update** → **Save and Continue**.
7. On the **Test users** step, add the Google addresses of one or two staff
   members who will try it first. You can skip this on External: they will be
   able to sign in as testers while the app is in testing anyway. Click
   **Save and Continue**.
8. On the **Summary** page, click **Back to Dashboard**.

### Step 1.4: create the client id and secret

1. Still under **APIs & Services**, click **Credentials** in the left-hand menu.
2. Click **Create credentials** → **OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Fill in:
   * **Name** — `Novastar School Portal`
   * **Authorised redirect URIs** — add the ones below, exactly as written.

   | Where the portal runs | Redirect URI to add |
   | --- | --- |
   | Local development on your own machine | `http://localhost:3000/api/auth/callback/google` |
   | A test/staging portal | `https://<your-test-domain>/api/auth/callback/google` |
   | Production portal | `https://<your-live-domain>/api/auth/callback/google` |

   Three things that catch people out here:
   * The path is `/api/auth/callback/google`, **not** `/api/auth/callback` and
     not `/login/callback`. Copy it from this page; do not retype it from memory.
   * `https` is required everywhere except `localhost`. Use `http` for localhost
     and nothing else.
   * No trailing slash after `google`.

   Click **Create**.

5. A **Client ID** dialog appears. Click **Download JSON** and keep the file —
   this is the only moment the secret is shown.

   **What Google displays only once, and what to do about it:** the client
   **secret** appears exactly once, in that dialog. For a *Web application*
   credential this is the only time it is shown — there is no "Show secret" link
   on the credential afterwards. If you close the dialog without copying it, it
   is gone, and the only recovery is to delete that credential and create another
   one, which means re-entering the redirect URI list. So: copy it somewhere safe
   before you close anything.

   (Some Google console versions have since added a **Download JSON** link on the
   credential's own detail page. If you see that link when you come back for the
   secret, use it — it is the same credential, and it saves you re-entering the
   redirect URIs. Do not delete and recreate the credential just because the
   original dialog is gone.)

6. Click **OK**.

### Step 1.5: copy the two values

Open the downloaded JSON file in a text editor. It looks like:

```json
{
  "web": {
    "client_id": "1234567890-abcdefghijklmnop.apps.googleusercontent.com",
    "project_id": "novastar-school-portal",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "client_secret": "GOCSPX-xxxxxxxxxxxxxxxxxxxx",
    ...
  }
}
```

* `client_id` → `GOOGLE_CLIENT_ID`
* `client_secret` → `GOOGLE_CLIENT_SECRET`

### Step 1.6: about the unverified-app warning — read this before you worry about it

**Google does not need this application verified, and it does not need to be
published, for it to work.**

Google asks you to publish or verify an app when it requests *sensitive* or
*restricted* scopes. The three scopes in Step 1.3 are **basic identity scopes**,
which Google classifies as neither. An app requesting only basic scopes runs in
Google's "Testing" status indefinitely and works for as many users as you like.

**What your staff will see.** The first time each person signs in, Google shows
a warning screen that says *"Google hasn't verified this app"* and asks them to
click **Advanced** → **Go to Novastar School Portal (unsafe)**. This is expected,
it is not a sign of a problem, and the portal cannot suppress it.

**What changes if you publish the app later.** Once published (production
status), the warning disappears — but only if you also complete Google's
verification process, which is a much larger piece of work than this document
describes. And note the catch: publishing an app still in "Testing" status
restricts it to the test users you listed in Step 1.3, so publishing *reduces*
who can sign in unless you add people to the test-user list as well. For a single
school's staff portal, leaving it in Testing with the warning screen is the
lower-maintenance choice.

### Step 1.7: what Google is asking you for, and what you agreed to

Google is being asked for one thing only: *confirm that this person controls this
email address*. The portal uses that answer for exactly one purpose — to check
which portal account is signing in. It does not read mail, files, calendar or
contacts, and it cannot.

The secret from Step 1.5 belongs to the portal and to nobody else. Do not put it
in a document, a chat message, a screenshot, or a shared drive. If it leaks,
delete the credential in Google Cloud Console, create a new one, and update the
portal — do not simply change the value.

---

## Part 2 — Microsoft (Entra ID)

Microsoft calls this Microsoft Entra ID. It is the same "Sign in with Microsoft"
button that appears when you use a work or school Microsoft 365 account or a
personal Outlook / Hotmail account. Both work.

### Step 2.1: confirm you can create an app registration

Sign in to the Microsoft Entra admin centre at <https://entra.microsoft.com/>.

* If you see a tenant that belongs to your school, carry on. The app
  registration is created inside that tenant, and the account-type setting in
  Step 2.3 decides who inside it is allowed to sign in.
* If you are asked to create a new tenant, or you cannot reach the admin centre
  at all, you need an administrator to do Steps 2.2 to 2.4, or to grant you the
  **Application developer** role.

### Step 2.2: register the application

1. In the left-hand menu, expand **Identity**, then click **Applications**, then
   **App registrations**.
2. Click **New registration** at the top.
3. Fill in:
   * **Name** — `Novastar School Portal`
   * **Supported account types** — see Step 2.3; the default is usually right
   * **Redirect URI** — choose **Web**, then enter
     `https://<your-live-domain>/api/auth/callback/microsoft-entra-id`

     For local development, also add a second **Web** entry:
     `http://localhost:3000/api/auth/callback/microsoft-entra-id`
4. Click **Register**.

**The path is `/api/auth/callback/microsoft-entra-id`.** It is not
`/api/auth/callback/azure-ad` and not `/login/callback`. Copy it from here.

### Before Step 2.3: what Microsoft does not tell the portal

Sign in with **Google**, and you get two answers back: the person's email
address, and Google's confirmation that the person controls that address. The
portal refuses any Google sign-in where that confirmation is missing or says no.

**Microsoft** gives you the first answer and no second answer at all. Entra ID
does not send a "verified" or "not verified" result — not when it signs the
person in, and not in the profile it returns afterwards. There is nothing to
check, so the portal accepts the address it is handed. That is not the same
thing as Microsoft having checked it.

Two things follow, and both of them bear on the next step.

**The portal never creates an account from a sign-in.** It signs in only somebody
whose account the Head of School has already created, at your school, with that
exact address. A Microsoft sign-in cannot add a new person to your portal, so the
address Microsoft supplies is never enough on its own — it has to already be on
your roll. If nobody has created the account, the sign-in stops there with *"No
portal account exists at your school for this email address."* That is true of
Google as well, and it is the same rule for both providers.

**Which Microsoft accounts are allowed to try is therefore your decision.** If
Microsoft is not going to vouch for the address, then the question the portal
cannot answer for you is *"who is allowed to reach this sign-in at all?"* Step
2.3 sets exactly that. It is the one place in this document where the
account-type choice is a security decision rather than a convenience one.

**You can always tell afterwards which provider signed somebody in.** Every
successful single sign-on writes an entry to the portal's audit log naming the
provider — *"Signed in with microsoft-entra-id single sign-on"* — so an
administrator (Head of School, Assistant Head or Admin Staff) can separate a
Google sign-in, which arrived with a verified address, from a Microsoft one,
which did not. Look under **Settings** → **Audit Logs**, filter by the `LOGIN`
action.

### Step 2.3: choose the supported account types

This setting decides *who is allowed to try to sign in*, and with Microsoft it is
a security decision rather than a convenience one. Read
[the section above](#before-step-23-what-microsoft-does-not-tell-the-portal)
before you answer it.

| Choice | Who Microsoft will let start a sign-in to this application |
| --- | --- |
| **Accounts in this organizational directory only** (single tenant) | Only staff with an account in your school's own Microsoft 365 directory. Personal addresses cannot work. |
| **Accounts in any organizational directory and personal Microsoft accounts** (multi-tenant) | Staff at any organisation with a work or school Microsoft account, **and** staff with a personal Outlook.com or Hotmail account. |

**Choose "Accounts in this organizational directory only"** unless your school has
a specific reason it cannot. With that setting, Microsoft itself turns away anyone
outside your school's directory before this application is involved at all, and
every Microsoft identity that can reach your portal is one your school created
and your school can remove.

Multi-tenant is a legitimate choice, and it is the right one when some of your
staff genuinely sign in with a personal Outlook or Hotmail address that will
never appear in your school's directory. Choose it knowing what it costs:

> **What multi-tenant means for this portal.** Any Microsoft identity anywhere —
> any company, any school, any personal account — becomes a candidate to sign in
> to your portal. A candidate still has to present an email address that has
> already been created as a staff account, or the sign-in stops. But Microsoft
> does not confirm that the address is verified, so on a Microsoft sign-in that
> address match is the only check the portal can make. And staff email addresses
> are not a secret: they are on your school website.

Put plainly. With single tenant, an outsider needs an account inside your
school's Microsoft directory before they can try anything. With multi-tenant,
matching an existing staff email address is the only thing standing between an
outsider and a portal session.

**The technical consequences of enabling personal accounts.** As soon as personal
accounts are enabled:

* **Wildcard redirect URIs are rejected.** You cannot use
  `https://portal.example.com/*` or anything containing a `*`. Every redirect URI
  must be spelled out in full. There is no single wildcard entry that covers both
  your live domain and your localhost development entry — enter each one on its
  own line.
* **Query strings are rejected.** A redirect URI of the form
  `https://portal.example.com/auth?tenant=abc` is refused. The portal's callback
  path takes no parameters, so this costs you nothing here, but it will stop you
  if you are ever tempted to add one.
* **Fragments (`#`) are rejected** for the same reason.
* **App permissions require administrator consent.** The portal asks only for
  the three basic identity permissions, which do not need a consent grant from
  anybody. As soon as you add anything — reading files, reading mail, reading the
  directory — an administrator must grant consent first, and staff will see a
  consent screen naming your organisation.

The last point is the same trade-off as Step 1.6: the portal asks for identity
only, deliberately, so that it does not need consent and does not hold access to
anything of yours.

### Step 2.4: create the secret

1. On the app's overview page, expand the **Certificates & credentials** section
   on the left (or find **Certificates & secrets**).
2. Click **New client secret**.
3. **Expires:** choose the longest option your school's policy allows.
4. Click **Add**.

**What Microsoft displays only once:** the secret **value** — a long random
string beginning with `~` — is shown exactly once, in the dialog that appears. You
cannot view it again in the portal. If you lose it, delete the secret on this page
and create a new one. Delete it yourself when it expires, and create a
replacement before it lapses, or sign-in stops working on the day it expires.

### Step 2.5: copy the two values

Back on the app's **Overview** page:

* **Application (client) ID** → `MICROSOFT_ENTRA_ID_CLIENT_ID`
* **Client secret value** from Step 2.4 →
  `MICROSOFT_ENTRA_ID_CLIENT_SECRET`

Note carefully which secret you copy. There are two things called "secret" on
that screen. The **Client secret value** is the one you want — the long random
string from the dialog in Step 2.4. It is not the **Fingerprint**, **Thumbprint**
or **Display name**, and Microsoft also offers a *certificate* credential
instead of a secret, which this portal does not use.

---

## Part 3 — giving the portal the four values

The four variables go into the portal's deployment configuration — whatever
holds its environment variables, which is `.env` locally and your host's
settings in production. They belong in `apps/portal/.env.example` only as *empty
names*, which is how they are already committed.

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_ENTRA_ID_CLIENT_ID=
MICROSOFT_ENTRA_ID_CLIENT_SECRET=
```

Fill in whichever pairs you have created. Leaving a pair blank is fine and means
that provider is simply not offered.

Rules for handling these four values:

* **Never write a real value into `.env.example`,** into a document, a chat
  message, a ticket, or a screenshot. The example file exists to name the
  variables, not to hold them.
* **Never commit them to git.** They are secrets.
* After changing them, the portal must be restarted or redeployed for the change
  to take effect.

### Where the redirect URI comes from

The redirect URI is the portal's own address plus the fixed callback path. To
work out the first part, look at the origin the portal is served from — it is
`NEXTAUTH_URL` in the same configuration, or failing that
`NEXT_PUBLIC_ORIGIN`. For a portal at `https://portal.novastarmontessori.com`,
the redirect URI is:

```text
https://portal.novastarmontessori.com/api/auth/callback/google
```

The provider and the portal must agree exactly. A mismatch is the single most
common reason for a sign-in that bounces back to an error page, and Google and
Microsoft both say so explicitly on the page.

---

## Part 4 — turning the switch on for your school

This part is for the Head of School, and it is deliberately not an environment
variable: it is per school, so one school's decision cannot affect another.

1. Sign in to the portal.
2. Go to **System Config** → the **Auth** category.
3. Find **Enable Google SSO login** (or **Enable Microsoft Entra ID SSO login**)
   and turn it on.
4. Save.

The switch is off by default for every school, and turning it on writes an audit
entry recording who changed it and when.

If turning the switch on does not change anything, the credentials from Part 3
are the missing piece — see the table at the top of this document.

---

## Part 5: trying it, and what each failure looks like

Test with one real staff account, not your own.

1. Create a portal account for that person through the normal route (Head of
   School, or the staff invitation). Use the **exact email address** they will
   sign in with.
2. Sign out. Open the portal sign-in page. Type the school code.
3. The "Continue with Google" button should be there.
4. Click it, sign in with that Google account, and approve the consent screen.

### If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| No Google button at all | The credentials are not in the portal's configuration, or only one of the pair | Check Part 3. Restart the portal after changing them. |
| `Error 400: redirect_uri_mismatch` | The URI in Google does not match the portal's | Compare character by character. Scheme (`http`/`https`), host, path and the absence of a trailing slash all count. |
| `Error 401: invalid_client` | The client secret is wrong, truncated, or belongs to a different project | Re-copy it from the JSON file. If it has been exposed anywhere, delete the credential in Google and create a new one. |
| Google's "app is not verified" screen | Expected. See Step 1.6 | Click **Advanced**, then **Go to … (unsafe)**. |
| *"No portal account exists at your school for this email address."* | Nobody has created an account with that address | The Head of School creates it. Nothing is created automatically, ever. |
| *"That account has been suspended."* | The account exists but is suspended | Head of School reactivates it in the portal. |
| *"Sign in with Google is not switched on for your school."* | The school switch is off | Part 4. |
| *"Enter your school code before choosing a sign-in method."* | The school code was empty, or typed after the button was pressed | Type it above the button, then press the button. |
| Microsoft says the app is not authorised, or asks for admin consent | A permission beyond the three basic ones has been added | Remove it. The portal needs only `openid`, `email` and `profile`. |
| A user signs in with the wrong Google account | Google picked a different account for them | They will see Google's account chooser. If they are not, sign out of Google completely and try again. |

---

## Why only three scopes

The portal requests `openid email profile` from both providers. That is the
complete list of what it needs: who you are, what your email address is, and
what to call you.

This is not minimalism for its own sake — it changes what you, the operator, have
to do:

* **Google.** Scopes are sorted into *basic*, *sensitive* and *restricted*.
  Basic scopes need no verification and no publishing. Ask for one sensitive or
  restricted scope and Google will require a **OAuth verification screen**
  submission — a privacy policy you must host, a demonstration video, and a
  review that takes days and can be refused. Anything that reads or writes
  user content (Drive, Gmail, Calendar) is sensitive or restricted. Asking for
  Google Drive access, for instance, would turn a twenty-minute task into a
  multi-week process and would then be asking staff to grant your school access
  to their files.
* **Microsoft.** Any *delegated permission* beyond the three basic identity
  permissions requires a tenant administrator to grant consent for the app
  before anybody can sign in. The portal has no application permissions at all,
  and asks for no delegated permissions beyond identity, so no administrator has
  to consent to anything — and no member of staff has to click through a consent
  screen naming your organisation's data.

A school management portal needs to know *who signed in*. It does not need to
read anybody's mail. Keeping the scope list at three is what keeps this document
short.

---

## Appendix: quick reference

| | Google | Microsoft |
| --- | --- | --- |
| Developer site | <https://console.cloud.google.com/> | <https://entra.microsoft.com/> |
| App type | OAuth client ID, type **Web application** | App registration |
| Callback path | `/api/auth/callback/google` | `/api/auth/callback/microsoft-entra-id` |
| Local development URI | `http://localhost:3000/api/auth/callback/google` | `http://localhost:3000/api/auth/callback/microsoft-entra-id` |
| Where the id lives | Credentials → your client → Client ID | Overview → Application (client) ID |
| Where the secret lives | Shown once, in the download-JSON dialog | Certificates & secrets → shown once on creation |
| Secret recoverable later? | **No** at creation — delete and recreate (some console versions add a later **Download JSON** link) | **No** — delete and recreate |
| Verification needed? | **No**, for basic identity scopes | No admin consent needed for basic identity scopes |
| What staff see on first use | "Google hasn't verified this app" → Advanced → Go to app | A normal Microsoft sign-in |
| Personal addresses | Any Google account | Only with multi-tenant, which Step 2.3 advises against unless staff need it |
| School switch | `sso_google` | `sso_microsoft` |
| **Does the provider say the address is verified?** | **Yes** — `email_verified`. Missing or `false` is refused | **No** — Entra sends no such claim, so the portal accepts the address it is given |
| **Account types (Microsoft only)** | No such setting | **Single tenant** ("Accounts in this organizational directory only") — see Step 2.3 |
| **Who can reach the sign-in** | Any Google identity in the world; the address must match a live staff account | Single tenant: only your school's own Microsoft 365 directory. Multi-tenant: any Microsoft identity in any tenant, personal accounts included |
| **Named in the audit log?** | Yes, on every successful sign-in | Yes, on every successful sign-in |

Portal-side references: `apps/portal/lib/auth/sso.ts` holds the provider
registry and the refusal rules, `apps/portal/lib/auth/sso-signin.ts` wires them
to the database and writes the audit entry that names the provider on each
successful sign-in, and `apps/portal/app/login/page.tsx` draws the buttons from
whatever NextAuth reports is configured.