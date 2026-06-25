import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, ArrowLeft, Loader2, CheckCircle2,
  AlertTriangle, FileText, Check, X, Lock,
} from 'lucide-react'

interface Review {
  id: string
  user_name: string
  fitness_goal: string
  review_reason: string
  agent_output: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export default function Admin() {
  const [reviews, setReviews]         = useState<Review[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [acting, setActing]           = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote]   = useState('')
  const TOKEN_TTL = 2 * 60 * 60 * 1000 // 2 hours
  const [adminToken, setAdminToken]   = useState<string>(() => {
    const raw = sessionStorage.getItem('fitmind_admin')
    if (!raw) return ''
    try {
      const { token, ts } = JSON.parse(raw)
      if (Date.now() - ts < TOKEN_TTL) return token as string
    } catch {}
    sessionStorage.removeItem('fitmind_admin')
    return ''
  })
  const [tokenInput, setTokenInput]   = useState('')

  const authHeaders = (extra?: Record<string, string>) => ({
    'Authorization': `Bearer ${adminToken}`,
    ...extra,
  })

  const clearToken = () => {
    sessionStorage.removeItem('fitmind_admin')
    setAdminToken('')
    setReviews([])
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/admin/reviews', { headers: authHeaders() })
      if (res.status === 401) { clearToken(); return }
      if (!res.ok) throw new Error(`Failed to load reviews (${res.status})`)
      const data = await res.json() as any
      setReviews(data.reviews ?? [])
    } catch (err: any) {
      setError(err.message || 'Failed to load reviews')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (adminToken) load()
  }, [adminToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, status: 'approved' | 'rejected', note?: string) => {
    setActing(id)
    try {
      const res = await fetch(`/admin/reviews/${id}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status, reviewer_note: note }),
      })
      if (res.status === 401) { clearToken(); return }
      if (!res.ok) throw new Error(`Action failed (${res.status})`)
      await load()
    } catch (err: any) {
      setError(err.message || 'Action failed')
    } finally {
      setActing(null)
    }
  }

  if (!adminToken) {
    return (
      <div className="admin-wrap">
        <div className="admin-inner" style={{ maxWidth: 380, marginTop: '15vh' }}>
          <div className="admin-top" style={{ marginBottom: 24 }}>
            <h1 className="admin-heading">
              <Lock size={20} strokeWidth={1.5} /> Admin Access
            </h1>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault()
            if (!tokenInput.trim()) return
            sessionStorage.setItem('fitmind_admin', JSON.stringify({ token: tokenInput.trim(), ts: Date.now() }))
            setAdminToken(tokenInput.trim())
            setTokenInput('')
          }}>
            <div className="fg" style={{ marginBottom: 12 }}>
              <input
                type="password"
                placeholder="Enter admin token..."
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                style={{ width: '100%' }}
                autoFocus
              />
            </div>
            <button className="ob-submit" type="submit" style={{ marginTop: 0 }}>
              Access Admin Panel →
            </button>
          </form>
        </div>
      </div>
    )
  }

  const pending  = reviews.filter(r => r.status === 'pending')
  const approved = reviews.filter(r => r.status === 'approved')
  const rejected = reviews.filter(r => r.status === 'rejected')
  const done     = reviews.filter(r => r.status !== 'pending')

  return (
    <div className="admin-wrap">
      <div className="admin-inner">

        {/* Header */}
        <div className="admin-top">
          <div>
            <h1 className="admin-heading">
              <ShieldCheck size={22} strokeWidth={1.5} /> Admin Panel
            </h1>
            <p className="admin-sub">Human-in-the-loop review queue for AI-generated fitness plans</p>
          </div>
          <Link to="/chat" className="admin-back">
            <ArrowLeft size={13} strokeWidth={2} /> Back to Chat
          </Link>
        </div>

        {/* KPIs */}
        <div className="admin-kpis">
          <div className="kpi-card pending">
            <div className="kpi-label">Pending Review</div>
            <div className="kpi-value">{pending.length}</div>
          </div>
          <div className="kpi-card approved">
            <div className="kpi-label">Approved</div>
            <div className="kpi-value">{approved.length}</div>
          </div>
          <div className="kpi-card rejected">
            <div className="kpi-label">Rejected</div>
            <div className="kpi-value">{rejected.length}</div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="review-banner" style={{ background: 'color-mix(in srgb, var(--err, #ef4444) 15%, transparent)', borderColor: 'var(--err, #ef4444)', marginBottom: 16 }}>
            {error}{' '}
            <button onClick={() => { setError(''); load() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--a)', fontSize: 'inherit' }}>Retry →</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="empty-state">
            <div className="es-icon"><Loader2 size={24} strokeWidth={1.5} className="anim-spin" /></div>
            <p>Loading reviews...</p>
          </div>
        )}

        {!loading && (
          <>
            <div className="admin-section-label">Pending Reviews</div>

            {pending.length === 0 && (
              <div className="empty-state">
                <div className="es-icon"><CheckCircle2 size={24} strokeWidth={1.5} /></div>
                <p>No pending reviews — all plans are within safe guidelines.</p>
              </div>
            )}

            {pending.map(r => (
              <div key={r.id} className="review-card is-pending">
                <div className="rc-meta">
                  <span className="rc-name">{r.user_name}</span>
                  <span style={{ color: 'var(--t2)', fontSize: '0.76rem' }}>
                    {(r.fitness_goal ?? '').replace(/_/g, ' ')}
                  </span>
                  <span className="badge badge-pending">Pending</span>
                  <span className="rc-time">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <div className="rc-reason">
                  <AlertTriangle size={13} strokeWidth={1.5} color="var(--warn)" />
                  <span><strong>Flagged:</strong> {r.review_reason}</span>
                </div>
                <div className="rc-output">{r.agent_output}</div>
                <div className="rc-actions">
                  <button
                    className="btn-approve"
                    disabled={acting === r.id}
                    onClick={() => act(r.id, 'approved')}
                  >
                    <Check size={13} strokeWidth={2.5} /> Approve
                  </button>
                  <button
                    className="btn-reject"
                    disabled={acting === r.id}
                    onClick={() => { setRejectingId(r.id); setRejectNote('') }}
                  >
                    <X size={13} strokeWidth={2.5} /> Reject
                  </button>
                  <span className="rc-time" style={{ marginLeft: 'auto' }}>
                    {acting === r.id ? 'Saving...' : ''}
                  </span>
                </div>
                {rejectingId === r.id && (
                  <div className="reject-inline">
                    <textarea
                      className="reject-textarea"
                      placeholder="Reason for rejection (optional)..."
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                      rows={2}
                    />
                    <div className="reject-inline-actions">
                      <button
                        className="btn-reject"
                        onClick={() => { act(r.id, 'rejected', rejectNote); setRejectingId(null) }}
                        disabled={acting === r.id}
                      >
                        <X size={13} strokeWidth={2.5} /> Confirm Reject
                      </button>
                      <button
                        className="admin-back"
                        onClick={() => setRejectingId(null)}
                        style={{ fontSize: '0.76rem' }}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Done */}
            {done.length > 0 && (
              <>
                <div className="admin-section-label" style={{ marginTop: 28 }}>Reviewed</div>
                {done.map(r => (
                  <div key={r.id} className={`review-card is-${r.status}`} style={{ opacity: 0.55 }}>
                    <div className="rc-meta">
                      <span className="rc-name">{r.user_name}</span>
                      <span className={`badge badge-${r.status}`}>{r.status}</span>
                      <span className="rc-time">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    <div className="rc-reason">
                      <FileText size={13} strokeWidth={1.5} />
                      <span>{r.review_reason}</span>
                    </div>
                    <div className="rc-output">{r.agent_output}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
