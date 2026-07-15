import { json, methodNotAllowed } from './_shared/http.mjs'
import { getOpenAI, normalizeException, saveException } from './_shared/services.mjs'

export default async (request) => {
  if (request.method !== 'POST') return methodNotAllowed()
  const openai = getOpenAI()
  if (!openai) return json({ error: 'OPENAI_API_KEY Netlify ortamında tanımlı değil.' }, 500)
  const { image, clarification, profile } = await request.json().catch(() => ({}))
  if (typeof image !== 'string' || !image.startsWith('data:image/')) return json({ error: 'Geçerli bir yemek fotoğrafı gönderilmedi.' }, 400)

  try {
    const aiResponse = await openai.responses.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-5.4',
      instructions: [
        'Sen AI Stay Fit uygulamasinda calisan Tatlis Sef adli sicak, akilli ve ogrenebilen bir beslenme yardimcisisin.',
        'Fotograf analizinden sonra kullaniciyla konusur gibi kisa ve samimi geri bildirim ver.',
        'Yalnizca fotografta makul bicimde gorulen veya kullanicinin acikladigi besinleri raporla; emin olmadigin icerigi kesinmis gibi yazma.',
        'Her bilesen icin porsiyon ve kalori tahmini yap. Yag, sos, seker, icecek ve pisirme yonteminin kalori etkisini ozellikle degerlendir.',
        'Gorselden porsiyon veya gizli icerik guvenilir belirlenemiyorsa needs_clarification=true yap ve tek, kisa, en onemli soruyu sor.',
        'Kaloriyi sahte kesinlikle verme; en iyi tahminin yaninda gercekci alt ve ust sinir uret.',
        'chef_feedback alaninda 2-4 kisa cumleyle cok/az/dengeli yorumunu, yanina eklenebilecek bir seyi veya sonraki ogun icin pratik oneriyi yaz.',
        'memory_updates alanina sadece gelecekte ise yarayacak kullanici tercihi, hassasiyet veya tekrar eden davranis notlarini ekle. Emin degilsen bos dizi dondur.',
        'Yanit tamamen Turkce olmali. Bu sonuc tibbi veya laboratuvar olcumu degildir.',
      ].join(' '),
      input: [{ role: 'user', content: [
        { type: 'input_text', text: `Bu ogunu analiz et. Kullanici profili ve Tatlis Sef hafizasi: ${JSON.stringify(profile ?? {})}.${clarification ? ` Kullanici aciklamasi: ${String(clarification).slice(0, 1000)}` : ''}` },
        { type: 'input_image', image_url: image, detail: 'original' },
      ] }],
      text: { format: { type: 'json_schema', name: 'meal_analysis', strict: true, schema: {
        type: 'object', additionalProperties: false,
        required: ['meal_name', 'total_calories', 'protein', 'carbs', 'fat', 'calorie_min', 'calorie_max', 'confidence', 'items', 'assumptions', 'needs_clarification', 'clarification_question', 'chef_feedback', 'memory_updates'],
        properties: {
          meal_name: { type: 'string' }, total_calories: { type: 'integer', minimum: 0 }, protein: { type: 'number', minimum: 0 }, carbs: { type: 'number', minimum: 0 }, fat: { type: 'number', minimum: 0 }, calorie_min: { type: 'integer', minimum: 0 }, calorie_max: { type: 'integer', minimum: 0 }, confidence: { type: 'integer', minimum: 0, maximum: 100 },
          items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'portion', 'calories'], properties: { name: { type: 'string' }, portion: { type: 'string' }, calories: { type: 'integer', minimum: 0 } } } },
          assumptions: { type: 'array', items: { type: 'string' } }, needs_clarification: { type: 'boolean' }, clarification_question: { type: 'string' }, chef_feedback: { type: 'string' }, memory_updates: { type: 'array', items: { type: 'string' } },
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
