import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { reportException } from './lib/errorLogger'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportException({
      source: 'react',
      severity: 'fatal',
      message: error.message,
      stack: error.stack,
      context: { componentStack: info.componentStack },
    })
  }

  render() {
    if (this.state.failed) {
      return <main className="fatal-error"><h1>Bir sorun oluştu</h1><p>Hata kaydedildi. Sayfayı yenileyerek tekrar deneyebilirsin.</p><button type="button" onClick={() => window.location.reload()}>Sayfayı yenile</button></main>
    }
    return this.props.children
  }
}
