import 'dotenv/config'
import express from 'express'
import OpenAI from 'openai'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT || 5173)
const isProduction = process.env.NODE_ENV === 'production'
const rootDir = dirname(fileURLToPath(import.meta.url))

app.use(express.json({ limit: '1mb' }))

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

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
        'Sen AI Stay Fit uygulamasinda calisan bir fitness ve beslenme kocusun.',
        'Tibbi tani koyma. Riskli saglik durumlarinda doktora veya diyetisyene yonlendir.',
        'Cevaplari Turkce, net, uygulanabilir ve kisa basliklarla ver.',
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
