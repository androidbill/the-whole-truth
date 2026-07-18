// ============================================================
//  THE WHOLE TRUTH — a party game of beautiful lies
//  Everyone answers a question about one player. Everyone votes
//  for their favorite answer. Best liar wins.
// ============================================================
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { buildDeck } from './questions.js'
import './styles.css'

export const APP_VERSION = '2026.07.18.03'
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

// Write-phase countdown (seconds). Players who haven't submitted when it
// expires get skipped. Host can toggle it any time.
const WRITE_SECONDS = 135
// Vote-phase countdown — voting is quicker than writing.
const VOTE_SECONDS = 90

// ------------------------------------------------------------
// Sounds & haptics (synthesized — no audio assets, works offline)
// ------------------------------------------------------------
const LS_SOUND = 'twt-sound'
let soundOn = localStorage.getItem(LS_SOUND) !== 'off'
function isSoundOn() {
  return soundOn
}
function setSoundOn(on) {
  soundOn = on
  localStorage.setItem(LS_SOUND, on ? 'on' : 'off')
}
let actx = null
function audioCtx() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)()
    } catch {}
  }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {})
  return actx
}
// iOS only allows audio after a user gesture — prime the context on first tap.
window.addEventListener('pointerdown', () => audioCtx(), { once: true })

function tone(freq, dur = 0.08, type = 'triangle', vol = 0.05, delay = 0) {
  const ctx = audioCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(vol, ctx.currentTime + delay)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime + delay)
  osc.stop(ctx.currentTime + delay + dur + 0.02)
}
function vibrate(pattern) {
  if (soundOn && navigator.vibrate) {
    try {
      navigator.vibrate(pattern)
    } catch {}
  }
}
function sfx(name) {
  if (!soundOn) return
  if (name === 'tick') tone(900, 0.04, 'square', 0.03)
  else if (name === 'pop') {
    tone(440, 0.06, 'sine', 0.06)
    tone(660, 0.08, 'sine', 0.05, 0.05)
  } else if (name === 'phase') {
    tone(523, 0.09)
    tone(659, 0.09, 'triangle', 0.05, 0.09)
    tone(784, 0.12, 'triangle', 0.05, 0.18)
  } else if (name === 'reveal') {
    tone(392, 0.1)
    tone(494, 0.1, 'triangle', 0.05, 0.1)
    tone(587, 0.16, 'triangle', 0.06, 0.2)
  } else if (name === 'fanfare') {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, i * 0.12))
    vibrate([60, 40, 60, 40, 140])
  } else if (name === 'boom') {
    tone(140, 0.35, 'sine', 0.14)
    tone(70, 0.5, 'sine', 0.14, 0.06)
    vibrate([90])
  }
}

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
// Scan-to-join deep link: ...?join=CODE opens the join screen prefilled.
const JOIN_CODE = (new URLSearchParams(location.search).get('join') || '')
  .toUpperCase()
  .replace(/[^A-Z]/g, '')
  .slice(0, 4)
function stripJoinParam() {
  try {
    const u = new URL(location.href)
    if (!u.searchParams.has('join')) return
    u.searchParams.delete('join')
    history.replaceState(null, '', u.toString())
  } catch {}
}
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
          const refetch = () => {
            getDoc(ref(code))
              .then((snap) => cb(snap.exists() ? snap.data() : null))
              .catch(() => {})
          }
          const onVis = () => {
            if (document.visibilityState === 'visible') refetch()
          }
          document.addEventListener('visibilitychange', onVis)
          // Watchdog: iOS can silently stall the long-poll stream (Low Power
          // Mode, radio handoff) and reconnect backoff takes seconds. Poll
          // while visible so nobody is ever more than ~5s behind.
          const iv = setInterval(() => {
            if (document.visibilityState === 'visible') refetch()
          }, 5000)
          return () => {
            unsub()
            document.removeEventListener('visibilitychange', onVis)
            clearInterval(iv)
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
  { id: 'mixed', emoji: '🎭', name: 'Mixed', blurb: 'Party + Spicy, shaken' },
  { id: 'clean', emoji: '🧼', name: 'Clean', blurb: 'Family-safe · all ages' },
]

// Party themes: the host picks one at creation and every player's app
// re-skins to match (data-theme attribute drives the CSS variables).
const THEMES = [
  { id: 'violet', name: 'Neon Nights', swatch: 'linear-gradient(135deg, #a21caf, #7c3aed, #db2777)' },
  { id: 'crimson', name: 'Crimson Pulse', swatch: 'linear-gradient(135deg, #991b1b, #dc2626, #f43f5e)' },
  { id: 'gold', name: 'Gold Rush', swatch: 'linear-gradient(135deg, #b45309, #f59e0b, #fbbf24)' },
  { id: 'teal', name: 'Tidal Wave', swatch: 'linear-gradient(135deg, #0f766e, #14b8a6, #22d3ee)' },
  { id: 'emerald', name: 'Emerald Haze', swatch: 'linear-gradient(135deg, #166534, #22c55e, #86efac)' },
  { id: 'sunset', name: 'Sunset Blaze', swatch: 'linear-gradient(135deg, #9a3412, #ea580c, #fbbf24)' },
  { id: 'ice', name: 'Arctic Chill', swatch: 'linear-gradient(135deg, #1d4ed8, #38bdf8, #a5f3fc)' },
  { id: 'bubblegum', name: 'Bubblegum Pop', swatch: 'linear-gradient(135deg, #be185d, #ec4899, #f9a8d4)' },
  { id: 'lime', name: 'Toxic Lime', swatch: 'linear-gradient(135deg, #4d7c0f, #84cc16, #d9f99d)' },
  { id: 'sapphire', name: 'Midnight Sapphire', swatch: 'linear-gradient(135deg, #1e40af, #3b82f6, #93c5fd)' },
]

function applyTheme(id) {
  document.documentElement.dataset.theme = id && id !== 'violet' ? id : ''
}

// Shared round countdown. Returns remaining ms (null if timer off) and
// plays a tick each of the last 10 seconds.
function useCountdown(enabled, started, seconds) {
  const [now, setNow] = useState(Date.now)
  const lastTick = useRef(null)
  useEffect(() => {
    if (!enabled || !started) return
    const iv = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(iv)
  }, [enabled, started])
  const remaining = enabled && started ? Math.max(0, seconds * 1000 - (now - started)) : null
  useEffect(() => {
    if (remaining === null || remaining > 10000 || remaining <= 0) return
    const s = Math.ceil(remaining / 1000)
    if (lastTick.current !== s) {
      lastTick.current = s
      sfx('tick')
      vibrate(25)
    }
  }, [remaining])
  return remaining
}

function TimerPill({ remaining }) {
  if (remaining === null) return null
  const secs = Math.ceil(remaining / 1000)
  const clock = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0')
  return <div className={'timer-pill' + (remaining <= 15000 ? ' timer-low' : '')}>⏱ {clock}</div>
}

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
// Question tracking: the host's device remembers every question it has
// dealt (across games) and won't repeat one until the deck is exhausted.
// ------------------------------------------------------------
const LS_USED_Q = 'twt-used-questions'
function loadUsedQuestions() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_USED_Q)) || [])
  } catch {
    return new Set()
  }
}
function drawQuestions(deckId, count) {
  const all = buildDeck(deckId)
  const used = loadUsedQuestions()
  let fresh = shuffle(all.filter((q) => !used.has(q)))
  const picked = []
  while (picked.length < count) {
    if (fresh.length === 0) {
      // Deck exhausted: reset tracking for this deck's questions and keep
      // dealing, but never repeat a question within the same game.
      for (const q of all) used.delete(q)
      fresh = shuffle(all.filter((q) => !picked.includes(q)))
      if (fresh.length === 0) fresh = shuffle(all)
    }
    picked.push(fresh.pop())
  }
  for (const q of picked) used.add(q)
  try {
    localStorage.setItem(LS_USED_Q, JSON.stringify([...used]))
  } catch {}
  return picked
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
    list.unshift({
      at: Date.now(),
      code: room.code,
      deck: room.deck,
      mode: room.mode || 'lies',
      players,
      bestLie: room.bestLie || null,
      bestReacted: room.bestReacted || null,
    })
    localStorage.setItem(LS_HISTORY, JSON.stringify(list.slice(0, 50)))
  } catch {}
}

// ------------------------------------------------------------
// Shareable results card (canvas → native share sheet / download)
// ------------------------------------------------------------
function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(' ')
  let line = ''
  for (const w of words) {
    const tryLine = line ? line + ' ' + w : w
    if (ctx.measureText(tryLine).width > maxW && line) {
      ctx.fillText(line, x, y)
      y += lineH
      line = w
    } else {
      line = tryLine
    }
  }
  if (line) ctx.fillText(line, x, y)
  return y + lineH
}

async function shareResults(room) {
  try {
    const rows = ranked(room)
    const W = 1080
    const H = 1350
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const css = getComputedStyle(document.documentElement)
    const bg = css.getPropertyValue('--bg-0').trim() || '#150a26'
    const hot = css.getPropertyValue('--hot').trim() || '#f472b6'
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W * 0.8, 0, 50, W * 0.8, 0, 900)
    glow.addColorStop(0, 'rgba(255,255,255,0.10)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(245,239,255,0.6)'
    ctx.font = '300 44px system-ui, sans-serif'
    ctx.fillText('T H E', W / 2, 130)
    ctx.fillStyle = hot
    ctx.font = '900 128px system-ui, sans-serif'
    ctx.fillText('WHOLE', W / 2, 250)
    ctx.fillStyle = '#f5efff'
    ctx.fillText('TRUTH', W / 2, 375)
    const win = rows[0]
    ctx.font = '110px system-ui, sans-serif'
    ctx.fillText(win?.emoji || '👑', W / 2, 530)
    ctx.fillStyle = '#facc15'
    ctx.font = '900 66px system-ui, sans-serif'
    ctx.fillText('👑 ' + (win?.name || '?') + ' wins!', W / 2, 630)
    let y = 740
    ctx.font = '600 46px system-ui, sans-serif'
    rows.slice(0, 5).forEach((p, i) => {
      ctx.fillStyle = i === 0 ? '#facc15' : 'rgba(245,239,255,0.85)'
      ctx.fillText(`${i + 1}.  ${p.emoji} ${p.name} — ${p.score || 0}`, W / 2, y)
      y += 66
    })
    if (room.bestLie) {
      y += 50
      ctx.fillStyle = hot
      ctx.font = '700 42px system-ui, sans-serif'
      ctx.fillText('🏆 Lie of the game', W / 2, y)
      y += 60
      ctx.fillStyle = 'rgba(245,239,255,0.9)'
      ctx.font = 'italic 44px system-ui, sans-serif'
      y = wrapText(ctx, '“' + room.bestLie.text + '” — ' + room.bestLie.by, W / 2, y, 900, 58)
    }
    ctx.fillStyle = 'rgba(245,239,255,0.5)'
    ctx.font = '500 36px system-ui, sans-serif'
    ctx.fillText(appUrl().replace(/^https?:\/\//, ''), W / 2, H - 56)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    const file = new File([blob], 'the-whole-truth-results.png', { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'The Whole Truth' })
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = file.name
      a.click()
    }
  } catch {
    // user closed the share sheet — not an error
  }
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

function PlayerChip({ p, done, dim, host, onKick }) {
  return (
    <div className={'chip' + (done ? ' chip-done' : '') + (dim ? ' chip-dim' : '')}>
      <span className="chip-emoji">{p.emoji}</span>
      <span className="chip-name">{p.name}</span>
      {host && <span className="chip-host">HOST</span>}
      {done && <span className="chip-check">✓</span>}
      {onKick && (
        <button className="chip-kick" aria-label={'Remove ' + p.name} onClick={onKick}>
          ✕
        </button>
      )}
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
                  {g.bestLie && (
                    <div className="history-quote">
                      🏆 “{g.bestLie.text}” — {g.bestLie.by} ({g.bestLie.votes} vote
                      {g.bestLie.votes === 1 ? '' : 's'})
                    </div>
                  )}
                  {g.bestReacted && (
                    <div className="history-quote">
                      {g.bestReacted.emoji} “{g.bestReacted.text}” — {g.bestReacted.by}
                    </div>
                  )}
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

function QrModal({ onClose, url: urlProp, title = 'Scan to open the app' }) {
  const canvasRef = useRef(null)
  const url = urlProp || appUrl()
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
        <div className="about-name">{title}</div>
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
  const [sound, setSound] = useState(isSoundOn)
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
                  setSoundOn(!sound)
                  setSound(!sound)
                }}
              >
                {sound ? '🔊 Sound: On' : '🔇 Sound: Off'}
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
    seen: Date.now(),
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
  const [theme, setTheme] = useState('violet')
  const [mode, setMode] = useState('lies')
  const [busy, setBusy] = useState(false)

  // Live preview while picking; App re-applies the room's theme after create.
  useEffect(() => {
    applyTheme(theme)
    return () => applyTheme('')
  }, [theme])

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
        theme,
        mode,
        timerOn: true,
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
      <label className="field-label">Game mode</label>
      <div className="seg seg-mode">
        <button
          className={'seg-btn' + (mode === 'lies' ? ' seg-sel' : '')}
          onClick={() => setMode('lies')}
        >
          🃏 Best Lie Wins
        </button>
        <button
          className={'seg-btn' + (mode === 'truth' ? ' seg-sel' : '')}
          onClick={() => setMode('truth')}
        >
          🕵️ Find the Truth
        </button>
      </div>
      <div className="mode-blurb">
        {mode === 'lies'
          ? 'Everyone answers, everyone votes for their favorite. Best liar wins.'
          : 'The subject answers truthfully, everyone else fakes it. Spot the truth to score — or fool them with your lie.'}
      </div>
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
      <label className="field-label">Party theme</label>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={'theme-card' + (theme === t.id ? ' theme-sel' : '')}
            onClick={() => setTheme(t.id)}
          >
            <span className="theme-swatch" style={{ background: t.swatch }} />
            <span className="theme-name">{t.name}</span>
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

function CustomQModal({ room, act, onClose }) {
  const [items, setItems] = useState(() => {
    const existing = room.customQ || []
    return existing.length ? existing : ['']
  })
  const setItem = (i, v) => setItems(items.map((q, j) => (j === i ? v : q)))
  const removeItem = (i) => setItems(items.filter((_, j) => j !== i).concat(items.length === 1 ? [''] : []))
  const save = () => {
    const list = items.map((s) => s.trim()).filter(Boolean).slice(0, 5)
    act({ customQ: list })
    onClose()
    notify(
      list.length
        ? `${list.length} custom question${list.length > 1 ? 's' : ''} in the mix! ✍️`
        : 'Custom questions cleared'
    )
  }
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card customq-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-name">✍️ Your own questions</div>
        <div className="customq-hint">
          Up to 5, shuffled into the deck. Write {'{P}'} where the player's name should appear —
          e.g. "What {'{P}'} really did at Ryan's birthday"
        </div>
        {items.map((q, i) => (
          <div key={i} className="customq-row">
            <input
              className="input customq-field"
              maxLength={120}
              placeholder={i === 0 ? 'What {P} really did at the lake house' : 'Another question…'}
              value={q}
              onChange={(e) => setItem(i, e.target.value)}
            />
            <button className="customq-remove" aria-label="Remove question" onClick={() => removeItem(i)}>
              ✕
            </button>
          </div>
        ))}
        {items.length < 5 && (
          <button className="btn-link" onClick={() => setItems([...items, ''])}>
            ＋ Add another
          </button>
        )}
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
        <button className="btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function LobbyScreen({ room, me, isHost, act, onLeave }) {
  const players = playerList(room)
  const canStart = players.length >= 3
  const deck = DECKS.find((d) => d.id === room.deck) || DECKS[2]
  const [joinQr, setJoinQr] = useState(false)
  const [customQ, setCustomQ] = useState(false)
  const joinUrl = appUrl() + '?join=' + room.code

  const start = () => {
    const ids = shuffle(players.map((p) => p.id))
    const totalQ = ids.length * (room.cycles || 1)
    // Host's custom questions join the deal, then everything is shuffled.
    const custom = shuffle((room.customQ || []).filter(Boolean)).slice(0, totalQ)
    const drawn = drawQuestions(room.deck, totalQ - custom.length)
    const patch = {
      phase: 'write',
      order: ids,
      questions: shuffle([...custom, ...drawn]),
      qIndex: 0,
      totalQ,
      bestLie: DELETE,
      bestReacted: DELETE,
      stats: DELETE,
      current: { answers: {}, votes: {}, revealOrder: [], reactions: {}, writeStarted: Date.now() },
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
        {ONLINE_MODE && (
          <button className="btn-link" onClick={() => setJoinQr(true)}>
            📱 Show QR to join
          </button>
        )}
      </div>
      {joinQr && (
        <QrModal url={joinUrl} title="Scan to join this party" onClose={() => setJoinQr(false)} />
      )}
      <div className="lobby-deck">
        {deck.emoji} {deck.name} deck · {room.cycles} question{room.cycles > 1 ? 's' : ''} per player
      </div>
      <div className="chips chips-lobby">
        {players.map((p) => (
          <PlayerChip
            key={p.id}
            p={p}
            host={p.id === room.hostId}
            onKick={
              isHost && p.id !== room.hostId
                ? () => {
                    if (confirm('Remove ' + p.name + ' from the party?'))
                      act({ ['players.' + p.id]: DELETE })
                  }
                : undefined
            }
          />
        ))}
      </div>
      {isHost ? (
        <>
          <button className="btn btn-primary btn-big" disabled={!canStart} onClick={start}>
            {canStart ? `Start with ${players.length} players 🎬` : 'Need at least 3 players…'}
          </button>
          <button className="btn-link" onClick={() => act({ timerOn: !room.timerOn })}>
            ⏱ Answer timer: {room.timerOn ? 'ON (2:15)' : 'OFF'}
          </button>
          <button className="btn-link" onClick={() => setCustomQ(true)}>
            ✍️ Custom questions{room.customQ?.length ? ` (${room.customQ.length})` : ''}
          </button>
          {customQ && <CustomQModal room={room} act={act} onClose={() => setCustomQ(false)} />}
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

// Host-only: restart (back to lobby, scores reset) or end the party,
// available on every in-game screen. Both confirm first.
function HostControls({ room, act }) {
  const restart = () => {
    if (!confirm('Restart the game? Everyone goes back to the lobby and scores reset.')) return
    const patch = {
      phase: 'lobby',
      qIndex: 0,
      totalQ: 0,
      order: [],
      questions: [],
      bestLie: DELETE,
      bestReacted: DELETE,
      stats: DELETE,
      current: { answers: {}, votes: {}, revealOrder: [], reactions: {} },
    }
    for (const id of Object.keys(room.players || {})) patch['players.' + id + '.score'] = 0
    act(patch)
  }
  const end = () => {
    if (!confirm('End the party for everyone?')) return
    act({ phase: 'ended' })
  }
  return (
    <div className="host-controls">
      <button className="btn-link" onClick={restart}>
        🔁 Restart game
      </button>
      <button className="btn-link" onClick={end}>
        🛑 End party
      </button>
    </div>
  )
}

function WriteScreen({ room, me, isHost, act }) {
  const subj = subjectOf(room)
  const isSubject = subj?.id === me.id
  const answers = room.current?.answers || {}
  const mine = answers[me.id]
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const doneIds = Object.keys(answers)

  const truthMode = room.mode === 'truth'
  const timerOn = !!room.timerOn
  const remaining = useCountdown(timerOn, room.current?.writeStarted || 0, WRITE_SECONDS)

  // Host device enforces the deadline: advance with whoever submitted.
  const expiredFired = useRef(false)
  useEffect(() => {
    if (!isHost || remaining === null || remaining > 0 || expiredFired.current) return
    expiredFired.current = true
    act({ __host_force: doneIds.length >= 1 ? 'vote' : 'reveal' })
  }, [isHost, remaining, doneIds.length, act])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    act({ ['current.answers.' + me.id]: t })
    setEditing(false)
    sfx('pop')
    vibrate(20)
  }

  return (
    <div className="screen screen-play">
      <RoundHeader room={room} />
      <TimerPill remaining={remaining} />
      <div className="subject-banner">
        <span className="subject-emoji">{subj?.emoji}</span>
        {truthMode && isSubject ? (
          <>
            They're all lying about <b>YOU</b> — tell the truth!
          </>
        ) : (
          <>
            This one's about <b>{isSubject ? 'YOU' : subj?.first || subj?.name}</b>
            {truthMode && ' — make your lie believable'}
          </>
        )}
      </div>
      <h2 className="question">{questionText(room)}</h2>
      {!mine || editing ? (
        <>
          <textarea
            className="answer-input"
            maxLength={120}
            rows={3}
            placeholder={
              truthMode
                ? isSubject
                  ? 'Tell the whole truth…'
                  : "Write a lie they'll swallow whole"
                : isSubject
                  ? 'Defend yourself… or lean into it'
                  : 'Make it juicy. Make it believable.'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="char-count">{text.length}/120</div>
          <button className="btn btn-primary btn-big" disabled={!text.trim()} onClick={submit}>
            {mine ? 'Update Now ✏️' : 'Lock It In 🔒'}
          </button>
        </>
      ) : (
        <>
          <button
            className="my-answer my-answer-tap"
            onClick={() => {
              setText(mine)
              setEditing(true)
            }}
          >
            <div className="my-answer-label">Your answer · ✏️ tap to edit</div>
            “{mine}”
          </button>
          <WaitBoard room={room} doneIds={doneIds} label="Waiting on the slow typers…" />
        </>
      )}
      {isHost && doneIds.length >= 2 && doneIds.length < playerList(room).length && (
        <button className="btn-link" onClick={() => act({ __host_force: 'vote' })}>
          Host: skip the stragglers →
        </button>
      )}
      {isHost && (
        <button
          className="btn-link"
          onClick={() =>
            act(
              timerOn
                ? { timerOn: false }
                : { timerOn: true, 'current.writeStarted': Date.now() }
            )
          }
        >
          ⏱ {timerOn ? 'Disable answer timer' : 'Enable answer timer'}
        </button>
      )}
      {isHost && <HostControls room={room} act={act} />}
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
  const truthMode = room.mode === 'truth'
  const iAmSubject = subj?.id === me.id
  const blocked = truthMode && iAmSubject
  const voteFor = (pid) => {
    if (pid === me.id || blocked) return
    act({ ['current.votes.' + me.id]: pid })
    sfx('pop')
    vibrate(20)
  }
  const canVote = !blocked && order.some((pid) => pid !== me.id)

  const timerOn = !!room.timerOn
  const remaining = useCountdown(timerOn, room.current?.voteStarted || 0, VOTE_SECONDS)
  const expiredFired = useRef(false)
  useEffect(() => {
    if (!isHost || remaining === null || remaining > 0 || expiredFired.current) return
    expiredFired.current = true
    act({ __host_force: 'reveal' })
  }, [isHost, remaining, act])

  return (
    <div className="screen screen-play">
      <RoundHeader room={room} />
      <TimerPill remaining={remaining} />
      <h2 className="question question-small">{questionText(room)}</h2>
      <div className="vote-hint">
        {blocked
          ? "They're hunting your truth — sit tight and watch them squirm!"
          : myVote
            ? 'Locked in! You can still change your mind…'
            : truthMode
              ? 'Which answer is the TRUTH?'
              : 'Vote for your favorite answer'}
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
            disabled={pid === me.id || blocked}
            onClick={() => voteFor(pid)}
          >
            <span className="vote-letter">{String.fromCharCode(65 + i)}</span>
            <span className="vote-text">{answers[pid]}</span>
            {pid === me.id && <span className="vote-yours">your lie</span>}
            {myVote === pid && <span className="vote-check">✓</span>}
          </button>
        ))}
      </div>
      {!canVote && !blocked && <div className="vote-hint">No one else answered — hang tight!</div>}
      {myVote && <WaitBoard room={room} doneIds={doneIds} label="Waiting for the undecided…" />}
      {isHost && doneIds.length >= 1 && doneIds.length < playerList(room).length && (
        <button className="btn-link" onClick={() => act({ __host_force: 'reveal' })}>
          Host: close the polls →
        </button>
      )}
      {isHost && <HostControls room={room} act={act} />}
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

  // Floating emoji burst whenever a reaction lands (TikTok-live style).
  const [bursts, setBursts] = useState([])
  const prevGrouped = useRef({})
  useEffect(() => {
    const added = []
    for (const [e, n] of Object.entries(grouped)) {
      const before = prevGrouped.current[e] || 0
      for (let i = before; i < n; i++) added.push(e)
    }
    prevGrouped.current = grouped
    if (!added.length) return
    const items = added.map((e) => ({
      id: Math.random().toString(36).slice(2),
      emoji: e,
      x: 10 + Math.random() * 80,
    }))
    setBursts((b) => [...b.slice(-8), ...items])
    const t = setTimeout(
      () => setBursts((b) => b.filter((x) => !items.some((i2) => i2.id === x.id))),
      1400
    )
    return () => clearTimeout(t)
  }, [JSON.stringify(grouped)])

  return (
    <div className="reaction-wrap">
      {bursts.map((b) => (
        <span key={b.id} className="burst" style={{ left: b.x + '%' }}>
          {b.emoji}
        </span>
      ))}
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
    sfx('pop')
    vibrate(20)
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
  const truthMode = room.mode === 'truth'

  // Dramatic reveal: cards flip lowest-votes-first as the host taps.
  // Legacy rooms without the counter show everything.
  const revealedRaw = room.current?.revealed
  const revealed = revealedRaw === undefined ? rows.length : Math.min(revealedRaw, rows.length)
  const allRevealed = revealed >= rows.length
  const prevRevealed = useRef(revealed)
  useEffect(() => {
    if (revealed > prevRevealed.current) {
      if (revealed >= rows.length && rows.length > 0) sfx('boom')
      else sfx('reveal')
    }
    prevRevealed.current = revealed
  }, [revealed, rows.length])

  const next = () => {
    // Hall of fame: carry forward the game's best-voted answer and the
    // answer that collected the most reactions.
    const patch = {}
    // Superlatives: reactions received count toward Chaos Agent.
    for (const [pid, byPlayer] of Object.entries(reactions)) {
      const n = Object.keys(byPlayer || {}).length
      if (n > 0) patch['stats.' + pid + '.reactionsGot'] = (room.stats?.[pid]?.reactionsGot || 0) + n
    }
    const top = rows[0]
    if (top && top.votes > (room.bestLie?.votes || 0)) {
      patch.bestLie = { text: top.text, by: players[top.pid]?.name || '?', votes: top.votes }
    }
    let bestPid = null
    let bestCount = 0
    for (const [pid, byPlayer] of Object.entries(reactions)) {
      const n = Object.keys(byPlayer || {}).length
      if (n > bestCount) {
        bestCount = n
        bestPid = pid
      }
    }
    if (bestPid && bestCount > (room.bestReacted?.count || 0)) {
      const emojiCounts = {}
      for (const e of Object.values(reactions[bestPid])) emojiCounts[e] = (emojiCounts[e] || 0) + 1
      const topEmoji = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '😂'
      patch.bestReacted = {
        text: answers[bestPid],
        by: players[bestPid]?.name || '?',
        count: bestCount,
        emoji: topEmoji,
      }
    }
    if (isLast) {
      act({ ...patch, phase: 'final' })
    } else {
      act({
        ...patch,
        phase: 'write',
        qIndex: room.qIndex + 1,
        current: { answers: {}, votes: {}, revealOrder: [], reactions: {}, writeStarted: Date.now() },
      })
    }
  }

  return (
    <div className="screen screen-play">
      <RoundHeader room={room} />
      <h2 className="question question-small">{questionText(room)}</h2>
      <div className="reveal-list">
        {rows.map((r, i) => {
          // Cards flip from the bottom of the list (fewest votes) upward.
          const isVisible = i >= rows.length - revealed
          if (!isVisible)
            return (
              <div key={r.pid} className="reveal-card reveal-facedown">
                <div className="reveal-text">🤫 · · ·</div>
              </div>
            )
          return (
            <div key={r.pid} className={'reveal-card' + (i === 0 && r.votes > 0 ? ' reveal-top' : '')}>
              <div className="reveal-text">“{r.text}”</div>
              <div className="reveal-meta">
                <span className="reveal-author">
                  {players[r.pid]?.emoji} {players[r.pid]?.name}
                  {r.pid === subj?.id && (
                    <span className="reveal-subject-tag">
                      {truthMode ? 'THE TRUTH ✅' : 'the subject!'}
                    </span>
                  )}
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
          )
        })}
      </div>
      {allRevealed && (
        <>
          <div className="board-title">Scoreboard</div>
          <Leaderboard room={room} highlight={me.id} />
        </>
      )}
      {isHost ? (
        <>
          {!allRevealed ? (
            <>
              <button
                className="btn btn-primary btn-big"
                onClick={() => act({ 'current.revealed': revealed + 1 })}
              >
                🥁 Reveal next answer
              </button>
              <button className="btn-link" onClick={() => act({ 'current.revealed': rows.length })}>
                Show them all
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-big" onClick={next}>
              {isLast ? 'Final Results 🏆' : 'Next Question →'}
            </button>
          )}
          <HostControls room={room} act={act} />
        </>
      ) : (
        <div className="waiting-pulse">
          {allRevealed ? 'Host controls the next round…' : 'The host is revealing answers… 🥁'}
        </div>
      )}
    </div>
  )
}

function computeAwards(room) {
  const stats = room.stats || {}
  const topBy = (key) => {
    let best = null
    let bn = 0
    for (const [pid, s] of Object.entries(stats)) {
      const n = s?.[key] || 0
      if (n > bn) {
        bn = n
        best = pid
      }
    }
    return best ? { pid: best, n: bn } : null
  }
  const name = (pid) => {
    const p = room.players?.[pid]
    return p ? p.emoji + ' ' + p.name : '?'
  }
  const truth = room.mode === 'truth'
  const defs = [
    ['votesWon', '🎭 Smoothest Liar', (n) => `${n} vote${n === 1 ? '' : 's'} won`],
    ['reactionsGot', '🧲 Chaos Agent', (n) => `${n} reaction${n === 1 ? '' : 's'} collected`],
    ...(truth
      ? [
          ['sharp', '🕵️ Human Lie Detector', (n) => `found the truth ${n}×`],
          ['fooled', '🤡 Most Gullible', (n) => `fooled ${n} time${n === 1 ? '' : 's'}`],
        ]
      : []),
    ['skipped', '👻 The Ghost', (n) => `missed ${n} round${n === 1 ? '' : 's'}`],
  ]
  return defs
    .map(([key, title, label]) => {
      const t = topBy(key)
      return t ? { title, who: name(t.pid), label: label(t.n) } : null
    })
    .filter(Boolean)
}

function FinalScreen({ room, me, isHost, act, onLeave }) {
  const rows = ranked(room)
  const podium = rows.slice(0, 3)
  const awards = computeAwards(room)
  const playAgain = () => {
    const patch = {
      phase: 'lobby',
      qIndex: 0,
      totalQ: 0,
      order: [],
      questions: [],
      bestLie: DELETE,
      bestReacted: DELETE,
      stats: DELETE,
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
      {awards.length > 0 && (
        <div className="awards">
          {awards.map((a, i) => (
            <div key={i} className="award-row" style={{ animationDelay: `${0.6 + i * 0.25}s` }}>
              <span className="award-title">{a.title}</span>
              <span className="award-who">{a.who}</span>
              <span className="award-label">{a.label}</span>
            </div>
          ))}
        </div>
      )}
      <Leaderboard room={room} highlight={me.id} />
      <button className="btn btn-ghost" onClick={() => shareResults(room)}>
        📸 Share results
      </button>
      {isHost ? (
        <>
          <button className="btn btn-primary btn-big" onClick={playAgain}>
            Play Again 🔁
          </button>
          <button
            className="btn-link"
            onClick={() => {
              if (confirm('End the party for everyone?')) act({ phase: 'ended' })
            }}
          >
            🛑 End party
          </button>
        </>
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
  // Arriving via a scanned join link goes straight to the join screen.
  const [view, setView] = useState(JOIN_CODE ? 'join' : 'home') // home | create | join
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
    stripJoinParam()
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
              'current.voteStarted': Date.now(),
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
        act({ phase: 'vote', 'current.revealOrder': shuffle(done), 'current.voteStarted': Date.now() })
      }
    } else if (room.phase === 'vote') {
      const answered = Object.keys(current.answers || {})
      // In truth mode the subject knows the answer and doesn't vote.
      const subjId = room.order?.length ? room.order[room.qIndex % room.order.length] : null
      const eligible = players.filter(
        (p) => (room.mode !== 'truth' || p !== subjId) && answered.some((a) => a !== p)
      )
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

  // Everyone's app re-skins to the room's party theme
  useEffect(() => {
    applyTheme(room?.theme)
  }, [room?.theme])

  // Presence heartbeat: stamp players.<id>.seen every 30s while visible.
  // Uses a ref for act so the interval isn't reset by every snapshot.
  const actRef = useRef(null)
  actRef.current = act
  const inRoom = !!(session?.code && room?.players?.[id])
  useEffect(() => {
    if (!inRoom) return
    const beat = () => {
      if (document.visibilityState === 'visible')
        actRef.current?.({ ['players.' + id + '.seen']: Date.now() })
    }
    beat()
    const iv = setInterval(beat, 30000)
    return () => clearInterval(iv)
  }, [inRoom, id])

  // Host migration: if the host hasn't been seen for 90s (dead phone,
  // closed app), the earliest-joined active player claims the crown.
  useEffect(() => {
    if (!room || !session?.code || !room.players?.[id] || room.hostId === id) return
    const host = room.players[room.hostId]
    const hostGone = !host || (host.seen && Date.now() - host.seen > 90000)
    if (!hostGone) return
    const candidates = playerList(room).filter(
      (p) => p.id !== room.hostId && (p.id === id || (p.seen && Date.now() - p.seen < 60000))
    )
    if (candidates[0]?.id === id) {
      act({ hostId: id })
      notify('The host went missing — you are the new host! 👑')
    }
  }, [room, session?.code, id, act])

  // Phase-change chimes
  const prevPhase = useRef(null)
  useEffect(() => {
    const ph = room?.phase
    if (prevPhase.current && ph && prevPhase.current !== ph && room?.players?.[id]) {
      if (ph === 'vote' || ph === 'write') sfx('phase')
      else if (ph === 'reveal') sfx('reveal')
      else if (ph === 'final') sfx('fanfare')
    }
    prevPhase.current = ph
  }, [room?.phase, room, id])

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
      <JoinScreen
        profile={profile}
        setProfile={setProfile}
        onBack={() => setView('home')}
        onJoined={enterRoom}
        prefillCode={JOIN_CODE}
      />
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

// Score patch, then reveal.
// Classic mode: +100 to the author per vote their answer received.
// Truth mode: +100 to voters who found the truth; +100 to a liar per
// voter their lie fooled.
function buildScorePatch(room) {
  const votes = room?.current?.votes || {}
  const answers = room?.current?.answers || {}
  const truth = room?.mode === 'truth'
  const subjId = room?.order?.length ? room.order[room.qIndex % room.order.length] : null
  const gains = {}
  // Per-player running stats feed the end-of-game superlatives.
  const bump = {}
  const stat = (pid, key) => {
    bump[pid] = bump[pid] || {}
    bump[pid][key] = (bump[pid][key] || 0) + 1
  }
  for (const [voter, target] of Object.entries(votes)) {
    if (truth && target === subjId) {
      gains[voter] = (gains[voter] || 0) + 1
      stat(voter, 'sharp')
    } else {
      gains[target] = (gains[target] || 0) + 1
      stat(target, 'votesWon')
      if (truth) stat(voter, 'fooled')
    }
  }
  for (const pid of Object.keys(room?.players || {})) {
    if (!answers[pid]) stat(pid, 'skipped')
  }
  const patch = { phase: 'reveal', 'current.revealed': 0 }
  for (const [pid, n] of Object.entries(gains)) {
    const cur = room.players[pid]?.score || 0
    patch['players.' + pid + '.score'] = cur + n * 100
  }
  for (const [pid, keys] of Object.entries(bump)) {
    for (const [key, n] of Object.entries(keys)) {
      patch['stats.' + pid + '.' + key] = (room.stats?.[pid]?.[key] || 0) + n
    }
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
