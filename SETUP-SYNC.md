# Setting up the Shared Library (one-time, ~5 minutes, free)

The shared library lets two or more phones edit the **same live collection** —
scan a book on one phone and it appears on the other instantly. It runs on
Google Firebase's free tier. One person (the app owner) does this setup once;
everyone else just enters the household code.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with any Google account.
2. Click **Create a project** (name it anything, e.g. `shelfie`).
   You can turn **off** Google Analytics when asked — it isn't needed.

## 2. Create the database

1. In the left sidebar: **Build → Firestore Database → Create database**.
2. Pick the region closest to you, choose **production mode**, and create.
3. Open the **Rules** tab, replace the contents with the rules below, and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Each household's books are readable/writable by anyone who knows the
    // household code (an unguessable random string the app generates).
    match /households/{household}/books/{book} {
      allow read, write: if true;
    }
  }
}
```

> Security note: access control is the household code itself. The app generates
> codes like `cedar-otter-4821`; treat the code like a shared password and the
> data like it's semi-public (it's just your book list — no personal info).

## 3. Get your web app config

1. Click the ⚙️ gear (top-left) → **Project settings**.
2. Under **Your apps**, click the **`</>`** (Web) icon to register a web app
   (nickname anything; skip Firebase Hosting).
3. Copy the `firebaseConfig = { ... }` object it shows you.

## 4. Put the config in the app

Edit `js/firebase-config.js` in this repo (you can do it right in GitHub's web
editor) and replace `export const firebaseConfig = null;` with your config:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123",
};
```

Commit the change **to the branch GitHub Pages deploys from**. (A Firebase web
config is safe to publish — security comes from the Firestore rules, not from
hiding these values.)

## 5. Link your phones

After GitHub Pages redeploys (~1 minute):

1. **Your phone:** open the app → **Settings → Shared library**. Enter a
   library name (e.g. *Lukey Library*) and a password (6+ characters), then tap
   **Create new library**.
2. **Partner's phone:** same screen — enter the **same name and password** →
   **Join library**.

Done. Both phones now share one library: adds, shelf moves, and deletions sync
in real time, existing books on each phone are merged in when joining, and the
series checker counts books owned by either of you. Leaving the shared library
(same screen) only disconnects that phone — it keeps a local copy.

How the password works: the app scrambles name + password together on your
phone (PBKDF2) to derive the library's storage location — the password is never
sent or stored online. That also means it can't be recovered or changed in
place: if it's forgotten, create a new library (books come along) and have
everyone rejoin. Households created with the older random-code system keep
working, and the app offers a one-tap upgrade to a named library.
