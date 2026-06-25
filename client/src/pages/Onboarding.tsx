import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { readLS } from '../lib/storage'
import {
  Zap, User, Mail, Calendar, Scale, Ruler,
  Flame, Dumbbell, Activity, Target,
  ArrowLeft, ChevronRight, FileText, Search, RotateCcw,
} from 'lucide-react'

const GOALS = [
  { value: 'weight_loss', label: 'Weight Loss',    desc: 'Burn fat, look lean',      Icon: Flame    },
  { value: 'muscle_gain', label: 'Muscle Gain',    desc: 'Build size & strength',    Icon: Dumbbell },
  { value: 'endurance',   label: 'Endurance',      desc: 'Run farther, last longer', Icon: Activity },
  { value: 'general',     label: 'General Fitness',desc: 'Stay healthy & active',    Icon: Target   },
]

const LEVELS = [
  { value: 'sedentary',   label: 'Sedentary',   desc: 'Desk job, no exercise' },
  { value: 'light',       label: 'Light',        desc: '1–3 workouts / week' },
  { value: 'moderate',    label: 'Moderate',     desc: '3–5 workouts / week' },
  { value: 'very_active', label: 'Very Active',  desc: '6–7 workouts / week' },
]

export default function Onboarding() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [form, setForm] = useState({
    name: '', email: '', age: '', weight_kg: '', height_cm: '',
    fitness_goal: 'weight_loss', activity_level: 'moderate', medical_notes: '',
  })

  const [findEmail, setFindEmail]     = useState('')
  const [findLoading, setFindLoading] = useState(false)
  const [findError, setFindError]     = useState('')
  const [foundUser, setFoundUser]     = useState<any>(null)
  const [foundSession, setFoundSession] = useState<any>(null)
  const [showFind, setShowFind]       = useState(false)

  const isNewMode = new URLSearchParams(window.location.search).get('new') === '1'

  const activeUser    = readLS<any>('fitmind_user', null)
  const activeSession = readLS<any>('fitmind_session', null)
  const storedProfiles = readLS<Array<{ user: any; session: any }>>('fitmind_profiles', [])
  const savedProfiles = (() => {
    if (!activeUser?.id) return storedProfiles
    const alreadyIn = storedProfiles.some(p => p.user.id === activeUser.id)
    return alreadyIn
      ? storedProfiles
      : [{ user: activeUser, session: activeSession }, ...storedProfiles]
  })()

  useEffect(() => {
    if (!isNewMode && activeUser) navigate('/chat', { replace: true })
  }, [navigate, isNewMode, activeUser])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const fetchWithTimeout = async (url: string, opts?: RequestInit, ms = 10000) => {
    const ctrl = new AbortController()
    const id = setTimeout(() => ctrl.abort(), ms)
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal })
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.')
      throw err
    } finally {
      clearTimeout(id)
    }
  }

  const findProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setFindError('')
    setFoundUser(null)
    setFindLoading(true)
    try {
      const val = findEmail.trim()
      const isEmail = val.includes('@')
      const param = isEmail ? `email=${encodeURIComponent(val)}` : `name=${encodeURIComponent(val)}`
      const res = await fetchWithTimeout(`/users?${param}`)
      if (!res.ok) throw new Error(
        isEmail ? 'No profile found with that email.' : 'No profile found with that name.'
      )
      const data = await res.json() as any
      if (!data?.user) throw new Error('Invalid response from server')
      setFoundUser(data.user)
      setFoundSession(data.session ?? null)
    } catch (err: any) {
      setFindError(err.message ?? 'No profile found.')
    } finally {
      setFindLoading(false)
    }
  }

  const restoreFound = () => {
    if (!foundUser) return
    const profiles = readLS<Array<{ user: any; session: any }>>('fitmind_profiles', [])
    const idx = profiles.findIndex(p => p?.user?.id === foundUser.id)
    const entry = { user: foundUser, session: foundSession }
    if (idx >= 0) profiles[idx] = entry
    else profiles.push(entry)
    localStorage.setItem('fitmind_profiles', JSON.stringify(profiles))
    localStorage.setItem('fitmind_user',    JSON.stringify(foundUser))
    localStorage.setItem('fitmind_session', JSON.stringify(foundSession))
    navigate('/chat')
  }

  const switchTo = (p: { user: any; session: any }) => {
    localStorage.setItem('fitmind_user',    JSON.stringify(p.user))
    localStorage.setItem('fitmind_session', JSON.stringify(p.session))
    navigate('/chat')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const userRes = await fetchWithTimeout('/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, age: +form.age, weight_kg: +form.weight_kg, height_cm: +form.height_cm }),
      })
      if (!userRes.ok) {
        const errData = await userRes.json().catch(() => ({})) as any
        throw new Error(errData?.error ?? 'Failed to create profile')
      }
      const userData = await userRes.json() as any
      if (!userData?.user?.id) throw new Error('Invalid user response from server')

      const sessionRes = await fetchWithTimeout('/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userData.user.id }),
      })
      if (!sessionRes.ok) {
        const errData = await sessionRes.json().catch(() => ({})) as any
        throw new Error(errData?.error ?? 'Failed to create session')
      }
      const { session } = await sessionRes.json() as any
      if (!session) throw new Error('Invalid session response from server')

      const profiles = readLS<Array<{ user: any; session: any }>>('fitmind_profiles', [])
      const idx = profiles.findIndex(p => p?.user?.id === userData.user.id)
      const entry = { user: userData.user, session }
      if (idx >= 0) profiles[idx] = entry
      else profiles.push(entry)
      localStorage.setItem('fitmind_profiles', JSON.stringify(profiles))
      localStorage.setItem('fitmind_user',    JSON.stringify(userData.user))
      localStorage.setItem('fitmind_session', JSON.stringify(session))
      navigate('/chat')
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ob-wrap">
      <div className="ob-card">

        {/* Back */}
        {isNewMode && activeUser && (
          <button className="ob-back-btn" onClick={() => navigate('/chat')} type="button">
            <ArrowLeft size={13} strokeWidth={2} />
            Back to {activeUser.name}'s chat
          </button>
        )}

        {/* Brand */}
        <div className="ob-brand">
          <div className="ob-brand-icon">
            <Zap size={20} strokeWidth={2.5} />
          </div>
          <div className="ob-brand-text">
            <h1>FitMind</h1>
            <p>AI-Powered Personal Fitness Coach</p>
          </div>
        </div>

        {/* Profile recovery */}
        <div className="ob-recover">
          <button
            className="ob-recover-toggle"
            type="button"
            onClick={() => { setShowFind(v => !v); setFoundUser(null); setFindError('') }}
          >
            <RotateCcw size={11} strokeWidth={2} />
            {showFind ? 'Cancel recovery' : 'Recover existing profile'}
          </button>

          {showFind && (
            <div className="ob-recover-panel">
              <p className="ob-recover-hint">
                Enter your email or full name to recover your profile.
              </p>
              <form className="ob-recover-form" onSubmit={findProfile}>
                <input
                  type="text"
                  placeholder="Email or full name..."
                  value={findEmail}
                  onChange={e => setFindEmail(e.target.value)}
                  required
                  className="ob-recover-input"
                />
                <button
                  type="submit"
                  className="ob-recover-btn"
                  disabled={findLoading}
                >
                  <Search size={12} strokeWidth={2.5} />
                  {findLoading ? 'Searching...' : 'Find'}
                </button>
              </form>

              {findError && <div className="ob-recover-err">{findError}</div>}

              {foundUser && (
                <div className="ob-found-card">
                  <div className="ob-found-info">
                    <div className="ob-found-name">{foundUser.name}</div>
                    <div className="ob-found-meta">
                      {(foundUser.fitness_goal ?? '').replace(/_/g, ' ')} · Age {foundUser.age} · {foundUser.weight_kg}kg
                    </div>
                  </div>
                  <button className="ob-found-restore" type="button" onClick={restoreFound}>
                    Restore &amp; Continue →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Existing profiles — shown whenever there are saved profiles */}
        {savedProfiles.length > 0 && (
          <div className="ob-profiles">
            <div className="ob-profiles-label">
              {isNewMode ? 'Switch to existing profile' : 'Your saved profiles'}
            </div>
            <div className="ob-profiles-list">
              {savedProfiles.map(p => {
                const av = (p.user.name ?? '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                const gl = (p.user.fitness_goal ?? '').replace(/_/g, ' ')
                return (
                  <button key={p.user.id} className="ob-profile-chip" onClick={() => switchTo(p)} type="button">
                    <div className="ob-pchip-avatar">{av}</div>
                    <div className="ob-pchip-info">
                      <div className="ob-pchip-name">{p.user.name}</div>
                      <div className="ob-pchip-meta">{gl || 'General Fitness'} · Age {p.user.age}</div>
                    </div>
                    <div className="ob-pchip-arrow"><ChevronRight size={14} strokeWidth={2} /></div>
                  </button>
                )
              })}
            </div>
            <div className="ob-profiles-divider">
              <span>or create a new profile below</span>
            </div>
          </div>
        )}

        <p className="ob-intro">
          Your coach learns your goals, tracks your progress, and adapts every plan to you — powered by three specialised AI agents working in parallel.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Personal */}
          <div className="ob-section-label">Personal Info</div>
          <div className="form-cols-2">
            <div className="fg">
              <label>
                <span className="lbl-icon"><User size={12} strokeWidth={2} /></span>
                Full Name
              </label>
              <input required placeholder="Alex Johnson" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="fg">
              <label>
                <span className="lbl-icon"><Mail size={12} strokeWidth={2} /></span>
                Email <span style={{ color: 'var(--t4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input type="email" placeholder="alex@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
          <div className="form-cols-3">
            <div className="fg">
              <label><span className="lbl-icon"><Calendar size={12} strokeWidth={2} /></span> Age</label>
              <input required type="number" min="13" max="99" placeholder="25" value={form.age} onChange={e => set('age', e.target.value)} />
            </div>
            <div className="fg">
              <label><span className="lbl-icon"><Scale size={12} strokeWidth={2} /></span> Weight (kg)</label>
              <input required type="number" min="30" max="300" placeholder="75" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} />
            </div>
            <div className="fg">
              <label><span className="lbl-icon"><Ruler size={12} strokeWidth={2} /></span> Height (cm)</label>
              <input required type="number" min="100" max="250" placeholder="175" value={form.height_cm} onChange={e => set('height_cm', e.target.value)} />
            </div>
          </div>

          {/* Goal */}
          <div className="ob-section-label">Fitness Goal</div>
          <div className="form-cols-2" style={{ marginBottom: 8 }}>
            {GOALS.map(g => (
              <label key={g.value} className={`goal-card ${form.fitness_goal === g.value ? 'selected' : ''}`}>
                <input
                  type="radio" name="goal" value={g.value}
                  checked={form.fitness_goal === g.value}
                  onChange={() => set('fitness_goal', g.value)}
                  style={{ display: 'none' }}
                />
                <div className="goal-card-icon"><g.Icon size={15} strokeWidth={2} /></div>
                <div>
                  <div className="goal-card-label">{g.label}</div>
                  <div className="goal-card-desc">{g.desc}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Activity */}
          <div className="ob-section-label">Activity Level</div>
          <div className="fg">
            <select value={form.activity_level} onChange={e => set('activity_level', e.target.value)}>
              {LEVELS.map(l => (
                <option key={l.value} value={l.value}>{l.label} — {l.desc}</option>
              ))}
            </select>
          </div>

          {/* Medical */}
          <div className="ob-section-label">
            <FileText size={11} strokeWidth={2} />
            Medical Notes
            <span style={{ color: 'var(--t4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </div>
          <div className="fg">
            <input
              placeholder="Any injuries, conditions, or limitations your coach should know..."
              value={form.medical_notes}
              onChange={e => set('medical_notes', e.target.value)}
            />
          </div>

          {error && (
            <div className="ob-error">
              <span>⚠</span> {error}
            </div>
          )}

          <button className="ob-submit" type="submit" disabled={loading}>
            {loading ? 'Creating profile...' : 'Start Training with FitMind →'}
          </button>
        </form>
      </div>
    </div>
  )
}
