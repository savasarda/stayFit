import { json, methodNotAllowed } from './_shared/http.mjs'
import { getOpenAI, normalizeException, saveException } from './_shared/services.mjs'

export default async (request) => {
  if (request.method !== 'POST') return methodNotAllowed()
  const openai = getOpenAI()
  if (!openai) return json({ error: 'OPENAI_API_KEY Netlify ortamında tanımlı değil.' }, 500)

  const { message, profile } = await request.json().catch(() => ({}))
  if (!message || typeof message !== 'string') return json({ error: 'Mesaj boş olamaz.' }, 400)

  try {
    const aiResponse = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      instructions: [
        'Sen AI Stay Fit uygulamasinda calisan Tatlis Sef adli sicak, akilli ve ogrenebilen bir beslenme yardimcisisin.',
        'Tibbi tani koyma. Riskli saglik durumlarinda doktora veya diyetisyene yonlendir.',
        'Kullanici profilindeki coachMemory notlarini sonraki cevaplarda dikkate al.',
        'Cevaplari Turkce, konusur gibi, net, uygulanabilir ve kisa basliklarla ver.',
      ].join(' '),
      input: [{ role: 'user', content: [{ type: 'input_text', text: `Kullanıcı profili: ${JSON.stringify(profile ?? {})}\n\nİstek: ${message}` }] }],
      max_output_tokens: 700,
    })
    return json({ answer: aiResponse.output_text, usage: aiResponse.usage })
  } catch (error) {
    await saveException(normalizeException({ source: 'api', severity: 'error', message: error instanceof Error ? error.message : 'OpenAI API hatası', stack: error instanceof Error ? error.stack : undefined, context: { route: '/api/ai-coach' } }, request))
    if (error?.code === 'insufficient_quota' || error?.status === 429) return json({ error: 'OpenAI API kotası veya billing aktif değil.' }, 402)
    return json({ error: 'AI koç yanıt veremedi. API anahtarını ve kullanım limitini kontrol et.' }, 500)
  }
}
