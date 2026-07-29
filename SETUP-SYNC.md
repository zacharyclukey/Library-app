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

    // Every request must come from a signed-in app user. Shelfie signs people
    // in anonymously and silently, so nobody has to make an account — but this
    // one line is what stops the open internet from reading or wiping the
    // database, which is the difference between "my family uses this" and
    // "anyone who finds the URL can delete it".
    function signedIn() { return request.auth != null; }

    // Nothing this app writes is anywhere near this big. The cap stops one
    // bad actor (or one bug) from filling the free tier.
    function reasonableSize() { return request.resource.size() < 20000; }

    // A household is addressed by an unguessable id derived from its name and
    // password, so knowing the id is the permission. Anyone signed in who has
    // it can read and write that household's books.
    match /households/{household}/books/{book} {
      allow read: if signedIn();
      allow write: if signedIn() && reasonableSize();
    }

    // Opt-in community layer: ratings, tags, reviews, and friend profiles.
    match /community/{book} {
      // Aggregate summaries: readable by all, recomputed by whoever rates.
      allow read: if signedIn();
      allow write: if signedIn() && reasonableSize();

      // One document per contributor. You may only write your own: the app
      // stamps every one with the writer's user id, and these rules check it.
      match /signals/{signal} {
        allow read: if signedIn();
        allow create: if signedIn() && reasonableSize()
                      && request.resource.data.uid == request.auth.uid;
        allow update, delete: if signedIn() && reasonableSize()
                      && (resource.data.uid == request.auth.uid
                          // Documents written before this rule existed have no
                          // owner recorded. Once everyone has opened the app on
                          // the current version, delete this line.
                          || !('uid' in resource.data));
      }
    }
  }
}
```

## 2b. Turn on anonymous sign-in

The rules above require a signed-in user, so switch that on — it takes one click
and costs nothing.

1. In the left sidebar: **Build → Authentication → Get started**.
2. Choose **Anonymous** from the list of providers, toggle it **Enable**, save.

Nobody sees a login screen: the app signs each device in silently in the
background. If you skip this step the app still opens and works on the phone,
but syncing will report an error, because the rules will refuse every write.

> **What these rules do and don't protect.** Signing in stops strangers reading
> or deleting the database, and the ownership check stops one person overwriting
> another's ratings, reviews, or friend profile. What they can't do is make the
> household code secret for you: anyone signed in who *has* your code can read
> that household. Treat the code like a shared password. This is the right level
> for family and friends; a public release would want real accounts (see
> `docs/SECURITY.md`).

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
   library name (e.g. *Lukey Library*) and a password (8+ characters), then tap
   **Create new library**.
2. **Partner's phone:** same screen — enter the **same name and password** →
   **Join library**. This files a join request.
3. **Back on your phone:** a gold dot appears on Settings — open
   **Shared library** and tap **Approve** next to their name. Their phone
   connects automatically within a few seconds (no books are shared in either
   direction until you approve, and you can Deny anything unexpected).

Done. Both phones now share one library: adds, shelf moves, and deletions sync
in real time, existing books on each phone are merged in when joining, and the
series checker counts books owned by either of you. Leaving the shared library
(same screen) only disconnects that phone — it keeps a local copy.

The **Who's in this library** list on that screen shows every connected device,
its profile name, and when it was last active — so you can always see exactly
who you're sharing with.

## How the name and password work

The app scrambles name + password together on your phone (PBKDF2, 150k
iterations) to derive the library's storage location. The password is never
sent or stored online.

- **The pair is the key.** Library names are not globally unique and don't need
  to be: "Smith Library" with *your* password is a completely different library
  from "Smith Library" with someone else's. Two households only collide if they
  pick the *same name and the same password*.
- **Creating never merges silently.** If you tap *Create* and that exact
  name + password already exists, the app refuses and tells you to Join
  instead (or pick a different password) — so you can't be dropped into a
  stranger's library, and they can't be dropped into yours.
- **Weak passwords are rejected on creation** (minimum 8 characters, no common
  ones, not the same as the library name), because the password is the only
  thing keeping two same-named libraries apart.
- **It can't be recovered or changed in place.** If it's forgotten, create a new
  library (your books come along) and have everyone rejoin.

Households created with the older random-code system keep working, and the app
offers a one-tap upgrade to a named library.
