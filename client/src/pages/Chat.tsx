import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { readLS } from '../lib/storage'
import {
  Zap, Shield, UserPlus, ArrowUp, Brain, Dumbbell,
  BookOpen, Trash2, ChevronDown, ChevronUp, X,
} from 'lucide-react'
import WeatherWidget from '../components/WeatherWidget'

interface Message {
  role: 'user' | 'assistant'
  content: string
  time: string
  streaming?: boolean
  retryable?: boolean
}

const SUGGESTIONS = [
  'Create a workout plan for this week',
  'How many calories should I eat today?',
  'How do I optimise sleep and recovery?',
  'Best cardio for fat loss?',
]

const fmtTime = (d = new Date()) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function Chat() {
  const navigate = useNavigate()
  const user     = readLS<any>('fitmind_user', null)
  const [messages, setMessages]           = useState<Message[]>(() =>
    user?.id ? readLS<Message[]>(`fitmind_messages_${user.id}`, []) : []
  )
  const [input, setInput]                 = useState('')
  const [thinking, setThinking]           = useState(false)
  const [thinkingAgent, setThinkingAgent] = useState('')
  const [wsReady, setWsReady]             = useState(false)
  const [reconnecting, setReconnecting]   = useState(false)
  const [hasReview, setHasReview]         = useState(false)
  const [agentNotes, setAgentNotes]       = useState<string[]>([])
  const [memOpen, setMemOpen]             = useState(false)
  const [clearPending, setClearPending]   = useState(false)
  const wsRef          = useRef<WebSocket | null>(null)
  const reconnectDelay = useRef(1000)
  const reconnectTimer = useRef<number | null>(null)
  const bottomRef      = useRef<HTMLDivElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const lastMsgRef     = useRef<string>('')

  const session  = readLS<any>('fitmind_session', null)
  const profiles = readLS<Array<{ user: any; session: any }>>('fitmind_profiles', [])

  const switchProfile = (p: { user: any; session: any }) => {
    localStorage.setItem('fitmind_user',    JSON.stringify(p.user))
    localStorage.setItem('fitmind_session', JSON.stringify(p.session))
    window.location.reload()
  }

  useEffect(() => {
    if (!user?.id) { navigate('/onboarding'); return }

    let cancelled = false

    const connect = () => {
      if (cancelled) return

      const proto  = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsHost = import.meta.env.DEV
        ? `${window.location.hostname}:8787`
        : window.location.host
      const ws = new WebSocket(`${proto}//${wsHost}/agents/fitness-coach-agent/${user.id}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) { ws.close(); return }
        reconnectDelay.current = 1000
        setReconnecting(false)
        ws.send(JSON.stringify({
          type: 'init',
          profile: {
            userId:        user.id,
            sessionId:     session?.id ?? '',
            userName:      user.name,
            age:           user.age,
            weight_kg:     user.weight_kg,
            height_cm:     user.height_cm,
            fitnessGoal:   user.fitness_goal,
            activityLevel: user.activity_level,
            medicalNotes:  user.medical_notes ?? '',
          },
        }))
      }

      ws.onmessage = (e) => {
        if (cancelled) return
        try {
          const data = JSON.parse(e.data)

          if (data.type === 'chat_cleared') {
            setMessages([])
            if (user?.id) localStorage.removeItem(`fitmind_messages_${user.id}`)
            return
          }

          if (data.type === 'ready') {
            setWsReady(true)
            setAgentNotes(data.notes ?? [])
            if (data.history?.length) {
              const restored: Message[] = data.history.map((m: { role: string; content: string; created_at: string }) => ({
                role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
                content: m.content,
                time: m.created_at
                  ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '',
              }))
              setMessages(restored)
              if (user?.id) localStorage.setItem(`fitmind_messages_${user.id}`, JSON.stringify(restored.slice(-40)))
            }
            return
          }

          if (data.type === 'memory') {
            setAgentNotes(data.notes ?? [])
            return
          }

          if (data.type === 'status' && data.status === 'thinking') {
            setThinking(true)
            setThinkingAgent(data.agent ?? 'coach')
            return
          }

          if (data.type === 'chunk') {
            setThinking(false)
            setThinkingAgent('')
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.streaming) {
                return [...prev.slice(0, -1), { ...last, content: last.content + data.content }]
              }
              return [...prev, { role: 'assistant', content: data.content, time: fmtTime(), streaming: true }]
            })
            return
          }

          if (data.type === 'message_done') {
            setThinking(false)
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.streaming) {
                if (last.content?.includes('human trainer')) setHasReview(true)
                return [...prev.slice(0, -1), { ...last, streaming: false }]
              }
              return prev
            })
            return
          }

          if (data.type === 'message') {
            setThinking(false)
            setThinkingAgent('')
            const isRateLimit = data.content?.includes('rate-limited') || data.content?.includes('high demand')
            setMessages(prev => [...prev, { role: 'assistant', content: data.content, time: fmtTime(), retryable: isRateLimit }])
            if (data.content?.includes('human trainer')) setHasReview(true)
          }
        } catch { /* ignore */ }
      }

      ws.onclose = (event) => {
        if (cancelled) return
        setWsReady(false)
        wsRef.current = null
        if (!event.wasClean) {
          setReconnecting(true)
          reconnectTimer.current = window.setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000)
            connect()
          }, reconnectDelay.current)
        }
      }

      ws.onerror = () => {
        if (cancelled) return
        setWsReady(false)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      // Only close OPEN sockets here. If the socket is still CONNECTING, calling
      // close() triggers "WebSocket is closed before the connection is established".
      // Instead, the onopen handler checks `cancelled` and closes it once OPEN.
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close()
      }
      wsRef.current = null
    }
  }, [user?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    if (user?.id && messages.length > 0) {
      localStorage.setItem(
        `fitmind_messages_${user.id}`,
        JSON.stringify(messages.filter(m => !m.streaming).slice(-40))
      )
    }
  }, [messages, user?.id])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 130) + 'px'
  }, [input])

  const deleteNote = (index: number) => {
    if (wsRef.current?.readyState === 1)
      wsRef.current.send(JSON.stringify({ type: 'delete_memory', index }))
  }

  const clearMemory = () => {
    if (wsRef.current?.readyState === 1)
      wsRef.current.send(JSON.stringify({ type: 'clear_memory' }))
  }

  const clearChat = () => {
    if (!clearPending) {
      setClearPending(true)
      setTimeout(() => setClearPending(false), 3000)
      return
    }
    setClearPending(false)
    setMessages([])
    if (user?.id) localStorage.removeItem(`fitmind_messages_${user.id}`)
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'clear_chat' }))
  }

  const send = useCallback((text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || wsRef.current?.readyState !== WebSocket.OPEN || thinking) return
    lastMsgRef.current = msg
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg, time: fmtTime() }])
    wsRef.current.send(JSON.stringify({ type: 'chat', message: msg }))
  }, [input, thinking])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const initials = user?.name?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) ?? '?'
  const goalLabel = (user?.fitness_goal ?? '').replace(/_/g, ' ')

  const agentLabel: Record<string, string> = {
    coach:             'FitMind Coach',
    'workout-planner': 'Workout Planner',
    backup:            'Backup AI',
  }

  if (!user) return null

  return (
    <div className="chat-layout">

      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sb-top">
          <div className="sb-brand">
            <div className="sb-brand-icon">
              <Zap size={15} strokeWidth={2.5} />
            </div>
            <div>
              <div className="sb-brand-name">FitMind</div>
              <div className="sb-brand-tag">AI Fitness Coach</div>
            </div>
          </div>
        </div>

        <div className="sb-body">
          {/* User card */}
          <div className="user-card">
            <div className="uc-top">
              <div className="uc-avatar">{initials}</div>
              <div>
                <div className="uc-name">{user.name}</div>
                <div className="uc-goal">{goalLabel || 'General Fitness'}</div>
              </div>
            </div>
            <div className="uc-stats">
              <div className="uc-stat">
                <div className="uc-stat-val">{user.age}</div>
                <div className="uc-stat-lbl">Age</div>
              </div>
              <div className="uc-stat">
                <div className="uc-stat-val">{user.weight_kg}</div>
                <div className="uc-stat-lbl">kg</div>
              </div>
              <div className="uc-stat">
                <div className="uc-stat-val">{user.height_cm}</div>
                <div className="uc-stat-lbl">cm</div>
              </div>
              <div className="uc-stat">
                <div className="uc-stat-val" style={{ fontSize: '0.62rem', textTransform: 'capitalize' }}>
                  {user.activity_level?.replace('_', ' ') ?? '—'}
                </div>
                <div className="uc-stat-lbl">Level</div>
              </div>
            </div>
          </div>

          {/* Weather */}
          <WeatherWidget />

          {/* Profile Switcher */}
          {profiles.length > 0 && (
            <div className="ps-section">
              <div className="ps-label">Profiles</div>
              {profiles.map(p => {
                const isActive = p.user.id === user?.id
                const av = (p.user.name ?? '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                const gl = (p.user.fitness_goal ?? '').replace(/_/g, ' ')
                return (
                  <div
                    key={p.user.id}
                    className={`ps-chip${isActive ? ' active' : ''}`}
                    onClick={() => !isActive && switchProfile(p)}
                    title={isActive ? 'Currently active' : `Switch to ${p.user.name}`}
                  >
                    <div className="ps-avatar">{av}</div>
                    <div className="ps-info">
                      <div className="ps-name">{p.user.name}</div>
                      <div className="ps-goal">{gl || 'General'}</div>
                    </div>
                    {isActive && <div className="ps-dot" />}
                  </div>
                )
              })}
            </div>
          )}

          {/* Agent Memory */}
          <div className="mem-section">
            <button className="mem-header" onClick={() => setMemOpen(v => !v)}>
              <span className="mem-hd-left">
                <BookOpen size={12} strokeWidth={1.8} />
                <span className="mem-hd-label">Coach Memory</span>
                <span className="mem-hd-count">{agentNotes.length}</span>
              </span>
              {memOpen
                ? <ChevronUp size={12} strokeWidth={2} />
                : <ChevronDown size={12} strokeWidth={2} />
              }
            </button>

            {memOpen && (
              <div className="mem-body">
                {agentNotes.length === 0 ? (
                  <div className="mem-empty">
                    Coach hasn't learned anything about you yet. Start chatting!
                  </div>
                ) : (
                  <>
                    <div className="mem-list">
                      {agentNotes.map((note, i) => (
                        <div key={i} className="mem-item">
                          <span className="mem-note">{note}</span>
                          <button
                            className="mem-del"
                            onClick={() => deleteNote(i)}
                            title="Remove this memory"
                          >
                            <X size={10} strokeWidth={2.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button className="mem-clear" onClick={clearMemory}>
                      <Trash2 size={10} strokeWidth={2} />
                      Clear all memories
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="sb-nav-label">Navigation</div>
          {messages.length > 0 && (
            <button
              className="sb-link"
              onClick={clearChat}
              disabled={thinking}
              style={clearPending ? { color: 'var(--err, #ef4444)', background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' } : { background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
            >
              <span className="sb-link-icon"><Trash2 size={14} strokeWidth={1.5} /></span>
              {clearPending ? 'Confirm clear?' : 'Clear chat'}
            </button>
          )}
          <Link to="/admin" className="sb-link">
            <span className="sb-link-icon"><Shield size={14} strokeWidth={1.5} /></span>
            Admin Panel
          </Link>
          <div className="sb-link" onClick={() => navigate('/onboarding?new=1')}>
            <span className="sb-link-icon"><UserPlus size={14} strokeWidth={1.5} /></span>
            New Profile
          </div>
        </div>

        <div className="sb-footer">
          <div className="sb-agents-badge">
            <span className="dot-pulse" />
            2 agents active
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="chat-main">

        {/* Header */}
        <div className="chat-header">
          <div className="ch-left">
            <span className={`status-dot ${!wsReady ? 'offline' : thinking ? 'thinking' : 'online'}`} />
            <span className="ch-status">
              {!wsReady
                ? reconnecting ? 'Reconnecting...' : 'Connecting...'
                : thinking
                  ? `${agentLabel[thinkingAgent] ?? 'FitMind'} thinking...`
                  : 'FitMind · Ready'}
            </span>
          </div>
          <div className="ch-right">
            {(['coach', 'workout-planner'] as const).map(a => (
              <div key={a} className={`agent-pill ${thinking && thinkingAgent === a ? 'active' : ''}`}>
                <span className="ap-dot" />
                {a === 'coach'
                  ? <><Brain size={10} strokeWidth={2} /> Coach</>
                  : <><Dumbbell size={10} strokeWidth={2} /> Planner</>
                }
              </div>
            ))}
          </div>
        </div>

        {/* Review banner */}
        {hasReview && (
          <div className="review-banner">
            A plan was flagged for trainer review.{' '}
            <Link to="/admin">Check Admin Panel →</Link>
          </div>
        )}

        {/* Messages */}
        <div className="messages">
          {messages.length === 0 && wsReady && (
            <div className="welcome-screen">
              <div className="ws-glyph">
                <Dumbbell size={24} strokeWidth={2} />
              </div>
              <h2 className="ws-heading">Hey {user.name}, ready?</h2>
              <p className="ws-sub">
                I'm your personal AI fitness coach. Goal:{' '}
                <strong style={{ color: 'var(--a)' }}>{goalLabel || 'general fitness'}</strong>.
                I remember everything you tell me across every session.
              </p>
              <div className="ws-chips">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="ws-chip" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="msg-avatar">
                {m.role === 'user' ? initials : <Zap size={11} strokeWidth={2.5} />}
              </div>
              <div className="msg-body">
                <div className="bubble">
                  {m.role === 'assistant'
                    ? <ReactMarkdown skipHtml>{m.streaming ? m.content + '▍' : m.content}</ReactMarkdown>
                    : m.content
                  }
                  {m.retryable && lastMsgRef.current && (
                    <button
                      onClick={() => send(lastMsgRef.current)}
                      style={{ display: 'block', marginTop: 8, fontSize: '0.75rem', opacity: 0.75, background: 'none', border: '1px solid var(--b2)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--t2)' }}
                    >
                      ↺ Try again
                    </button>
                  )}
                </div>
                <span className="msg-time">{m.time}</span>
              </div>
            </div>
          ))}

          {thinking && (
            <div className="typing-wrap">
              <div className="msg-avatar" style={{
                width: 26, height: 26, borderRadius: 'var(--r1)',
                background: 'var(--bg3)', border: '1px solid var(--b2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, alignSelf: 'flex-end',
              }}>
                <Zap size={11} strokeWidth={2.5} color="var(--t3)" />
              </div>
              <div>
                <div className="typing-bubble"><span /><span /><span /></div>
                <div className="typing-label">{agentLabel[thinkingAgent] ?? 'FitMind'}…</div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="input-area">
          <div className="input-shell">
            <textarea
              ref={textareaRef}
              className="input-box"
              placeholder={wsReady ? 'Ask your fitness coach anything...' : 'Connecting...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={!wsReady || thinking}
              rows={1}
            />
            <button
              className="send-btn"
              onClick={() => send()}
              disabled={!wsReady || thinking || !input.trim()}
              title="Send (Enter)"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          </div>
          <div className="input-hint">Enter to send · Shift+Enter for new line</div>
        </div>
      </div>
    </div>
  )
}
