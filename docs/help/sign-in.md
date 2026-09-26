# Signing in to Tvashtr

Tvashtr signs you in with your GitHub account. "Continue with GitHub" takes this tab to GitHub and
back. It is not a pop-up, so pop-up blockers don't affect it.

## "Sign-in didn’t finish"

**GitHub said the request was cancelled.** You pressed Cancel on GitHub's page, or closed it.
Nothing was changed. Press **Try again**.

**That sign-in took too long or was started in another tab.** Tvashtr keeps a short-lived cookie
(`tv_oauth_state`, 10 minutes) to check that the answer from GitHub belongs to the sign-in you
started. It fails when:

- more than 10 minutes passed on GitHub's page;
- you started signing in in one tab and finished in another, or in another browser;
- the browser dropped the cookie (see below).

Press **Try again** in the same tab and finish within a few minutes.

**GitHub didn’t complete the sign-in.** GitHub didn't hand back a usable answer. Check that your
GitHub account's email address is verified (GitHub → Settings → Emails), then try again.

## Cookies

Sign-in needs two first-party cookies from this site: `tv_oauth_state` while you are on GitHub, and
`tv_session` once you are signed in. If your browser blocks cookies for this site (a strict privacy
setting, an extension, or a private window that clears them), sign-in can't finish. Allow cookies
for this site and try again. Tvashtr sets no third-party or tracking cookies.

## "Authorize" is not "Install"

Signing in only asks GitHub who you are. GitHub's page says **Authorize**, and no repository access
is granted. You choose which repositories Tvashtr can use later, from inside the app, when you
connect GitHub. That step is GitHub's **Install** page.

## The Mac app

Tvashtr for Mac signs in from the app with the same GitHub account. You don't need to sign in on the
website first.

## Still stuck?

Open an issue at https://github.com/lazyxgenius/Tvashtr/issues with what the page said and the time.
Don't include cookies, codes or tokens.
