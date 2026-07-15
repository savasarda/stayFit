import { json, methodNotAllowed } from './_shared/http.mjs'

export default async (request) => {
  if (request.method !== 'GET') return methodNotAllowed()
  return json({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.4-mini' })
}
