import { json, methodNotAllowed } from './_shared/http.mjs'
import { getSupabase, normalizeException, saveException } from './_shared/services.mjs'

export default async (request) => {
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}))
    const saved = await saveException(normalizeException(body, request))
    return json({ saved, storage: saved ? 'supabase' : 'unavailable' }, saved ? 201 : 500)
  }
  if (request.method === 'GET') {
    const supabase = getSupabase(true)
    if (!supabase) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY yalnızca hata listesini okumak için gereklidir.' }, 403)
    const url = new URL(request.url)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)
    const { data, error } = await supabase.from('exceptions').select('*').order('created_at', { ascending: false }).limit(limit)
    if (error) return json({ error: error.message }, 500)
    return json({ source: 'supabase', exceptions: data })
  }
  return methodNotAllowed()
}
