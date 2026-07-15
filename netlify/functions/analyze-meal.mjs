import { json, methodNotAllowed } from './_shared/http.mjs'
import { getOpenAI, normalizeException, saveException } from './_shared/services.mjs'

export default async (request) => {
  if (request.method !== 'POST') return methodNotAllowed()
  const openai = getOpenAI()
  if (!openai) return json({ error: 'OPENAI_API_KEY Netlify ortamında tanımlı değil.' }, 500)
  const { image, clarification } = await request.json().catch(() => ({}))
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return json({ error: 'Geçerli bir yemek fotoğrafı gönderilmedi.' }, 400)

  try {
    const aiResponse = await openai.responses.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-5.4',
      instructions: [
        'Sen deneyimli bir besin görüntüsü analiz asistanısın.',
        'Yalnızca fotoğrafta makul biçimde görülen veya kullanıcının açıkladığı besinleri raporla; emin olmadığın içeriği kesinmiş gibi yazma.',
        'Her bileşen için porsiyon ve kalori tahmini yap. Yağ, sos, şeker, içecek ve pişirme yönteminin kalori etkisini özellikle değerlendir.',
        'Görselden porsiyon veya gizli içerik güvenilir belirlenemiyorsa needs_clarification=true yap ve tek, kısa, en önemli soruyu sor.',
        'Kaloriyi sahte kesinlikle verme; en iyi tahminin yanında gerçekçi alt ve üst sınır üret.',
        'Yanıt tamamen Türkçe olmalı. Bu sonuç tıbbi veya laboratuvar ölçümü değildir.',
      ].join(' '),
      input: [{ role: 'user', content: [
        { type: 'input_text', text: `Bu öğünü analiz et.${clarification ? ` Kullanıcı açıklaması: ${String(clarification).slice(0, 1000)}` : ''}` },
        { type: 'input_image', image_url: image, detail: 'original' },
      ] }],
      text: { format: { type: 'json_schema', name: 'meal_analysis', strict: true, schema: {
        type: 'object', additionalProperties: false,
        required: ['meal_name', 'total_calories', 'calorie_min', 'calorie_max', 'confidence', 'items', 'assumptions', 'needs_clarification', 'clarification_question'],
        properties: {
          meal_name: { type: 'string' }, total_calories: { type: 'integer', minimum: 0 }, calorie_min: { type: 'integer', minimum: 0 }, calorie_max: { type: 'integer', minimum: 0 }, confidence: { type: 'integer', minimum: 0, maximum: 100 },
          items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'portion', 'calories'], properties: { name: { type: 'string' }, portion: { type: 'string' }, calories: { type: 'integer', minimum: 0 } } } },
          assumptions: { type: 'array', items: { type: 'string' } }, needs_clarification: { type: 'boolean' }, clarification_question: { type: 'string' },
        },
      } } },
      max_output_tokens: 1200,
    })
    return json({ analysis: JSON.parse(aiResponse.output_text) })
  } catch (error) {
    await saveException(normalizeException({ source: 'api', severity: 'error', message: error instanceof Error ? error.message : 'Öğün analizi hatası', stack: error instanceof Error ? error.stack : undefined, context: { route: '/api/analyze-meal' } }, request))
    if (error?.code === 'insufficient_quota' || error?.status === 429) return json({ error: 'OpenAI API kotası veya billing aktif değil.' }, 402)
    return json({ error: 'Fotoğraf analiz edilemedi. Daha net ve aydınlık bir fotoğrafla tekrar dene.' }, 500)
  }
}
