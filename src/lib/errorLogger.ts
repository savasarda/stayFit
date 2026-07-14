export type ExceptionPayload = {
  source: 'client' | 'server' | 'react' | 'api'
  severity?: 'info' | 'warning' | 'error' | 'fatal'
  message: string
  stack?: string
  url?: string
  context?: Record<string, unknown>
}

export function reportException(payload: ExceptionPayload) {
  const body = JSON.stringify({
    ...payload,
    url: payload.url || window.location.href,
    userAgent: navigator.userAgent,
  })

  if (navigator.sendBeacon) {
    const queued = navigator.sendBeacon('/api/exceptions', new Blob([body], { type: 'application/json' }))
    if (queued) return
  }

  void fetch('/api/exceptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export function installGlobalErrorLogging() {
  window.addEventListener('error', (event) => {
    reportException({
      source: 'client',
      severity: 'fatal',
      message: event.message || 'Bilinmeyen istemci hatası',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      context: { filename: event.filename, line: event.lineno, column: event.colno },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    reportException({
      source: 'client',
      severity: 'fatal',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      context: { type: 'unhandledrejection' },
    })
  })
}
