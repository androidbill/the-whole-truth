# The Whole Truth 🎭

A Psych-style party game (inspired by "The Naked Truth" deck): each round asks a
question about one player in the room. Everyone — including the subject — writes
a made-up answer. Answers are shown anonymously, everyone votes for their
favorite, and votes earn points. Best liar wins.

## Play modes

- **Online (Firebase)** — host creates a party, friends join with a 4-letter code
  on their own phones. Requires the Firebase config in `.env.local`.
- **Demo mode** — with no Firebase config, the game runs across browser tabs on
  one device (BroadcastChannel + localStorage). Add `?local=1` to the URL to
  force it even when Firebase is configured.

## Decks

- 🎉 **Party** — silly and safe-ish
- 🌶️ **Spicy** — 18+, cheeky and embarrassing (the Naked Truth spirit)
- 🎭 **Mixed** — both shuffled together

Questions live in `src/questions.js` (`{P}` = the subject player's name).

## Develop

```
npm install
npm run dev        # http://localhost:5200
npm run icons      # regenerate PWA icons (pure Node, no deps)
npm run build      # production build to dist/
```

## Hosting

The app deploys to **GitHub Pages** automatically on every push to `main`
(`.github/workflows/deploy.yml`): https://androidbill.github.io/the-whole-truth/

The build uses a relative Vite base (`./`) and a base-aware service worker, so
the same `dist/` also works at a domain root (e.g. Firebase Hosting) unchanged.

## Backend (Firestore)

The multiplayer backend is Cloud Firestore on project `the-whole-truth-b7k4` —
one document per party in `rooms/{CODE}`. The trust model is "anyone with the
room code can play" — no accounts, throwaway state. The web config is baked
into `src/main.jsx` (it is public by design; `firestore.rules` is the security
boundary). To point a fork at your own Firebase project, set the `VITE_FB_*`
variables (see `.env.example`) or edit the fallbacks in `main.jsx`, then:

```
npx firebase-tools deploy --only firestore --project <project-id>
```

## Conventions

- `APP_VERSION` in `src/main.jsx` (format `YYYY.MM.DD.NN`) must be bumped with
  every change; keep `VERSION` in `public/sw.js` in sync so installed PWAs pick
  up the update.
