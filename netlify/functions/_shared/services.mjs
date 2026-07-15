import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY
  return apiKey ? new OpenAI({ apiKey }) : null
}

export function getSupabase(useAdmin = false) {
  const url = process.env.VITE_SUPABASE_URL
  const key = useAdmin ? process.env.SUPABASE_SERVICE_ROLE_KEY : (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
}

export function normalizeException(body = {}, request) {
  return {
    source: ['client', 'server', 'react', 'api'].includes(body.source) ? body.source : 'client',
    severity: ['info', 'warning', 'error', 'fatal'].includes(body.severity) ? body.severity : 'error',
    message: String(body.message || 'Bilinmeyen hata').slice(0, 4000),
    stack: body.stack ? String(body.stack).slice(0, 16000) : null,
    url: body.url ? String(body.url).slice(0, 2000) : null,
    method: request?.method || body.method || null,
    user_agent: body.userAgent ? String(body.userAgent).slice(0, 1000) : request?.headers.get('user-agent') || null,
    context: body.context && typeof body.context === 'object' ? body.context : {},
  }
}

export async function saveException(payload) {
  const supabase = getSupabase()
  if (!supabase) return false
  const { error } = await supabase.from('exceptions').insert(payload)
  if (error) console.error('Exception table write failed:', error.message)
  return !error
}
