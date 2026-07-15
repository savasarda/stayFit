import { json, methodNotAllowed } from './_shared/http.mjs'
import { getOpenAI, getSupabase, normalizeException, saveException } from './_shared/services.mjs'

export default async (request) => {
  if (request.method !== 'POST') return methodNotAllowed()

  const { name, amount, unit, profile } = await request.json().catch(() => ({}))
  const numericAmount = Number(amount)
  if (!name || typeof name !== 'string' || !Number.isFinite(numericAmount) || numericAmount <= 0 || typeof unit !== 'string') {
    return json({ error: 'Yemek, miktar ve birim gerekli.' }, 400)
  }

  const cacheKey = getMealEstimateCacheKey(name, numericAmount, unit)
  const cachedEstimate = await getSharedCalorieEstimate(cacheKey)
  if (cachedEstimate) return json({ estimate: { ...cachedEstimate, source: 'cache' } })

  const openai = getOpenAI()
  if (!openai) {
    const fallback = estimateMealCaloriesLocally(name, numericAmount, unit)
    await saveSharedCalorieEstimate(cacheKey, { name, amount: numericAmount, unit, estimate: fallback })
    return json({ estimate: fallback })
  }

  try {
    const aiResponse = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      instructions: [
        'Sen AI Stay Fit uygulamasinda calisan beslenme kalori tahmin servisisin.',
        'Kullanici yemek adi, miktar ve birim girer; kaloriyi Turkiye yemekleri ve ev tipi porsiyonlari dusunerek tahmin et.',
        'Yag, sos, seker, pisirme yontemi ve adet/birim belirsizligini araliga yansit.',
        'Kesin laboratuvar sonucu gibi davranma; en iyi tahmin, alt-ust aralik, guven ve kisa geri bildirim ver.',
        'Yanit tamamen Turkce olmali.',
      ].join(' '),
      input: [{ role: 'user', content: [{ type: 'input_text', text: `Profil: ${JSON.stringify(profile ?? {})}\nYemek: ${name}\nMiktar: ${numericAmount} ${unit}` }] }],
      text: { format: { type: 'json_schema', name: 'manual_meal_estimate', strict: true, schema: {
        type: 'object',
        additionalProperties: false,
        required: ['meal_name', 'portion', 'unit', 'total_calories', 'calorie_min', 'calorie_max', 'confidence', 'feedback'],
        properties: {
          meal_name: { type: 'string' },
          portion: { type: 'string' },
          unit: { type: 'string' },
          total_calories: { type: 'integer', minimum: 0 },
          calorie_min: { type: 'integer', minimum: 0 },
          calorie_max: { type: 'integer', minimum: 0 },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          feedback: { type: 'string' },
        },
      } } },
      max_output_tokens: 500,
    })
    const estimate = { ...JSON.parse(aiResponse.output_text), source: 'api' }
    await saveSharedCalorieEstimate(cacheKey, { name, amount: numericAmount, unit, estimate })
    return json({ estimate })
  } catch (error) {
    await saveException(normalizeException({ source: 'api', severity: 'error', message: error instanceof Error ? error.message : 'Manuel öğün kalori hesaplama hatası', stack: error instanceof Error ? error.stack : undefined, context: { route: '/api/estimate-meal-calories' } }, request))
    const fallback = estimateMealCaloriesLocally(name, numericAmount, unit)
    await saveSharedCalorieEstimate(cacheKey, { name, amount: numericAmount, unit, estimate: fallback })
    return json({ estimate: fallback })
  }
}

function getMealEstimateCacheKey(name, amount, unit) {
  const normalizedName = String(name).trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')
  const normalizedAmount = Number(Number(amount).toFixed(1)).toString()
  return `${normalizedName}|${normalizedAmount}|${String(unit).trim().toLocaleLowerCase('tr-TR')}`
}

function mapSharedEstimate(row) {
  return {
    meal_name: row.meal_name,
    portion: row.portion,
    unit: row.unit,
    total_calories: Number(row.total_calories) || 0,
    calorie_min: Number(row.calorie_min) || 0,
    calorie_max: Number(row.calorie_max) || 0,
    confidence: Number(row.confidence) || 0,
    feedback: `${row.feedback || 'Kayıtlı ortak kalori tablosundan getirildi.'} Ortak kalori tablosundan getirildi.`,
  }
}

async function getSharedCalorieEstimate(cacheKey) {
  const supabase = getSupabase(true)
  if (!supabase) return null
  const { data, error } = await supabase.from('shared_calorie_estimates').select('meal_name,portion,unit,total_calories,calorie_min,calorie_max,confidence,feedback,use_count').eq('cache_key', cacheKey).maybeSingle()
  if (error || !data) return null
  void touchSharedCalorieEstimate(supabase, cacheKey, data.use_count)
  return mapSharedEstimate(data)
}

async function touchSharedCalorieEstimate(supabase, cacheKey, useCount) {
  const { error } = await supabase.from('shared_calorie_estimates').update({ last_used_at: new Date().toISOString(), use_count: (Number(useCount) || 0) + 1 }).eq('cache_key', cacheKey)
  if (!error) return true
  const rpcResult = await supabase.rpc('touch_shared_calorie_estimate', { p_cache_key: cacheKey })
  return !rpcResult.error
}

async function saveSharedCalorieEstimate(cacheKey, { name, amount, unit, estimate }) {
  const supabase = getSupabase(true)
  if (!supabase) return false
  const now = new Date().toISOString()
  const payload = {
    cache_key: cacheKey,
    food_name: String(name).trim(),
    amount,
    unit,
    meal_name: estimate.meal_name,
    portion: estimate.portion,
    total_calories: estimate.total_calories,
    calorie_min: estimate.calorie_min,
    calorie_max: estimate.calorie_max,
    confidence: estimate.confidence,
    feedback: estimate.feedback || '',
    source: estimate.source === 'local' ? 'local' : 'api',
    updated_at: now,
    last_used_at: now,
  }
  const { error } = await supabase.from('shared_calorie_estimates').upsert(payload, { onConflict: 'cache_key' })
  if (!error) return true
  const rpcResult = await supabase.rpc('upsert_shared_calorie_estimate', {
    p_cache_key: cacheKey,
    p_food_name: payload.food_name,
    p_amount: payload.amount,
    p_unit: payload.unit,
    p_meal_name: payload.meal_name,
    p_portion: payload.portion,
    p_total_calories: payload.total_calories,
    p_calorie_min: payload.calorie_min,
    p_calorie_max: payload.calorie_max,
    p_confidence: payload.confidence,
    p_feedback: payload.feedback,
    p_source: payload.source,
  })
  return !rpcResult.error
}

function estimateMealCaloriesLocally(name, amount, unit) {
  const normalized = String(name).toLocaleLowerCase('tr-TR')
  const table = [
    { keys: ['pilav', 'makarna', 'pasta'], kcal: 150 },
    { keys: ['tavuk', 'hindi'], kcal: 165 },
    { keys: ['köfte', 'kofte', 'et'], kcal: 240 },
    { keys: ['balık', 'balik', 'somon'], kcal: 190 },
    { keys: ['yumurta'], kcal: 155 },
    { keys: ['yoğurt', 'yogurt'], kcal: 60 },
    { keys: ['salata', 'sebze'], kcal: 45 },
    { keys: ['çorba', 'corba'], kcal: 55 },
    { keys: ['ekmek'], kcal: 265 },
    { keys: ['meyve', 'elma', 'muz'], kcal: 80 },
  ]
  const match = table.find((item) => item.keys.some((key) => normalized.includes(key)))
  const kcalPer100 = match?.kcal || 140
  const gramAmount = unit === 'gram' ? amount : unit === 'adet' ? amount * 80 : unit === 'bardak' ? amount * 200 : amount * 180
  const total = Math.max(20, Math.round((gramAmount / 100) * kcalPer100))
  return { meal_name: `${name} (${amount} ${unit})`, portion: `${amount} ${unit}`, unit, total_calories: total, calorie_min: Math.round(total * 0.82), calorie_max: Math.round(total * 1.18), confidence: match ? 68 : 45, feedback: match ? 'Yerel besin tablosuna göre hızlı bir tahmin hazır.' : 'OpenAI kullanılamadığı için genel ortalama ile tahmin yapıldı; emin değilsen porsiyonu düzenle.', source: 'local' }
}
