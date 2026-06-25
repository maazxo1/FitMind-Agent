import { Component } from 'react'
import type { ReactNode } from 'react'
import { Zap } from 'lucide-react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[FitMind] Uncaught error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0d0d0d', color: '#e8e8e8',
          fontFamily: 'system-ui, sans-serif', padding: '40px 20px', textAlign: 'center',
        }}>
          <Zap size={32} strokeWidth={2} style={{ marginBottom: 16, color: '#a78bfa' }} />
          <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: '0.9rem', maxWidth: 360 }}>
            {error.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: '#a78bfa', color: '#fff', cursor: 'pointer',
              fontSize: '0.875rem', fontWeight: 500,
            }}
          >
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
