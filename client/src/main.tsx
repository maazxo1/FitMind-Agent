import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Onboarding from './pages/Onboarding'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import { ErrorBoundary } from './components/ErrorBoundary'
import { readLS } from './lib/storage'

// Seed fitmind_profiles at startup so profiles persist even if fitmind_user is cleared
;(() => {
  const user = readLS<any>('fitmind_user', null)
  if (!user?.id) return
  try {
    const session = readLS<any>('fitmind_session', null)
    const list = readLS<Array<{ user: any; session: any }>>('fitmind_profiles', [])
    if (!list.some(p => p?.user?.id === user.id)) {
      list.push({ user, session })
      localStorage.setItem('fitmind_profiles', JSON.stringify(list))
    }
  } catch { /* ignore */ }
})()

const hasUser = () => !!localStorage.getItem('fitmind_user')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/" element={<Navigate to={hasUser() ? '/chat' : '/onboarding'} replace />} />
          <Route path="*" element={<Navigate to={hasUser() ? '/chat' : '/onboarding'} replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
