import 'dotenv/config'
import express from 'express'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT || 5173)
const isProduction = process.env.NODE_ENV === 'production'
const rootDir = dirname(fileURLToPath(import.meta.url))
const exceptionLogDir = resolve(rootDir, 'logs')
const exceptionLogFile = resolve(exceptionLogDir, 'exceptions.jsonl')

app.use(express.json({ limit: '15mb' }))

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const supabaseAdmin = supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

function normalizeException(body = {}, request = {}) {
  return {
    source: ['client', 'server', 'react', 'api'].includes(body.source) ? body.source : 'client',
    severity: ['info', 'warning', 'error', 'fatal'].includes(body.severity) ? body.severity : 'error',
    message: String(body.message || 'Bilinmeyen hata').slice(0, 4000),
    stack: body.stack ? String(body.stack).slice(0, 16000) : null,
    url: body.url ? String(body.url).slice(0, 2000) : null,
    method: request.method || body.method || null,
    user_agent: body.userAgent ? String(body.userAgent).slice(0, 1000) : request.headers?.['user-agent'] || null,
    context: body.context && typeof body.context === 'object' ? body.context : {},
  }
}

async function writeException(payload) {
  let savedToSupabase = false
  if (supabase) {
    const { error } = await supabase.from('exceptions').insert(payload)
    if (!error) savedToSupabase = true
    else console.error('Exception table write failed:', error.message)
  }

  await mkdir(exceptionLogDir, { recursive: true })
  await appendFile(exceptionLogFile, `${JSON.stringify({ ...payload, created_at: new Date().toISOString() })}\n`, 'utf8')
  return savedToSupabase ? 'supabase+file' : 'file'
}

app.post('/api/exceptions', async (request, response) => {
  try {
    const storage = await writeException(normalizeException(request.body, request))
    response.status(201).json({ saved: true, storage })
  } catch (error) {
    console.error('Exception logging failed:', error)
    response.status(500).json({ saved: false })
  }
})

app.get('/api/exceptions', async (request, response) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200)
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('exceptions').select('*').order('created_at', { ascending: false }).limit(limit)
    if (!error) return response.json({ source: 'supabase', exceptions: data })
  }

  try {
    const content = await readFile(exceptionLogFile, 'utf8')
    const exceptions = content.trim().split('\n').filter(Boolean).slice(-limit).reverse().map((line) => JSON.parse(line))
    response.json({ source: 'file', exceptions })
  } catch (error) {
    if (error?.code === 'ENOENT') return response.json({ source: 'file', exceptions: [] })
    response.status(500).json({ error: 'Hata kayıtları okunamadı.' })
  }
})

app.get('/api/openai-status', (_request, response) => {
  response.json({
    configured: Boolean(openai),
    model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  })
})

app.post('/api/ai-coach', async (request, response) => {
  if (!openai) {
    return response.status(500).json({
      error: 'OPENAI_API_KEY eksik. .env dosyasina OpenAI API anahtarini ekle.',
    })
  }

  const { message, profile } = request.body ?? {}

  if (!message || typeof message !== 'string') {
    return response.status(400).json({
      error: 'Mesaj bos olamaz.',
    })
  }

  try {
    const aiResponse = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      instructions: [
        'Sen AI Stay Fit uygulamasinda calisan Tatlis Sef adli sicak, akilli ve ogrenebilen bir beslenme yardimcisisin.',
        'Tibbi tani koyma. Riskli saglik durumlarinda doktora veya diyetisyene yonlendir.',
        'Kullanici profilindeki coachMemory notlarini sonraki cevaplarda dikkate al.',
        'Cevaplari Turkce, konusur gibi, net, uygulanabilir ve kisa basliklarla ver.',
      ].join(' '),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Kullanici profili: ${JSON.stringify(profile ?? {})}\n\nIstek: ${message}`,
            },
          ],
        },
      ],
      max_output_tokens: 700,
    })

    response.json({
      answer: aiResponse.output_text,
      usage: aiResponse.usage,
    })
  } catch (error) {
    console.error('OpenAI API error:', error)
    await writeException(normalizeException({
      source: 'api',
      severity: 'error',
      message: error instanceof Error ? error.message : 'OpenAI API hatası',
      stack: error instanceof Error ? error.stack : undefined,
      context: { route: '/api/ai-coach' },
    }, request)).catch((logError) => console.error('OpenAI error could not be logged:', logError))
    if (error?.code === 'insufficient_quota' || error?.status === 429) {
      return response.status(402).json({
        error: 'OpenAI API kotasi veya billing aktif degil. Platform billing ayarlarini kontrol et.',
      })
    }

    response.status(500).json({
      error: 'AI koc cevabi alinamadi. API anahtarini ve kullanim limitini kontrol et.',
    })
  }
})

app.post('/api/analyze-meal', async (request, response) => {
  if (!openai) return response.status(500).json({ error: 'OPENAI_API_KEY eksik.' })

  const { image, clarification, profile } = request.body ?? {}
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return response.status(400).json({ error: 'Geçerli bir yemek fotoğrafı gönderilmedi.' })
  }

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
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: `Bu ogunu analiz et. Kullanici profili ve Tatlis Sef hafizasi: ${JSON.stringify(profile ?? {})}.${clarification ? ` Kullanici aciklamasi: ${String(clarification).slice(0, 1000)}` : ''}` },
          { type: 'input_image', image_url: image, detail: 'original' },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'meal_analysis',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['meal_name', 'total_calories', 'calorie_min', 'calorie_max', 'confidence', 'items', 'assumptions', 'needs_clarification', 'clarification_question', 'chef_feedback', 'memory_updates'],
            properties: {
              meal_name: { type: 'string' },
              total_calories: { type: 'integer', minimum: 0 },
              calorie_min: { type: 'integer', minimum: 0 },
              calorie_max: { type: 'integer', minimum: 0 },
              confidence: { type: 'integer', minimum: 0, maximum: 100 },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'portion', 'calories'],
                  properties: {
                    name: { type: 'string' },
                    portion: { type: 'string' },
                    calories: { type: 'integer', minimum: 0 },
                  },
                },
              },
              assumptions: { type: 'array', items: { type: 'string' } },
              needs_clarification: { type: 'boolean' },
              clarification_question: { type: 'string' },
              chef_feedback: { type: 'string' },
              memory_updates: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      max_output_tokens: 1200,
    })

    const analysis = JSON.parse(aiResponse.output_text)
    response.json({ analysis })
  } catch (error) {
    console.error('Meal analysis error:', error)
    await writeException(normalizeException({
      source: 'api',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Öğün analizi hatası',
      stack: error instanceof Error ? error.stack : undefined,
      context: { route: '/api/analyze-meal' },
    }, request)).catch((logError) => console.error('Meal analysis error could not be logged:', logError))

    if (error?.code === 'insufficient_quota' || error?.status === 429) {
      return response.status(402).json({ error: 'OpenAI API kotası veya billing aktif değil.' })
    }
    response.status(500).json({ error: 'Fotoğraf analiz edilemedi. Daha net ve aydınlık bir fotoğrafla tekrar dene.' })
  }
})

if (isProduction) {
  const distDir = resolve(rootDir, 'dist')
  app.use(express.static(distDir))
  app.get(/.*/, (_request, response) => {
    response.sendFile(resolve(distDir, 'index.html'))
  })
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(port, '0.0.0.0', () => {
  console.log(`AI Stay Fit calisiyor: http://localhost:${port}`)
})
