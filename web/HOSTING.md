# Static website hosting

Build from the repository root:

```powershell
npm.cmd run build:hosting
```

Publish **`dist/hosting`**, not the repository root. The build exports the Expo
customer app and copies the static portal pages and their public browser modules.
Server functions, account provisioning scripts, tests, and credentials are not
included. Keep the generated directory structure intact so relative links work.

| Address | Page |
| --- | --- |
| `/web/landing.html` | Marketing landing page |
| `/` | Customer app (existing login and routes) |
| `/web/login.html` | Store administrator login |
| `/web/signup.html` | Shop registration |
| `/web/superadmin.html` | Existing live system overview |

For Firebase Hosting, use the separate `firebase.hosting.json` configuration:

```powershell
firebase deploy --project techknowcapstone --config firebase.hosting.json --only hosting
```

This command publishes the site; building does not deploy anything. On another
static host, use `dist/hosting` as the publish directory and send unmatched routes
to `/index.html` for the customer app. Serve existing `/web/` files directly.
The Firebase rewrite follows the [official Hosting configuration](https://firebase.google.com/docs/hosting/full-config#rewrites).
Add the final hostname to Firebase Authentication's authorized domains when
enabling login on that hostname.

The landing page uses local photos, SVGs, system fonts, CSS, and a small script
for its menu and inspiration category filters. The `landing-*.jpg` photos are
included by the existing hosting build; photo credits are in the page footer.
It does not depend on Firebase, external images, icon stylesheets, or a font CDN.
Its gallery, FAQ, and native mobile menu remain accessible with JavaScript disabled.
Store and super-admin Firebase access continues to use the existing project
configuration and deployed rules. The current no-login system overview reads
collections allowed by those rules; hosting does not change those permissions.
