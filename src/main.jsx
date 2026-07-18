// ============================================================
//  THE WHOLE TRUTH — a party game of beautiful lies
//  Everyone answers a question about one player. Everyone votes
//  for their favorite answer. Best liar wins.
// ============================================================
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { buildDeck } from './questions.js'
import './styles.css'

export const APP_VERSION = '2026.07.17.14'
export const APP_AUTHOR = 'Bill Parsons'

// ------------------------------------------------------------
// Identity & small utils
// ------------------------------------------------------------
const LS_ID = 'twt-player-id'
const LS_PROFILE = 'twt-profile'
const LS_SESSION = 'twt-session'
const LS_HISTORY = 'twt-history'
const LS_HISTORY_LAST = 'twt-history-last'

function uid() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}
// In online mode identity/session live in localStorage (per device).
// In local demo mode they live in sessionStorage (per tab) so several
// tabs can play as different people.
function idStorage() {
  return ONLINE_MODE ? localStorage : sessionStorage
}
function myId() {
  let id = idStorage().getItem(LS_ID)
  if (!id) {
    id = uid()
    idStorage().setItem(LS_ID, id)
  }
  return id
}
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
function randomCode() {
  let c = ''
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return c
}

const EMOJIS = [
  '🦊', '🐸', '🦄', '🐙', '🦖', '🐼', '🐵', '🦁',
  '🐯', '🐨', '🐷', '🐰', '🦉', '🦋', '🐳', '🦩',
  '👻', '🤖', '🎃', '🍕', '🌮', '🍩', '🎸', '🛸',
]

const DELETE = '__DELETE__'

// ------------------------------------------------------------
// PWA: install prompt + update detection + hard refresh
// ------------------------------------------------------------
let deferredInstall = null
const installSubs = new Set()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e
  installSubs.forEach((f) => f(true))
})
window.addEventListener('appinstalled', () => {
  deferredInstall = null
  installSubs.forEach((f) => f(false))
})

function useCanInstall() {
  const [can, setCan] = useState(!!deferredInstall)
  useEffect(() => {
    installSubs.add(setCan)
    return () => installSubs.delete(setCan)
  }, [])
  return can
}

async function promptInstall() {
  const ev = deferredInstall
  if (!ev) return
  deferredInstall = null
  installSubs.forEach((f) => f(false))
  ev.prompt()
  try {
    await ev.userChoice
  } catch {}
}

// Canonical app link. BASE_URL is './' (relative base), so resolve against
// the current page rather than concatenating to the origin.
function appUrl() {
  return new URL('.', location.href).href
}

// Native share sheet where available; otherwise copy the link.
async function shareApp() {
  const url = appUrl()
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'The Whole Truth',
        text: 'The party game where everyone lies about each other — come play!',
        url,
      })
    } else {
      await navigator.clipboard.writeText(url)
      notify('Link copied to clipboard!')
    }
  } catch {
    // user closed the share sheet — not an error
  }
}

// Nuke caches + service worker, then reload — a genuinely fresh copy.
async function hardRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if (window.caches) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {}
  location.reload()
}

// Polls version.json (emitted at build time from APP_VERSION); returns the
// newer version string when the server has one, else null.
function useUpdateCheck() {
  const [fresh, setFresh] = useState(null)
  useEffect(() => {
    let stopped = false
    const check = async () => {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'version.json?t=' + Date.now(), {
          cache: 'no-store',
        })
        if (!res.ok) return
        const { version } = await res.json()
        if (!stopped && version && version > APP_VERSION) setFresh(version)
      } catch {}
    }
    check()
    const iv = setInterval(check, 10 * 60 * 1000)
    const vis = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', vis)
    return () => {
      stopped = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  return fresh
}

// ------------------------------------------------------------
// Toast pubsub
// ------------------------------------------------------------
let toastFn = null
function notify(msg) {
  if (toastFn) toastFn(msg)
}

// ------------------------------------------------------------
// Data stores. Same tiny API for Firestore and local demo mode:
//   create(code, data) / get(code) / update(code, dottedPatch)
//   watch(code, cb) -> unsubscribe
// Patches use Firestore-style dotted paths. Value DELETE removes a field.
// ------------------------------------------------------------
// Firebase web config is public by design (it ships in the built JS either
// way; Firestore rules are the security boundary). Env vars can override it,
// e.g. to point a fork at its own project.
const FB = {
  apiKey: import.meta.env.VITE_FB_API_KEY || 'AIzaSyCutcilkoXvIVEKYH5xfRUbs3tzwNja18U',
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN || 'the-whole-truth-b7k4.firebaseapp.com',
  projectId: import.meta.env.VITE_FB_PROJECT_ID || 'the-whole-truth-b7k4',
  appId: import.meta.env.VITE_FB_APP_ID || '1:924562869097:web:55d689399e8f5e8a954bf8',
}
const FORCE_LOCAL = new URLSearchParams(location.search).has('local')
export const ONLINE_MODE = !!(FB.apiKey && FB.projectId) && !FORCE_LOCAL

function makeLocalStore() {
  const KEY = (code) => 'twt-room-' + code
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('twt-rooms') : null
  const subs = new Map() // code -> Set<cb>

  const read = (code) => {
    try {
      const raw = localStorage.getItem(KEY(code))
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
  const emit = (code) => {
    const room = read(code)
    ;(subs.get(code) || []).forEach((cb) => cb(room))
  }
  if (bc) bc.onmessage = (e) => emit(e.data)
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('twt-room-')) emit(e.key.slice('twt-room-'.length))
  })

  const applyPatch = (obj, patch) => {
    for (const [path, value] of Object.entries(patch)) {
      const keys = path.split('.')
      let node = obj
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof node[keys[i]] !== 'object' || node[keys[i]] === null) node[keys[i]] = {}
        node = node[keys[i]]
      }
      const last = keys[keys.length - 1]
      if (value === DELETE) delete node[last]
      else node[last] = value
    }
    return obj
  }

  return {
    mode: 'local',
    async create(code, data) {
      localStorage.setItem(KEY(code), JSON.stringify(data))
      if (bc) bc.postMessage(code)
      emit(code)
    },
    async get(code) {
      return read(code)
    },
    async update(code, patch) {
      const room = read(code)
      if (!room) throw new Error('Room not found')
      applyPatch(room, patch)
      localStorage.setItem(KEY(code), JSON.stringify(room))
      if (bc) bc.postMessage(code)
      emit(code)
    },
    watch(code, cb) {
      if (!subs.has(code)) subs.set(code, new Set())
      subs.get(code).add(cb)
      cb(read(code))
      return () => subs.get(code)?.delete(cb)
    },
  }
}

let storePromise = null
function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      if (!ONLINE_MODE) return makeLocalStore()
      const { initializeApp } = await import('firebase/app')
      const { initializeFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, deleteField } =
        await import('firebase/firestore')
      const app = initializeApp(FB)
      // Long polling instead of streamed responses: WebKit (all iOS browsers)
      // buffers Firestore's stream, delaying snapshots by seconds.
      const db = initializeFirestore(app, { experimentalForceLongPolling: true })
      const ref = (code) => doc(db, 'rooms', code)
      const mapPatch = (patch) => {
        const out = {}
        for (const [k, v] of Object.entries(patch)) out[k] = v === DELETE ? deleteField() : v
        return out
      }
      return {
        mode: 'online',
        async create(code, data) {
          await setDoc(ref(code), data)
        },
        async get(code) {
          const snap = await getDoc(ref(code))
          return snap.exists() ? snap.data() : null
        },
        async update(code, patch) {
          await updateDoc(ref(code), mapPatch(patch))
        },
        watch(code, cb) {
          const unsub = onSnapshot(
            ref(code),
            (snap) => cb(snap.exists() ? snap.data() : null),
            (err) => {
              console.error('watch error', err)
              notify('Connection hiccup — retrying…')
            }
          )
          // iOS suspends the connection when the screen locks; on wake, fetch
          // the room once so players catch up before the stream reconnects.
          const onVis = () => {
            if (document.visibilityState !== 'visible') return
            getDoc(ref(code))
              .then((snap) => cb(snap.exists() ? snap.data() : null))
              .catch(() => {})
          }
          document.addEventListener('visibilitychange', onVis)
          return () => {
            unsub()
            document.removeEventListener('visibilitychange', onVis)
          }
        },
      }
    })()
  }
  return storePromise
}

// ------------------------------------------------------------
// Game helpers
// ------------------------------------------------------------
const DECKS = [
  { id: 'party', emoji: '🎉', name: 'Party', blurb: 'Silly, safe-ish, everyone plays' },
  { id: 'spicy', emoji: '🌶️', name: 'Spicy', blurb: '18+ · cheeky & embarrassing' },
  { id: 'mixed', emoji: '🎭', name: 'Mixed', blurb: 'A shot of both, shaken' },
]

function playerList(room) {
  return Object.entries(room?.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
}
function ranked(room) {
  return playerList(room).sort((a, b) => (b.score || 0) - (a.score || 0))
}
function subjectOf(room) {
  if (!room?.order?.length) return null
  const sid = room.order[room.qIndex % room.order.length]
  return { id: sid, ...(room.players[sid] || { name: '???', emoji: '❓' }) }
}
const PRONOUNS = {
  m: { they: 'he', them: 'him', their: 'his', theirs: 'his', themselves: 'himself' },
  f: { they: 'she', them: 'her', their: 'her', theirs: 'hers', themselves: 'herself' },
}
function questionText(room) {
  const subj = subjectOf(room)
  const raw = room?.questions?.[room.qIndex] || ''
  // Questions use the first name; pronouns follow the chosen sex.
  // (they/them fallback for players from before profiles had these fields)
  const first = subj?.first || subj?.name || '???'
  const p = PRONOUNS[subj?.gender] || {
    they: 'they', them: 'them', their: 'their', theirs: 'theirs', themselves: 'themselves',
  }
  let out = raw.replaceAll('{P}', first)
  for (const [token, word] of Object.entries(p)) out = out.replaceAll('{' + token + '}', word)
  return out
}
function tally(room) {
  const counts = {}
  for (const target of Object.values(room?.current?.votes || {})) {
    counts[target] = (counts[target] || 0) + 1
  }
  return counts
}

// ------------------------------------------------------------
// Game history (kept per device in localStorage)
// ------------------------------------------------------------
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(LS_HISTORY)) || []
  } catch {
    return []
  }
}

// Called whenever we see the final screen; the fingerprint keeps the same
// game from being recorded twice (including across reloads).
function saveGameToHistory(room) {
  try {
    const players = ranked(room).map((p) => ({
      name: p.name,
      emoji: p.emoji,
      votes: Math.round((p.score || 0) / 100),
    }))
    const key =
      room.code + ':' + (room.createdAt || 0) + ':' + players.map((p) => p.name + p.votes).join(',')
    if (localStorage.getItem(LS_HISTORY_LAST) === key) return
    localStorage.setItem(LS_HISTORY_LAST, key)
    const list = loadHistory()
    list.unshift({ at: Date.now(), code: room.code, deck: room.deck, players })
    localStorage.setItem(LS_HISTORY, JSON.stringify(list.slice(0, 50)))
  } catch {}
}

// ------------------------------------------------------------
// Confetti (final screen)
// ------------------------------------------------------------
function Confetti() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    let raf
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = innerWidth * dpr
      canvas.height = innerHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)
    const colors = ['#f472b6', '#c084fc', '#facc15', '#4ade80', '#38bdf8', '#fb7185']
    const bits = Array.from({ length: 140 }, () => ({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height,
      w: (4 + Math.random() * 6) * dpr,
      h: (8 + Math.random() * 8) * dpr,
      vy: (1.2 + Math.random() * 2.4) * dpr,
      vx: (Math.random() - 0.5) * 1.4 * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const b of bits) {
        b.y += b.vy
        b.x += b.vx + Math.sin(b.y / 40) * 0.6
        b.rot += b.vr
        if (b.y > canvas.height + 20) {
          b.y = -20
          b.x = Math.random() * canvas.width
        }
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.rot)
        ctx.fillStyle = b.color
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        ctx.restore()
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} className="confetti" />
}

// ------------------------------------------------------------
// Shared UI bits
// ------------------------------------------------------------
function Logo({ small }) {
  return (
    <div className={'logo' + (small ? ' logo-small' : '')}>
      <span className="logo-the">THE</span>
      <span className="logo-whole">WHOLE</span>
      <span className="logo-truth">TRUTH</span>
    </div>
  )
}

function PlayerChip({ p, done, dim, host }) {
  return (
    <div className={'chip' + (done ? ' chip-done' : '') + (dim ? ' chip-dim' : '')}>
      <span className="chip-emoji">{p.emoji}</span>
      <span className="chip-name">{p.name}</span>
      {host && <span className="chip-host">HOST</span>}
      {done && <span className="chip-check">✓</span>}
    </div>
  )
}

function WaitBoard({ room, doneIds, label }) {
  const players = playerList(room)
  return (
    <div className="waitboard">
      <div className="waitboard-label">{label}</div>
      <div className="chips">
        {players.map((p) => (
          <PlayerChip key={p.id} p={p} done={doneIds.includes(p.id)} dim={!doneIds.includes(p.id)} />
        ))}
      </div>
    </div>
  )
}

function Leaderboard({ room, highlight }) {
  const rows = ranked(room)
  return (
    <div className="board">
      {rows.map((p, i) => (
        <div key={p.id} className={'board-row' + (p.id === highlight ? ' board-me' : '')}>
          <span className="board-rank">{i === 0 ? '👑' : i + 1}</span>
          <span className="board-emoji">{p.emoji}</span>
          <span className="board-name">{p.name}</span>
          <span className="board-score">{p.score || 0}</span>
        </div>
      ))}
    </div>
  )
}

function RoundHeader({ room }) {
  return (
    <div className="round-pill">
      Question {room.qIndex + 1} <span className="round-of">of</span> {room.totalQ}
    </div>
  )
}

// ------------------------------------------------------------
// Screens
// ------------------------------------------------------------
function AboutModal({ onClose }) {
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <img
          className="about-icon"
          src={import.meta.env.BASE_URL + 'icons/icon-192.png'}
          alt="The Whole Truth icon"
        />
        <div className="about-name">The Whole Truth</div>
        <div className="about-by">Created by {APP_AUTHOR}</div>
        <div className="about-version">Version {APP_VERSION}</div>
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function HistoryModal({ onClose }) {
  const games = loadHistory()
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card history-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-name">📜 Game History</div>
        {games.length === 0 ? (
          <div className="history-empty">No games on this device yet — go play one!</div>
        ) : (
          <div className="history-list">
            {games.map((g, i) => {
              const deck = DECKS.find((d) => d.id === g.deck)
              return (
                <div key={i} className="history-item">
                  <div className="history-top">
                    <span className="history-date">
                      {new Date(g.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <span className="history-deck">{deck ? deck.emoji + ' ' + deck.name : ''}</span>
                  </div>
                  <div className="history-winner">
                    👑 {g.players[0]?.emoji} {g.players[0]?.name} won
                  </div>
                  {g.players.map((p, j) => (
                    <div key={j} className="history-player">
                      <span>
                        {p.emoji} {p.name}
                      </span>
                      <span className="history-votes">
                        {p.votes} vote{p.votes === 1 ? '' : 's'} won
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function QrModal({ onClose }) {
  const canvasRef = useRef(null)
  const url = appUrl()
  useEffect(() => {
    let cancelled = false
    import('qrcode').then(({ default: QRCode }) => {
      if (cancelled || !canvasRef.current) return
      QRCode.toCanvas(canvasRef.current, url, {
        width: 240,
        margin: 2,
        color: { dark: '#150a26', light: '#ffffff' },
      }).catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [url])
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card qr-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-name">Scan to open the app</div>
        <canvas ref={canvasRef} className="qr-canvas" />
        <div className="qr-url">{url}</div>
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function QrIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v3h-3v-3zm-5 0h3v3h-3v-3zm0 5h3v3h-3v-3zm5 0h3v3h-3v-3z" />
    </svg>
  )
}

function HomeScreen({ onCreate, onJoin }) {
  const [menu, setMenu] = useState(false)
  const [about, setAbout] = useState(false)
  const [qr, setQr] = useState(false)
  const [history, setHistory] = useState(false)
  const canInstall = useCanInstall()
  return (
    <div className="screen screen-home">
      <div className="home-glow" />
      <div className="kebab-wrap">
        <button className="kebab" aria-label="Show QR code" onClick={() => setQr(true)}>
          <QrIcon />
        </button>
        <button className="kebab" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
          ⋮
        </button>
        {menu && (
          <>
            <div className="menu-backdrop" onClick={() => setMenu(false)} />
            <div className="menu-pop">
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(false)
                  hardRefresh()
                }}
              >
                🔄 Refresh
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(false)
                  shareApp()
                }}
              >
                📤 Share
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(false)
                  setHistory(true)
                }}
              >
                📜 History
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setMenu(false)
                  setAbout(true)
                }}
              >
                ℹ️ About
              </button>
            </div>
          </>
        )}
      </div>
      <Logo />
      <p className="tagline">
        The party game where everyone <em>lies</em> about each other —
        and votes for the best lie.
      </p>
      <div className="stack">
        <button className="btn btn-primary btn-big" onClick={onCreate}>
          🎉 Start a Party
        </button>
        <button className="btn btn-ghost btn-big" onClick={onJoin}>
          🔑 Join with Code
        </button>
      </div>
      {!ONLINE_MODE && (
        <div className="demo-note">
          Demo mode — playable across tabs on this device only.
          <br />
          Connect Firebase to play across phones.
        </div>
      )}
      {canInstall && (
        <button className="install-banner" onClick={promptInstall}>
          <img src={import.meta.env.BASE_URL + 'icons/icon-192.png'} alt="" />
          <span>
            <b>Install The Whole Truth</b>
            <small>Free · full screen · works like a real app</small>
          </span>
          <span className="install-cta">Install</span>
        </button>
      )}
      <div className="version">v{APP_VERSION}</div>
      {about && <AboutModal onClose={() => setAbout(false)} />}
      {qr && <QrModal onClose={() => setQr(false)} />}
      {history && <HistoryModal onClose={() => setHistory(false)} />}
    </div>
  )
}

// Profanity filter for names. Substring list = words that essentially never
// occur inside legitimate names (catches 'fuckface' etc.). Word list = words
// that DO occur inside real names (Cassidy, Dickson, Hancock), so they only
// match as a whole word. Leet characters are normalized first.
const LEET = { 0: 'o', 1: 'i', '!': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't' }
const BAD_SUBSTRINGS = [
  'fuck', 'shit', 'cunt', 'bitch', 'wank', 'jizz', 'nigger', 'nigga', 'faggot',
  'retard', 'whore', 'slut', 'dildo', 'boner', 'handjob', 'blowjob', 'cocksuck',
  'dickhead', 'asshole', 'douche', 'pussy', 'tranny', 'penis', 'queef', 'smegma',
]
const BAD_WORDS = [
  'ass', 'arse', 'dick', 'cock', 'piss', 'tits', 'cum', 'sex', 'hoe', 'crap',
  'twat', 'prick', 'fag', 'homo', 'anal', 'spic', 'kike', 'chink', 'porn',
]
function hasProfanity(text) {
  const norm = (text || '').toLowerCase().replace(/[013457!@$]/g, (c) => LEET[c] || c)
  const squashed = norm.replace(/[^a-z]/g, '')
  if (BAD_SUBSTRINGS.some((w) => squashed.includes(w))) return true
  const tokens = norm.split(/[^a-z]+/)
  return tokens.some((t) => BAD_WORDS.includes(t))
}

function playerFromProfile(profile) {
  return {
    name: profile.name.trim(),
    first: profile.first.trim(),
    last: profile.last.trim(),
    gender: profile.gender,
    emoji: profile.emoji,
    score: 0,
    joinedAt: Date.now(),
  }
}

function profileError(profile) {
  if (!profile.name.trim()) return 'Pick a nickname first!'
  if (!profile.first?.trim()) return "What's your first name?"
  if (!profile.last?.trim()) return "What's your last name?"
  if (!profile.gender) return 'Choose male or female.'
  // Nickname is allowed to be crude — real names are not.
  const fields = [
    ['first name', profile.first],
    ['last name', profile.last],
  ]
  for (const [label, value] of fields) {
    if (hasProfanity(value)) return `Whoa — keep your ${label} clean! 😅`
  }
  return null
}

function ProfileForm({ profile, setProfile }) {
  return (
    <>
      <label className="field-label">Choose your avatar</label>
      <div className="emoji-grid">
        {EMOJIS.map((e) => (
          <button
            key={e}
            className={'emoji-cell' + (profile.emoji === e ? ' emoji-sel' : '')}
            onClick={() => setProfile({ ...profile, emoji: e })}
          >
            {e}
          </button>
        ))}
      </div>
      <label className="field-label">Nickname</label>
      <input
        className="input"
        maxLength={16}
        placeholder="e.g. SaltedCod"
        autoComplete="nickname"
        value={profile.name}
        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
      />
      <label className="field-label">First name</label>
      <input
        className="input"
        maxLength={20}
        placeholder="e.g. John"
        autoComplete="given-name"
        value={profile.first || ''}
        onChange={(e) => setProfile({ ...profile, first: e.target.value })}
      />
      <label className="field-label">Last name</label>
      <input
        className="input"
        maxLength={20}
        placeholder="e.g. Smith"
        autoComplete="family-name"
        value={profile.last || ''}
        onChange={(e) => setProfile({ ...profile, last: e.target.value })}
      />
      <label className="field-label">I am</label>
      <div className="seg">
        <button
          className={'seg-btn' + (profile.gender === 'm' ? ' seg-sel' : '')}
          onClick={() => setProfile({ ...profile, gender: 'm' })}
        >
          👨 Male
        </button>
        <button
          className={'seg-btn' + (profile.gender === 'f' ? ' seg-sel' : '')}
          onClick={() => setProfile({ ...profile, gender: 'f' })}
        >
          👩 Female
        </button>
      </div>
    </>
  )
}

function CreateScreen({ profile, setProfile, onBack, onCreated }) {
  const [deck, setDeck] = useState('mixed')
  const [cycles, setCycles] = useState(1)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const err = profileError(profile)
    if (err) return notify(err)
    setBusy(true)
    try {
      const store = await getStore()
      let code = randomCode()
      for (let i = 0; i < 5; i++) {
        if (!(await store.get(code))) break
        code = randomCode()
      }
      const id = myId()
      await store.create(code, {
        code,
        createdAt: Date.now(),
        hostId: id,
        deck,
        cycles,
        phase: 'lobby',
        players: { [id]: playerFromProfile(profile) },
        order: [],
        questions: [],
        qIndex: 0,
        totalQ: 0,
        current: { answers: {}, votes: {}, revealOrder: [], reactions: {} },
      })
      onCreated(code)
    } catch (err) {
      console.error(err)
      notify('Could not create the party. ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen screen-form">
      <button className="btn-back" onClick={onBack}>‹ Back</button>
      <h2 className="form-title">Start a Party</h2>
      <ProfileForm profile={profile} setProfile={setProfile} />
      <label className="field-label">Question deck</label>
      <div className="deck-grid">
        {DECKS.map((d) => (
          <button
            key={d.id}
            className={'deck-card' + (deck === d.id ? ' deck-sel' : '')}
            onClick={() => setDeck(d.id)}
          >
            <span className="deck-emoji">{d.emoji}</span>
            <span className="deck-name">{d.name}</span>
            <span className="deck-blurb">{d.blurb}</span>
          </button>
        ))}
      </div>
      <label className="field-label">Questions per player</label>
      <div className="seg">
        {[1, 2, 3].map((n) => (
          <button key={n} className={'seg-btn' + (cycles === n ? ' seg-sel' : '')} onClick={() => setCycles(n)}>
            {n}
          </button>
        ))}
      </div>
      <button className="btn btn-primary btn-big" disabled={busy} onClick={create}>
        {busy ? '…' : 'Create Party 🚀'}
      </button>
    </div>
  )
}

function JoinScreen({ profile, setProfile, onBack, onJoined, prefillCode }) {
  const [code, setCode] = useState(prefillCode || '')
  const [busy, setBusy] = useState(false)

  const join = async () => {
    const c = code.trim().toUpperCase()
    if (c.length !== 4) return notify('Party codes are 4 letters.')
    const err = profileError(profile)
    if (err) return notify(err)
    setBusy(true)
    try {
      const store = await getStore()
      const room = await store.get(c)
      if (!room) {
        notify("Hmm, no party with that code. Check the letters?")
        return
      }
      const id = myId()
      const alreadyIn = !!room.players[id]
      if (!alreadyIn) {
        if (room.phase !== 'lobby') {
          notify('That party already started — ask them to wait for the next game!')
          return
        }
        if (Object.keys(room.players).length >= 12) {
          notify('That party is full (12 max).')
          return
        }
        await store.update(c, {
          ['players.' + id]: playerFromProfile(profile),
        })
      }
      onJoined(c)
    } catch (err) {
      console.error(err)
      notify('Could not join. ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen screen-form">
      <button className="btn-back" onClick={onBack}>‹ Back</button>
      <h2 className="form-title">Join a Party</h2>
      <label className="field-label">Party code</label>
      <input
        className="input input-code"
        maxLength={4}
        placeholder="ABCD"
        autoCapitalize="characters"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
      />
      <ProfileForm profile={profile} setProfile={setProfile} />
      <button className="btn btn-primary btn-big" disabled={busy} onClick={join}>
        {busy ? '…' : "I'm In 🙌"}
      </button>
    </div>
  )
}

function LobbyScreen({ room, me, isHost, act, onLeave }) {
  const players = playerList(room)
  const canStart = players.length >= 3
  const deck = DECKS.find((d) => d.id === room.deck) || DECKS[2]

  const start = () => {
    const ids = shuffle(players.map((p) => p.id))
    const totalQ = ids.length * (room.cycles || 1)
    let pool = shuffle(buildDeck(room.deck))
    while (pool.length < totalQ) pool = pool.concat(shuffle(buildDeck(room.deck)))
    const patch = {
      phase: 'write',
      order: ids,
      questions: pool.slice(0, totalQ),
      qIndex: 0,
      totalQ,
      current: { answers: {}, votes: {}, revealOrder: [], reactions: {} },
    }
    for (const p of players) patch['players.' + p.id + '.score'] = 0
    act(patch)
  }

  return (
    <div className="screen screen-lobby">
      <Logo small />
      <div className="code-box">
        <div className="code-label">PARTY CODE</div>
        <div className="code-value">{room.code}</div>
        <div className="code-hint">
          {ONLINE_MODE ? 'Friends join on their phones with this code' : 'Open another tab and join with this code'}
        </div>
      </div>
      <div className="lobby-deck">
        {deck.emoji} {deck.name} deck · {room.cycles} question{room.cycles > 1 ? 's' : ''} per player
      </div>
      <div className="chips chips-lobby">
        {players.map((p) => (
          <PlayerChip key={p.id} p={p} host={p.id === room.hostId} />
        ))}
      </div>
      {isHost ? (
        <>
          <button className="btn btn-primary btn-big" disabled={!canStart} onClick={start}>
            {canStart ? `Start with ${players.length} players 🎬` : 'Need at least 3 players…'}
          </button>
          <button className="btn-link" onClick={() => act({ phase: 'ended' })}>
            End party
          </button>
        </>
      ) : (
        <>
          <div className="waiting-pulse">Waiting for the host to start…</div>
          <button className="btn-link" onClick={onLeave}>
            Leave party
          </button>
        </>
      )}
    </div>
  )
}

function WriteScreen({ room, me, isHost, act }) {
  const subj = subjectOf(room)
  const isSubject = subj?.id === me.id
  const answers = room.current?.answers || {}
  const mine = answers[me.id]
  const [text, setText] = useState('')
  const doneIds = Object.keys(answers)

  const submit = () => {
    const t = text.trim()
    if (!t) return
    act({ ['current.answers.' + me.id]: t })
  }

  return (
    <div className="screen screen-play">
      <RoundHeader room={room} />
      <div className="subject-banner">
        <span className="subject-emoji">{subj?.emoji}</span>
        This one's about <b>{isSubject ? 'YOU' : subj?.first || subj?.name}</b>
      </div>
      <h2 className="question">{questionText(room)}</h2>
      {!mine ? (
        <>
          <textarea
            className="answer-input"
            maxLength={120}
            rows={3}
            placeholder={isSubject ? 'Defend yourself… or lean into it' : 'Make it juicy. Make it believable.'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="char-count">{text.length}/120</div>
          <button className="btn btn-primary btn-big" disabled={!text.trim()} onClick={submit}>
            Lock It In 🔒
          </button>
        </>
      ) : (
        <>
          <div className="my-answer">
            <div className="my-answer-label">Your answer</div>
            “{mine}”
          </div>
          <WaitBoard room={room} doneIds={doneIds} label="Waiting on the slow typers…" />
        </>
      )}
      {isHost && doneIds.length >= 2 && doneIds.length < playerList(room).length && (
        <button className="btn-link" onClick={() => act({ __host_force: 'vote' })}>
          Host: skip the stragglers →
        </button>
      )}
    </div>
  )
}

function VoteScreen({ room, me, isHost, act }) {
  const answers = room.current?.answers || {}
  const votes = room.current?.votes || {}
  const order = room.current?.revealOrder || []
  const myVote = votes[me.id]
  const subj = subjectOf(room)
  const doneIds = Object.keys(votes)
  const voteFor = (pid) => {
    if (pid === me.id) return
    act({ ['current.votes.' + me.id]: pid })
  }
  const canVote = order.some((pid) => pid !== me.id)

  return (
    <div className="screen screen-play">
      <RoundHeader room={room} />
      <h2 className="question question-small">{questionText(room)}</h2>
      <div className="vote-hint">
        {myVote ? 'Locked in! You can still change your mind…' : 'Vote for your favorite answer'}
      </div>
      <div className="vote-list">
        {order.map((pid, i) => (
          <button
            key={pid}
            className={
              'vote-card' +
              (myVote === pid ? ' vote-sel' : '') +
              (pid === me.id ? ' vote-own' : '')
            }
            disabled={pid === me.id}
            onClick={() => voteFor(pid)}
          >
            <span className="vote-letter">{String.fromCharCode(65 + i)}</span>
            <span className="vote-text">{answers[pid]}</span>
            {pid === me.id && <span className="vote-yours">your lie</span>}
            {myVote === pid && <span className="vote-check">✓</span>}
          </button>
        ))}
      </div>
      {!canVote && <div className="vote-hint">No one else answered — hang tight!</div>}
      {myVote && <WaitBoard room={room} doneIds={doneIds} label="Waiting for the undecided…" />}
      {isHost && doneIds.length >= 1 && doneIds.length < playerList(room).length && (
        <button className="btn-link" onClick={() => act({ __host_force: 'reveal' })}>
          Host: close the polls →
        </button>
      )}
    </div>
  )
}

const REACTION_EMOJIS = [
  '😂', '🤣', '😅', '😍', '🥰', '😏', '😉', '😳',
  '😱', '🤯', '🥵', '😈', '🤢', '🙄', '💀', '🤔',
]

function SmileyOutline() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
      <circle cx="9" cy="10" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ReactionBar({ pid, reactions, open, onToggle, onReact }) {
  const mine = reactions?.[pid] || {}
  const grouped = {}
  for (const e of Object.values(mine)) grouped[e] = (grouped[e] || 0) + 1
  return (
    <div className="reaction-wrap">
      <div className="reaction-row">
        {Object.entries(grouped).map(([e, n]) => (
          <span key={e} className="reaction-chip">
            {e}
            {n > 1 && <small>{n}</small>}
          </span>
        ))}
        <button className="react-btn" aria-label="React to this answer" onClick={onToggle}>
          <SmileyOutline />
        </button>
      </div>
      {open && (
        <div className="react-picker">
          {REACTION_EMOJIS.map((e) => (
            <button key={e} className="react-pick" onClick={() => onReact(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RevealScreen({ room, me, isHost, act }) {
  const answers = room.current?.answers || {}
  const votes = room.current?.votes || {}
  const reactions = room.current?.reactions || {}
  const [pickerFor, setPickerFor] = useState(null)
  const counts = tally(room)
  const subj = subjectOf(room)
  const players = room.players
  const react = (pid, emoji) => {
    act({ ['current.reactions.' + pid + '.' + me.id]: emoji })
    setPickerFor(null)
  }
  const rows = (room.current?.revealOrder || [])
    .map((pid) => ({
      pid,
      text: answers[pid],
      votes: counts[pid] || 0,
      voters: Object.entries(votes).filter(([, t]) => t === pid).map(([v]) => players[v]?.emoji || '❓'),
    }))
    .sort((a, b) => b.votes - a.votes)
  const isLast = room.qIndex + 1 >= room.totalQ

  const next = () => {
    if (isLast) {
      act({ phase: 'final' })
    } else {
      act({
        phase: 'write',
        qIndex: room.qIndex + 1,
        current: { answers: {}, votes: {}, revealOrder: [], reactions: {} },
      })
    }
  }

  return (
    <div className="screen screen-play">
      <RoundHeader room={room} />
      <h2 className="question question-small">{questionText(room)}</h2>
      <div className="reveal-list">
        {rows.map((r, i) => (
          <div key={r.pid} className={'reveal-card' + (i === 0 && r.votes > 0 ? ' reveal-top' : '')} style={{ animationDelay: `${i * 0.35}s` }}>
            <div className="reveal-text">“{r.text}”</div>
            <div className="reveal-meta">
              <span className="reveal-author">
                {players[r.pid]?.emoji} {players[r.pid]?.name}
                {r.pid === subj?.id && <span className="reveal-subject-tag">the subject!</span>}
              </span>
              <span className="reveal-votes">
                {r.voters.join(' ')} {r.votes > 0 ? `+${r.votes * 100}` : '·'}
              </span>
            </div>
            <ReactionBar
              pid={r.pid}
              reactions={reactions}
              open={pickerFor === r.pid}
              onToggle={() => setPickerFor(pickerFor === r.pid ? null : r.pid)}
              onReact={(e) => react(r.pid, e)}
            />
          </div>
        ))}
      </div>
      <div className="board-title">Scoreboard</div>
      <Leaderboard room={room} highlight={me.id} />
      {isHost ? (
        <button className="btn btn-primary btn-big" onClick={next}>
          {isLast ? 'Final Results 🏆' : 'Next Question →'}
        </button>
      ) : (
        <div className="waiting-pulse">Host controls the next round…</div>
      )}
    </div>
  )
}

function FinalScreen({ room, me, isHost, act, onLeave }) {
  const rows = ranked(room)
  const podium = rows.slice(0, 3)
  const playAgain = () => {
    const patch = {
      phase: 'lobby',
      qIndex: 0,
      totalQ: 0,
      order: [],
      questions: [],
      current: { answers: {}, votes: {}, revealOrder: [], reactions: {} },
    }
    for (const p of rows) patch['players.' + p.id + '.score'] = 0
    act(patch)
  }
  return (
    <div className="screen screen-final">
      <Confetti />
      <div className="final-title">🏆 THE WHOLE TRUTH 🏆</div>
      <div className="podium">
        {podium[1] && (
          <div className="podium-col podium-2">
            <div className="podium-emoji">{podium[1].emoji}</div>
            <div className="podium-name">{podium[1].name}</div>
            <div className="podium-block">2</div>
          </div>
        )}
        {podium[0] && (
          <div className="podium-col podium-1">
            <div className="podium-crown">👑</div>
            <div className="podium-emoji">{podium[0].emoji}</div>
            <div className="podium-name">{podium[0].name}</div>
            <div className="podium-block">1</div>
          </div>
        )}
        {podium[2] && (
          <div className="podium-col podium-3">
            <div className="podium-emoji">{podium[2].emoji}</div>
            <div className="podium-name">{podium[2].name}</div>
            <div className="podium-block">3</div>
          </div>
        )}
      </div>
      <div className="final-winner">
        {podium[0]?.name} is the best liar you know. Congratulations?
      </div>
      <Leaderboard room={room} highlight={me.id} />
      {isHost ? (
        <button className="btn btn-primary btn-big" onClick={playAgain}>
          Play Again 🔁
        </button>
      ) : (
        <div className="waiting-pulse">Waiting for the host…</div>
      )}
      <button className="btn-link" onClick={onLeave}>
        Leave party
      </button>
    </div>
  )
}

// ------------------------------------------------------------
// App
// ------------------------------------------------------------
function App() {
  const id = myId()
  const [view, setView] = useState('home') // home | create | join
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(idStorage().getItem(LS_SESSION)) || null
    } catch {
      return null
    }
  })
  const [room, setRoom] = useState(null)
  const [profile, setProfileState] = useState(() => {
    const defaults = { name: '', first: '', last: '', gender: '', emoji: EMOJIS[0] }
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(LS_PROFILE)) || {}) }
    } catch {
      return defaults
    }
  })
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const advanceKey = useRef('')

  const setProfile = (p) => {
    setProfileState(p)
    localStorage.setItem(LS_PROFILE, JSON.stringify(p))
  }

  useEffect(() => {
    toastFn = (msg) => {
      setToast(msg)
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 3200)
    }
    return () => {
      toastFn = null
    }
  }, [])

  // Subscribe to the current room
  useEffect(() => {
    if (!session?.code) {
      setRoom(null)
      return
    }
    let unsub = () => {}
    let cancelled = false
    getStore().then((store) => {
      if (cancelled) return
      unsub = store.watch(session.code, (r) => setRoom(r))
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [session?.code])

  const enterRoom = (code) => {
    const s = { code }
    idStorage().setItem(LS_SESSION, JSON.stringify(s))
    setSession(s)
    setView('home')
  }
  const leaveRoom = useCallback(async () => {
    const code = session?.code
    idStorage().removeItem(LS_SESSION)
    setSession(null)
    setRoom(null)
    if (code && room?.players?.[id] && room.phase === 'lobby' && room.hostId !== id) {
      try {
        const store = await getStore()
        await store.update(code, { ['players.' + id]: DELETE })
      } catch {}
    }
  }, [session?.code, room, id])

  // All mutations go through act(); host force-advance uses a pseudo key.
  const act = useCallback(
    async (patch) => {
      if (!session?.code) return
      try {
        const store = await getStore()
        if (patch.__host_force) {
          const target = patch.__host_force
          if (target === 'vote') {
            const pids = Object.keys(room?.current?.answers || {})
            await store.update(session.code, {
              phase: 'vote',
              'current.revealOrder': shuffle(pids),
            })
          } else if (target === 'reveal') {
            await store.update(session.code, buildScorePatch(room))
          }
          return
        }
        await store.update(session.code, patch)
      } catch (err) {
        console.error(err)
        notify('Could not sync — check your connection.')
      }
    },
    [session?.code, room]
  )

  // Host auto-advance
  useEffect(() => {
    if (!room || room.hostId !== id || !session?.code) return
    const key = room.phase + ':' + room.qIndex
    const players = Object.keys(room.players || {})
    const current = room.current || {}
    if (room.phase === 'write') {
      const done = Object.keys(current.answers || {})
      if (done.length >= players.length && done.length >= 2 && advanceKey.current !== 'w' + key) {
        advanceKey.current = 'w' + key
        act({ phase: 'vote', 'current.revealOrder': shuffle(done) })
      }
    } else if (room.phase === 'vote') {
      const answered = Object.keys(current.answers || {})
      const eligible = players.filter((p) => answered.some((a) => a !== p))
      const voted = Object.keys(current.votes || {})
      if (
        eligible.length > 0 &&
        voted.length >= eligible.length &&
        advanceKey.current !== 'v' + key
      ) {
        advanceKey.current = 'v' + key
        act(buildScorePatch(room))
      }
    }
  }, [room, id, session?.code, act])

  // Record finished games in this device's history
  useEffect(() => {
    if (room?.phase === 'final') saveGameToHistory(room)
  }, [room])

  // If the room vanished or ended underneath us
  useEffect(() => {
    if (session?.code && room && (room.phase === 'ended' || !room.players?.[id])) {
      if (room.phase === 'ended') notify('The host ended the party. 👋')
      idStorage().removeItem(LS_SESSION)
      setSession(null)
      setRoom(null)
    }
  }, [room, session?.code, id])

  const me = room?.players?.[id] ? { id, ...room.players[id] } : null
  const isHost = room?.hostId === id

  let screen
  if (room && me) {
    if (room.phase === 'lobby')
      screen = <LobbyScreen room={room} me={me} isHost={isHost} act={act} onLeave={leaveRoom} />
    else if (room.phase === 'write') screen = <WriteScreen room={room} me={me} isHost={isHost} act={act} />
    else if (room.phase === 'vote') screen = <VoteScreen room={room} me={me} isHost={isHost} act={act} />
    else if (room.phase === 'reveal') screen = <RevealScreen room={room} me={me} isHost={isHost} act={act} />
    else if (room.phase === 'final')
      screen = <FinalScreen room={room} me={me} isHost={isHost} act={act} onLeave={leaveRoom} />
  } else if (session?.code && room === null) {
    screen = (
      <div className="screen screen-home">
        <Logo small />
        <div className="waiting-pulse">Reconnecting…</div>
        <button className="btn-link" onClick={leaveRoom}>
          Never mind, take me home
        </button>
      </div>
    )
  } else if (view === 'create') {
    screen = (
      <CreateScreen profile={profile} setProfile={setProfile} onBack={() => setView('home')} onCreated={enterRoom} />
    )
  } else if (view === 'join') {
    screen = (
      <JoinScreen profile={profile} setProfile={setProfile} onBack={() => setView('home')} onJoined={enterRoom} />
    )
  } else {
    screen = <HomeScreen onCreate={() => setView('create')} onJoin={() => setView('join')} />
  }

  const freshVersion = useUpdateCheck()

  return (
    <div className="app">
      {freshVersion && (
        <div className="update-banner">
          <span>✨ New version ready (v{freshVersion})</span>
          <button onClick={hardRefresh}>Refresh</button>
        </div>
      )}
      {screen}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// Score patch: +100 per vote received, then reveal.
function buildScorePatch(room) {
  const counts = {}
  for (const target of Object.values(room?.current?.votes || {})) {
    counts[target] = (counts[target] || 0) + 1
  }
  const patch = { phase: 'reveal' }
  for (const [pid, n] of Object.entries(counts)) {
    const cur = room.players[pid]?.score || 0
    patch['players.' + pid + '.score'] = cur + n * 100
  }
  return patch
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(<App />)
