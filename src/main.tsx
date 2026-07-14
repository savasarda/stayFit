import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { installGlobalErrorLogging } from './lib/errorLogger'

installGlobalErrorLogging()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
)
