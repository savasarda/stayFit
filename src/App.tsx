import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { Bell, Bot, CalendarDays, Camera, ChartNoAxesColumnIncreasing, CheckCircle2, ChevronRight, Droplets, Flame, Plus, Send, Settings, ShieldCheck, Sparkles, Trash2, Utensils, User, X } from 'lucide-react'
import { reportException } from './lib/errorLogger'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { createUserMeal, loadUserData, migrateLocalData, removeUserMeal, saveUserProfile, saveUserWater } from './lib/dataStore'
import type { Session } from '@supabase/supabase-js'
import './style.css'

type OpenAIStatus = { configured: boolean; model: string }
type Tab = 'today' | 'progress' | 'assistant' | 'profile'
type Meal = { id: string; type: string; name: string; calories: number }
const mealTypes = ['Kahvaltı', 'Öğle yemeği', 'Akşam yemeği', 'Ara öğün'] as const
type ChatMessage = { id: string; from: 'user' | 'assistant'; text: string }
type MealAnalysis = { meal_name: string; total_calories: number; calorie_min: number; calorie_max: number; confidence: number; items: { name: string; portion: string; calories: number }[]; assumptions: string[]; needs_clarification: boolean; clarification_question: string }
type DailyRecord = { meals: Meal[]; water: number }
type DailyRecords = Record<string, DailyRecord>
type Profile = { name: string; height: number; startWeight: number; currentWeight: number; targetWeight: number; dailyCalories: number; mealCount: number; sensitivities: string[]; reminders: string[] }
const emptyProfile: Profile = { name: '', height: 0, startWeight: 0, currentWeight: 0, targetWeight: 0, dailyCalories: 0, mealCount: 3, sensitivities: [], reminders: [] }
const shortDayFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' })
const headerDateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(!isSupabaseConfigured)
  const [isDataReady, setIsDataReady] = useState(!isSupabaseConfigured)
  const [dataError, setDataError] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('today')
  const [profile, setProfile] = useState<Profile>(() => ({ ...emptyProfile, ...readSavedValue('ai-stay-fit-profile', emptyProfile) }))
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()))
  const [dailyRecords, setDailyRecords] = useState<DailyRecords>(loadDailyRecords)
  const [lastPhotoName, setLastPhotoName] = useState('')
  const [mealNotice, setMealNotice] = useState('')
  const [isMealDetailOpen, setIsMealDetailOpen] = useState(false)
  const [mealImage, setMealImage] = useState('')
  const [mealAnalysis, setMealAnalysis] = useState<MealAnalysis | null>(null)
  const [isAnalyzingMeal, setIsAnalyzingMeal] = useState(false)
  const [mealAnalysisError, setMealAnalysisError] = useState('')
  const [openAIStatus, setOpenAIStatus] = useState<OpenAIStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mealNoticeTimerRef = useRef<number | null>(null)
  const selectedDateObject = useMemo(() => parseDateInputValue(selectedDate), [selectedDate])
  const selectedRecord = dailyRecords[selectedDate] || { meals: [], water: 0 }
  const meals = selectedRecord.meals
  const water = selectedRecord.water
  const consumed = useMemo(() => meals.reduce((total, meal) => total + meal.calories, 0), [meals])
  const progress = profile.startWeight && profile.targetWeight ? Math.round(((profile.startWeight - profile.currentWeight) / (profile.startWeight - profile.targetWeight)) * 100) : 0

  useEffect(() => {
    fetch('/api/openai-status').then((response) => response.json()).then((data: OpenAIStatus) => setOpenAIStatus(data)).catch(() => setOpenAIStatus({ configured: false, model: 'Bilinmiyor' }))
  }, [])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setIsAuthReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setIsAuthReady(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user.id) { if (isSupabaseConfigured) setIsDataReady(false); return }
    let cancelled = false
    async function load() {
      setIsDataReady(false); setDataError('')
      try {
        let loaded = await loadUserData(session!.user.id, emptyProfile)
        const hasLocalData = Boolean(profile.name || profile.height || profile.currentWeight || Object.keys(dailyRecords).length)
        if (!loaded.hasProfile && hasLocalData && !readSavedValue('ai-stay-fit-supabase-migrated', false)) {
          await migrateLocalData(session!.user.id, profile, dailyRecords)
          writeSavedValue('ai-stay-fit-supabase-migrated', true)
          loaded = await loadUserData(session!.user.id, emptyProfile)
        }
        if (!cancelled) { setProfile(loaded.profile); setDailyRecords(loaded.dailyRecords) }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Supabase verileri alınamadı.'
        if (!cancelled) setDataError(message)
        reportException({ source: 'api', severity: 'error', message, stack: error instanceof Error ? error.stack : undefined, context: { action: 'loadUserData' } })
      } finally { if (!cancelled) setIsDataReady(true) }
    }
    void load()
    return () => { cancelled = true }
  }, [session?.user.id])

  useEffect(() => { if (!isSupabaseConfigured) writeSavedValue('ai-stay-fit-profile', profile) }, [profile])
  useEffect(() => { if (!isSupabaseConfigured) writeSavedValue('ai-stay-fit-daily-records', dailyRecords) }, [dailyRecords])

  async function addMealFromCamera(file: File) {
    setLastPhotoName(file.name)
    setIsMealDetailOpen(false)
    setMealAnalysis(null)
    setMealAnalysisError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setMealAnalysisError('JPG, PNG veya WEBP formatında bir fotoğraf seç.'); setMealImage(''); return }
    if (file.size > 20 * 1024 * 1024) { setMealAnalysisError('Fotoğraf 20 MB boyutundan küçük olmalı.'); setMealImage(''); return }
    try {
      const image = await prepareMealImage(file)
      setMealImage(image)
      await analyzeMealImage(image)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fotoğraf okunamadı.'
      setMealAnalysisError(message)
      reportException({ source: 'client', severity: 'error', message, stack: error instanceof Error ? error.stack : undefined, context: { action: 'analyzeMealImage' } })
    }
  }

  async function analyzeMealImage(image: string, clarification = '') {
    setIsAnalyzingMeal(true)
    setMealAnalysisError('')
    try {
      const apiResponse = await fetch('/api/analyze-meal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, clarification }) })
      const data = await apiResponse.json()
      if (!apiResponse.ok) throw new Error(data.error || 'Fotoğraf analiz edilemedi.')
      setMealAnalysis(data.analysis)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fotoğraf analiz edilemedi.'
      setMealAnalysisError(message)
      reportException({ source: 'api', severity: 'error', message, stack: error instanceof Error ? error.stack : undefined, context: { action: 'analyzeMealImage' } })
    } finally { setIsAnalyzingMeal(false) }
  }

  function closeMealAnalysis() { setMealImage(''); setMealAnalysis(null); setMealAnalysisError(''); setIsAnalyzingMeal(false) }

  async function saveMeal(meal: Meal) {
    let savedMeal = meal
    if (session?.user.id) {
      try { savedMeal = await createUserMeal(session.user.id, selectedDate, { type: meal.type, name: meal.name, calories: meal.calories }) }
      catch (error) { handleDataError(error, 'Öğün Supabase’e kaydedilemedi.'); return }
    }
    setDailyRecords((current) => {
      const record = current[selectedDate] || { meals: [], water: 0 }
      const updated = { ...current, [selectedDate]: { ...record, meals: [...record.meals, savedMeal] } }
      if (!isSupabaseConfigured) writeSavedValue('ai-stay-fit-daily-records', updated)
      return updated
    })
    setMealNotice(`${savedMeal.name} kaydedildi`)
    if (mealNoticeTimerRef.current) window.clearTimeout(mealNoticeTimerRef.current)
    mealNoticeTimerRef.current = window.setTimeout(() => setMealNotice(''), 2600)
  }

  async function addWater() {
    const nextWater = Math.min(water + 250, 5000)
    if (session?.user.id) { try { await saveUserWater(session.user.id, selectedDate, nextWater) } catch (error) { handleDataError(error, 'Su kaydı Supabase’e yazılamadı.'); return } }
    setDailyRecords((current) => {
      const record = current[selectedDate] || { meals: [], water: 0 }
      const updated = { ...current, [selectedDate]: { ...record, water: nextWater } }
      if (!isSupabaseConfigured) writeSavedValue('ai-stay-fit-daily-records', updated)
      return updated
    })
  }

  async function removeWater() {
    const nextWater = Math.max(water - 250, 0)
    if (session?.user.id) { try { await saveUserWater(session.user.id, selectedDate, nextWater) } catch (error) { handleDataError(error, 'Su kaydı Supabase’te güncellenemedi.'); return } }
    setDailyRecords((current) => {
      const record = current[selectedDate] || { meals: [], water: 0 }
      const updated = { ...current, [selectedDate]: { ...record, water: nextWater } }
      if (!isSupabaseConfigured) writeSavedValue('ai-stay-fit-daily-records', updated)
      return updated
    })
  }

  async function deleteMeal(mealId: string) {
    if (session?.user.id) { try { await removeUserMeal(session.user.id, mealId) } catch (error) { handleDataError(error, 'Öğün Supabase’ten silinemedi.'); return } }
    setDailyRecords((current) => {
      const record = current[selectedDate] || { meals: [], water: 0 }
      const updated = { ...current, [selectedDate]: { ...record, meals: record.meals.filter((meal) => meal.id !== mealId) } }
      if (!isSupabaseConfigured) writeSavedValue('ai-stay-fit-daily-records', updated)
      return updated
    })
  }

  function handleDataError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback
    setDataError(message)
    reportException({ source: 'api', severity: 'error', message, stack: error instanceof Error ? error.stack : undefined, context: { fallback } })
  }

  function updateProfile(nextProfile: Profile) {
    setProfile(nextProfile)
    if (session?.user.id) void saveUserProfile(session.user.id, nextProfile).catch((error) => handleDataError(error, 'Profil Supabase’e kaydedilemedi.'))
  }

  if (!isAuthReady) return <LoadingScreen message="Oturum kontrol ediliyor" />
  if (isSupabaseConfigured && !session) return <AuthPage />
  if (!isDataReady) return <LoadingScreen message="Verilerin hazırlanıyor" />
  if (!isProfileComplete(profile)) return <OnboardingPage profile={profile} onSave={updateProfile} onSignOut={session ? () => void supabase?.auth.signOut() : undefined} />

  return <main className="app-shell"><section className="phone-shell">
    {activeTab === 'today' ? <header className="app-header"><div><p>{formatHeaderDate(selectedDateObject)}</p><h1>Günaydın</h1></div><div className="header-actions">{openAIStatus?.configured ? <span className="ai-status" aria-label="OpenAI API aktif"><i className="openai-dot" /> <small>AI aktif</small></span> : null}<button className="avatar" type="button" onClick={() => setActiveTab('profile')} aria-label="Profili aç"><User size={20} /></button></div></header> : null}
    <div className={activeTab === 'today' ? 'screen' : 'screen full-page'}>
      {activeTab === 'today' ? <TodayPage profile={profile} water={water} meals={meals} dailyRecords={dailyRecords} recordedDates={new Set(Object.keys(dailyRecords).filter((date) => dailyRecords[date].water || dailyRecords[date].meals.length))} selectedDate={selectedDate} lastPhotoName={lastPhotoName} isMealDetailOpen={isMealDetailOpen} onSelectDate={setSelectedDate} onAddWater={addWater} onRemoveWater={removeWater} onOpenMealDetail={() => setIsMealDetailOpen(true)} onCloseMealDetail={() => setIsMealDetailOpen(false)} onOpenAssistant={() => setActiveTab('assistant')} onAddPhoto={() => fileInputRef.current?.click()} onAddManualMeal={(meal) => { saveMeal(meal); setIsMealDetailOpen(false) }} /> : null}
      {activeTab === 'progress' ? <ProgressPage profile={profile} progress={progress} consumed={consumed} water={water} meals={meals} onDeleteMeal={deleteMeal} /> : null}
      {activeTab === 'assistant' ? <AssistantPage profile={profile} meals={meals} water={water} /> : null}
      {activeTab === 'profile' ? <ProfilePage profile={profile} onSave={updateProfile} onSignOut={session ? () => void supabase?.auth.signOut() : undefined} /> : null}
    </div>
    <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; if (file) addMealFromCamera(file); event.currentTarget.value = '' }} />
    {mealImage || isAnalyzingMeal || mealAnalysisError ? <MealAnalysisModal image={mealImage} analysis={mealAnalysis} isLoading={isAnalyzingMeal} error={mealAnalysisError} onClose={closeMealAnalysis} onRetry={(clarification) => analyzeMealImage(mealImage, clarification)} onConfirm={(name, calories, type) => { saveMeal({ id: createId(), type, name, calories }); closeMealAnalysis(); setActiveTab('today') }} /> : null}
    {mealNotice ? <div className="meal-success-backdrop" role="presentation" onClick={() => setMealNotice('')}><section className="meal-success-popup" role="status" aria-live="polite" onClick={(event) => event.stopPropagation()}><span className="meal-success-icon"><CheckCircle2 size={34} strokeWidth={2.2} /></span><h2>Öğün kaydedildi</h2><p>{mealNotice}</p><button type="button" onClick={() => setMealNotice('')}>Tamam</button></section></div> : null}
    {dataError ? <div className="data-error-toast" role="alert"><span>{dataError}</span><button type="button" onClick={() => setDataError('')} aria-label="Hatayı kapat"><X size={16} /></button></div> : null}
    <nav className="tab-bar" aria-label="Alt menü">
      <TabButton active={activeTab === 'today'} icon={<CalendarDays size={23} />} label="Takvim" onClick={() => setActiveTab('today')} />
      <TabButton active={activeTab === 'progress'} icon={<ChartNoAxesColumnIncreasing size={23} />} label="İlerleme" onClick={() => setActiveTab('progress')} />
      <button className="camera-button" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Kamerayla öğün ekle"><Camera size={25} strokeWidth={2.2} /></button>
      <TabButton active={activeTab === 'assistant'} icon={<Bot size={23} />} label="Koç" onClick={() => setActiveTab('assistant')} />
      <TabButton active={activeTab === 'profile'} icon={<User size={23} />} label="Profil" onClick={() => setActiveTab('profile')} />
    </nav>
  </section></main>
}

function LoadingScreen({ message }: { message: string }) { return <main className="auth-shell"><section className="auth-card loading-card"><span className="auth-loader" /><h1>StayFit</h1><p>{message}...</p></section></main> }

function getAuthErrorMessage(message: string) {
  const normalized = message.toLocaleLowerCase('en-US')
  if (normalized.includes('email rate limit') || normalized.includes('rate limit')) return 'Çok kısa sürede fazla kayıt denemesi yapıldı. Birkaç dakika bekleyip tekrar dene.'
  if (normalized.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.'
  if (normalized.includes('user already registered') || normalized.includes('already registered')) return 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı dene.'
  if (normalized.includes('password') && normalized.includes('6')) return 'Şifre en az 6 karakter olmalı.'
  return message || 'İşlem tamamlanamadı. Lütfen tekrar dene.'
}

function AuthPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function signInWithGoogle() {
    if (!supabase || loading) return
    setLoading(true); setError('')
    try {
      const result = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
      if (result.error) setError(getAuthErrorMessage(result.error.message))
    } catch (error) {
      setError(getAuthErrorMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı. Lütfen tekrar dene.'))
    } finally {
      setLoading(false)
    }
  }
  return <main className="auth-shell"><section className="auth-card"><span className="auth-brand"><Flame size={24} /></span><p className="auth-eyebrow">STAYFIT HESABIN</p><h1>Hesabına giriş yap</h1><p className="auth-copy">Öğünlerin, su kayıtların ve hedeflerin tüm cihazlarında seninle kalsın.</p><div className="auth-actions">{error ? <p className="auth-error" role="alert">{error}</p> : null}<button className="google-auth-button" type="button" onClick={signInWithGoogle} disabled={loading}><span aria-hidden="true">G</span>{loading ? 'Google açılıyor...' : 'Google ile devam et'}</button></div></section></main>
}

function isProfileComplete(profile: Profile) {
  return Boolean(profile.height && profile.currentWeight && profile.targetWeight && profile.dailyCalories && profile.mealCount)
}

function OnboardingPage({ profile, onSave, onSignOut }: { profile: Profile; onSave: (profile: Profile) => void; onSignOut?: () => void }) {
  const sensitivityOptions = ['Gluten', 'Laktoz', 'Yumurta', 'Soya', 'Yer fıstığı', 'Deniz ürünleri']
  const [form, setForm] = useState({
    name: profile.name,
    height: String(profile.height || ''),
    currentWeight: String(profile.currentWeight || profile.startWeight || ''),
    targetWeight: String(profile.targetWeight || ''),
    dailyCalories: String(profile.dailyCalories || ''),
    mealCount: String(profile.mealCount || 3),
  })
  const [selectedSensitivities, setSelectedSensitivities] = useState(profile.sensitivities.filter((item) => sensitivityOptions.includes(item)))
  const [customSensitivity, setCustomSensitivity] = useState(profile.sensitivities.filter((item) => !sensitivityOptions.includes(item)).join(', '))
  const [error, setError] = useState('')
  function update(field: keyof typeof form, value: string) { setForm((current) => ({ ...current, [field]: value })) }
  function toggleSensitivity(item: string) { setSelectedSensitivities((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const height = Number(form.height)
    const currentWeight = Number(form.currentWeight)
    const targetWeight = Number(form.targetWeight)
    const dailyCalories = Number(form.dailyCalories)
    const mealCount = Number(form.mealCount)
    if (!height || !currentWeight || !targetWeight || !dailyCalories || !mealCount) { setError('Devam etmek için boy, kilo, hedef, kalori ve öğün sayısını doldur.'); return }
    const manualSensitivities = customSensitivity.split(',').map((item) => item.trim()).filter(Boolean)
    onSave({
      ...profile,
      name: form.name.trim(),
      height,
      startWeight: profile.startWeight || currentWeight,
      currentWeight,
      targetWeight,
      dailyCalories,
      mealCount,
      sensitivities: [...new Set([...selectedSensitivities, ...manualSensitivities])],
    })
  }
  return <main className="onboarding-shell"><section className="onboarding-card"><span className="auth-brand"><Flame size={24} /></span><p className="auth-eyebrow">STAYFIT PROFİLİ</p><h1>Planını hazırlayalım</h1><p className="auth-copy">Koç önerileri, kalori hedefi ve öğün takibi için bu bilgiler gerekli.</p><form onSubmit={submit}><div className="onboarding-grid"><label><span>Adın</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Adını yaz" /></label><label><span>Boy</span><input type="number" inputMode="decimal" value={form.height} onChange={(event) => update('height', event.target.value)} placeholder="cm" /></label><label><span>Güncel kilo</span><input type="number" inputMode="decimal" step="0.1" value={form.currentWeight} onChange={(event) => update('currentWeight', event.target.value)} placeholder="kg" /></label><label><span>Hedef kilo</span><input type="number" inputMode="decimal" step="0.1" value={form.targetWeight} onChange={(event) => update('targetWeight', event.target.value)} placeholder="kg" /></label><label><span>Günlük kalori hedefi</span><input type="number" inputMode="numeric" value={form.dailyCalories} onChange={(event) => update('dailyCalories', event.target.value)} placeholder="Örn. 1800" /></label></div><fieldset className="onboarding-meal-count"><legend>Günde kaç öğün yiyorsun?</legend><div>{['2', '3', '4', '5'].map((count) => <button className={form.mealCount === count ? 'selected' : ''} type="button" key={count} onClick={() => update('mealCount', count)}><strong>{count}</strong><span>öğün</span></button>)}</div></fieldset><fieldset className="onboarding-sensitivities"><legend>Besin hassasiyetlerin</legend><div>{sensitivityOptions.map((item) => <button className={selectedSensitivities.includes(item) ? 'selected' : ''} type="button" key={item} onClick={() => toggleSensitivity(item)}>{item}</button>)}</div><label><span>Başka hassasiyet</span><textarea value={customSensitivity} onChange={(event) => setCustomSensitivity(event.target.value)} placeholder="Varsa virgülle ayırarak yaz" rows={2} /></label></fieldset>{error ? <p className="auth-error" role="alert">{error}</p> : null}<button className="auth-submit" type="submit">Profili kaydet ve başla</button>{onSignOut ? <button className="onboarding-signout" type="button" onClick={onSignOut}>Farklı hesapla giriş yap</button> : null}</form></section></main>
}

function MealAnalysisModal({ image, analysis, isLoading, error, onClose, onRetry, onConfirm }: { image: string; analysis: MealAnalysis | null; isLoading: boolean; error: string; onClose: () => void; onRetry: (clarification: string) => void; onConfirm: (name: string, calories: number, type: string) => void }) {
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [mealType, setMealType] = useState(suggestMealType)
  const [clarification, setClarification] = useState('')
  useEffect(() => { if (analysis) { setName(analysis.meal_name); setCalories(String(analysis.total_calories)) } }, [analysis])
  const calorieValue = Number(calories)
  const canConfirm = Boolean(analysis && name.trim() && Number.isFinite(calorieValue) && calorieValue > 0 && !isLoading)

  return <div className="meal-analysis-backdrop" role="presentation"><section className="meal-analysis-modal" role="dialog" aria-modal="true" aria-labelledby="analysis-title"><header><div><p>FOTOĞRAF ANALİZİ</p><h2 id="analysis-title">Öğünü doğrula</h2></div><button type="button" onClick={onClose} aria-label="Analizi kapat"><X size={21} /></button></header>{image ? <img className="meal-analysis-image" src={image} alt="Analiz edilen öğün" /> : null}{isLoading ? <div className="analysis-loading"><span /><strong>Öğün analiz ediliyor</strong><small>İçerikler ve porsiyonlar kontrol ediliyor...</small></div> : null}{error && !isLoading ? <div className="analysis-error" role="alert"><strong>Analiz tamamlanamadı</strong><p>{error}</p><button type="button" onClick={() => onRetry(clarification)} disabled={!image}>Tekrar dene</button></div> : null}{analysis && !isLoading ? <><MealTypePicker value={mealType} onChange={setMealType} /><div className="analysis-confidence"><span><strong>%{analysis.confidence}</strong><small>Görsel güveni</small></span><div><i style={{ width: `${analysis.confidence}%` }} /></div></div><div className="analysis-edit-grid"><label><span>Öğün adı</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>Kalori</span><input inputMode="numeric" type="number" min="1" value={calories} onChange={(event) => setCalories(event.target.value)} /></label></div><div className="calorie-range"><span>Tahmini aralık</span><strong>{analysis.calorie_min}–{analysis.calorie_max} kcal</strong></div><section className="analysis-items"><h3>Fotoğrafta bulunanlar</h3>{analysis.items.map((item, index) => <div key={`${item.name}-${index}`}><span><strong>{item.name}</strong><small>{item.portion}</small></span><b>{item.calories} kcal</b></div>)}</section>{analysis.assumptions.length ? <div className="analysis-assumptions"><strong>Dikkate alınan varsayımlar</strong>{analysis.assumptions.map((item) => <p key={item}>• {item}</p>)}</div> : null}{analysis.needs_clarification ? <div className="analysis-question"><strong>Daha doğru sonuç için</strong><p>{analysis.clarification_question}</p><div><input value={clarification} onChange={(event) => setClarification(event.target.value)} placeholder="Örn. 1 yemek kaşığı zeytinyağı" /><button type="button" onClick={() => onRetry(clarification)} disabled={!clarification.trim()}>Yeniden analiz et</button></div></div> : null}<p className="analysis-disclaimer">Kalori değeri fotoğraf ve verdiğin porsiyon bilgisine dayalı bir tahmindir. Kaydetmeden önce kontrol et.</p><button className="analysis-confirm" type="button" disabled={!canConfirm} onClick={() => onConfirm(name.trim(), Math.round(calorieValue), mealType)}><CheckCircle2 size={19} /> Onayla ve kaydet</button></> : null}</section></div>
}

function TodayPage({ profile, water, meals, dailyRecords, recordedDates, selectedDate, lastPhotoName, isMealDetailOpen, onSelectDate, onAddWater, onRemoveWater, onOpenMealDetail, onCloseMealDetail, onOpenAssistant, onAddPhoto, onAddManualMeal }: { profile: Profile; water: number; meals: Meal[]; dailyRecords: DailyRecords; recordedDates: Set<string>; selectedDate: string; lastPhotoName: string; isMealDetailOpen: boolean; onSelectDate: (date: string) => void; onAddWater: () => void; onRemoveWater: () => void; onOpenMealDetail: () => void; onCloseMealDetail: () => void; onOpenAssistant: () => void; onAddPhoto: () => void; onAddManualMeal: (meal: Meal) => void }) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [manualMealName, setManualMealName] = useState('')
  const [manualMealCalories, setManualMealCalories] = useState('')
  const [manualMealType, setManualMealType] = useState(suggestMealType)
  const [manualMealError, setManualMealError] = useState('')
  const days = useMemo(() => buildPastDays(60), [])
  const consumed = meals.reduce((total, meal) => total + meal.calories, 0)
  const caloriesLeft = profile.dailyCalories ? Math.max(profile.dailyCalories - consumed, 0) : 0
  const calorieProgress = profile.dailyCalories ? Math.min((consumed / profile.dailyCalories) * 100, 100) : 0
  const waterProgress = Math.min((water / 2500) * 100, 100)
  const mealProgress = Math.min((meals.length / Math.max(profile.mealCount || 3, 1)) * 100, 100)

  function commitManualMeal() {
    const name = manualMealName.trim()
    const calories = Number(manualMealCalories)
    if (!name) { setManualMealError('Öğün adını yazmalısın.'); return }
    onAddManualMeal({ id: createId(), type: manualMealType, name, calories: Number.isFinite(calories) && calories > 0 ? Math.round(calories) : 0 })
    setManualMealName(''); setManualMealCalories(''); setManualMealError('')
  }

  return <>
    <div className="date-toolbar"><section className="date-strip" aria-label="Tarih seçimi" dir="rtl">{days.map((date) => { const value = toDateInputValue(date); return <button className={selectedDate === value ? 'date active' : 'date'} key={value} type="button" onClick={() => onSelectDate(value)} dir="ltr" aria-label={formatHeaderDate(date)}><span>{formatShortDay(date)}</span><strong>{date.getDate()}</strong>{recordedDates.has(value) ? <i className="date-data-dot" /> : null}</button> })}</section><button className="date-picker-button" type="button" onClick={() => setIsHistoryOpen(true)} aria-label="Geçmiş günleri aç"><CalendarDays size={22} /></button></div>
    <section className="daily-hero" aria-label="Gün özeti">
      <div className="calorie-ring" style={{ '--progress': `${calorieProgress * 3.6}deg` } as CSSProperties}>
        <div><Flame size={18} /><strong>{caloriesLeft}</strong><span>kcal kaldı</span></div>
      </div>
      <div className="daily-hero-copy"><p>GÜNLÜK HEDEF</p><h2>{consumed} <span>/ {profile.dailyCalories || '--'} kcal</span></h2><small>{profile.dailyCalories ? 'Bugünkü enerji dengen' : 'Profilinden kalori hedefi belirle'}</small></div>
      <div className="daily-mini-stats">
        <div><span className="mini-stat-ring coral" style={{ '--progress': `${mealProgress * 3.6}deg` } as CSSProperties}><Utensils size={14} /></span><strong>{meals.length}/{profile.mealCount || 3}</strong><small>Öğün</small></div>
        <div><span className="mini-stat-ring blue" style={{ '--progress': `${waterProgress * 3.6}deg` } as CSSProperties}><Droplets size={14} /></span><strong>{(water / 1000).toFixed(1)} L</strong><small>Su</small></div>
        <div><span className="mini-stat-ring green" style={{ '--progress': `${calorieProgress * 3.6}deg` } as CSSProperties}><Flame size={14} /></span><strong>{Math.round(calorieProgress)}%</strong><small>Hedef</small></div>
      </div>
    </section>
    <button className="tracker-card meal-entry" type="button" onClick={onOpenMealDetail} aria-haspopup="dialog"><span className="tracker-icon"><Utensils size={22} /></span><div><p>Beslenme</p><strong>Öğün gir</strong><small>{meals.length ? `${meals.length} öğün kaydedildi` : 'Fotoğrafla veya manuel ekle'}</small></div><span className="meal-entry-plus"><Plus size={20} /></span></button>
    {isMealDetailOpen ? <div className="meal-sheet-backdrop" role="presentation" onClick={onCloseMealDetail}><section className="meal-sheet" role="dialog" aria-modal="true" aria-labelledby="meal-sheet-title" onClick={(event) => event.stopPropagation()}><div className="meal-sheet-handle" /><header className="meal-sheet-header"><div><p>Yeni kayıt</p><h2 id="meal-sheet-title">Öğün ekle</h2></div><button className="sheet-close" type="button" onClick={onCloseMealDetail} aria-label="Öğün panelini kapat"><X size={20} /></button></header><MealTypePicker value={manualMealType} onChange={setManualMealType} /><button className="photo-action" type="button" onClick={onAddPhoto}><span className="sheet-option-icon"><Camera size={22} /></span><span><strong>Fotoğrafla ekle</strong><small>{lastPhotoName || 'Kamera veya galeriden seç'}</small></span></button><div className="detail-divider"><span>Manuel giriş</span></div><form className="manual-meal-form" onSubmit={(event) => { event.preventDefault(); commitManualMeal() }}><label><span>Ne yedin?</span><input autoFocus value={manualMealName} onChange={(event) => { setManualMealName(event.target.value); setManualMealError('') }} placeholder="Örn. Tavuklu salata" /></label><label><span>Kalori <small>(isteğe bağlı)</small></span><input inputMode="numeric" min="0" type="number" value={manualMealCalories} onChange={(event) => setManualMealCalories(event.target.value)} placeholder="0" /></label>{manualMealError ? <p className="meal-form-error" role="alert">{manualMealError}</p> : null}<button className="primary-action compact" type="button" onClick={commitManualMeal}><Plus size={18} /> Öğünü kaydet</button></form></section></div> : null}
    <section className="today-meals" aria-label="Seçili günün öğünleri"><div className="section-title"><h2>Günün öğünleri</h2><span>{meals.length} kayıt</span></div>{meals.map((meal) => <MealCard key={meal.id} meal={meal} />)}{!meals.length ? <p className="empty-state">Bu tarihte öğün kaydı yok.</p> : null}</section>
    <section className="tracker-card water" aria-label="Su takibi"><span className="tracker-icon"><Droplets size={22} /></span><div className="water-summary"><p>Su takibi</p><strong>{(water / 1000).toFixed(1)} / 2.5 L</strong><div className="water-progress"><span style={{ width: `${Math.min((water / 2500) * 100, 100)}%` }} /></div></div><div className="water-actions"><button type="button" onClick={onRemoveWater} disabled={water === 0} aria-label="250 mililitre su azalt">−</button><button type="button" onClick={onAddWater} aria-label="250 mililitre su ekle">+</button><small>250 ml</small></div></section>
    <button className="food-advisor-card" type="button" onClick={onOpenAssistant}><span className="food-advisor-icon"><Sparkles size={21} /></span><span><strong>Ne yesem?</strong><small>Hedefine ve bugünkü kayıtlarına göre öneri al</small></span><ChevronRight size={20} /></button>
    {isHistoryOpen ? <HistorySheet dailyRecords={dailyRecords} selectedDate={selectedDate} onClose={() => setIsHistoryOpen(false)} onSelect={(date) => { onSelectDate(date); setIsHistoryOpen(false) }} /> : null}
  </>
}

function ProgressPage({ profile, progress, consumed, water, meals, onDeleteMeal }: { profile: Profile; progress: number; consumed: number; water: number; meals: Meal[]; onDeleteMeal: (mealId: string) => void }) {
  const [mealToDelete, setMealToDelete] = useState<Meal | null>(null)
  return <section className="page-stack"><div className="progress-hero"><p>Güncel kilon</p><h2>{profile.currentWeight || '--'} <span>kg</span></h2><div className="goal-track"><span style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} /></div><div className="goal-labels"><small>{profile.startWeight ? `${profile.startWeight} kg başlangıç` : 'Başlangıç yok'}</small><small>{profile.targetWeight ? `${profile.targetWeight} kg hedef` : 'Hedef yok'}</small></div></div><div className="stat-grid"><div><strong>{profile.startWeight && profile.currentWeight ? `${Math.max(profile.startWeight - profile.currentWeight, 0).toFixed(1)}` : '--'}</strong><span>Verilen</span></div><div><strong>{profile.currentWeight && profile.targetWeight ? `${Math.max(profile.currentWeight - profile.targetWeight, 0).toFixed(1)}` : '--'}</strong><span>Kalan</span></div><div><strong>{Math.max(0, Math.min(progress, 100))}%</strong><span>Tamamlandı</span></div></div><section className="detail-panel"><div className="section-title"><h2>Gün detayları</h2><span>{meals.length} kayıt</span></div><div className="detail-row"><span>Kalori</span><strong>{consumed} / {profile.dailyCalories || '--'} kcal</strong></div><div className="detail-row"><span>Su</span><strong>{(water / 1000).toFixed(1)} / 2.5 L</strong></div>{meals.map((meal) => <MealCard key={meal.id} meal={meal} onDelete={() => setMealToDelete(meal)} />)}{!meals.length ? <p className="empty-state">Bugün için henüz öğün kaydı yok.</p> : null}</section>{mealToDelete ? <div className="delete-meal-backdrop" role="presentation" onClick={() => setMealToDelete(null)}><section className="delete-meal-popup" role="dialog" aria-modal="true" aria-labelledby="delete-meal-title" onClick={(event) => event.stopPropagation()}><span><Trash2 size={28} /></span><h2 id="delete-meal-title">Öğün silinsin mi?</h2><p><strong>{mealToDelete.name}</strong> seçili günün kayıtlarından kaldırılacak.</p><div><button type="button" onClick={() => setMealToDelete(null)}>Vazgeç</button><button type="button" onClick={() => { onDeleteMeal(mealToDelete.id); setMealToDelete(null) }}><Trash2 size={17} /> Öğünü sil</button></div></section></div> : null}</section>
}

function AssistantPage({ profile, meals, water }: { profile: Profile; meals: Meal[]; water: number }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 'welcome', from: 'assistant', text: 'Bugünkü öğünlerin, su tüketimin ve hedeflerine göre sana uygun seçenekler sunabilirim. Ne yemek istediğini söylemen yeterli.' }])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function sendMessage(text = message) {
    const question = text.trim()
    if (!question || isLoading) return
    const userMessage: ChatMessage = { id: createId(), from: 'user', text: question }
    const conversation = [...messages, userMessage]
    setMessages(conversation)
    setMessage('')
    setIsLoading(true)
    setError('')
    try {
      const recentConversation = conversation.slice(-6).map((item) => `${item.from === 'user' ? 'Kullanıcı' : 'Asistan'}: ${item.text}`).join('\n')
      const response = await fetch('/api/ai-coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `${recentConversation}\n\nSon isteğe 3 uygulanabilir yemek seçeneğiyle yanıt ver.`, profile: { ...profile, meals, water } }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'AI koç yanıt veremedi.')
      setMessages((current) => [...current, { id: createId(), from: 'assistant', text: data.answer || 'Yanıt alınamadı.' }])
    } catch (requestError) {
      const errorMessage = requestError instanceof Error ? requestError.message : 'AI koç yanıt veremedi.'
      setError(errorMessage)
      reportException({ source: 'api', severity: 'error', message: errorMessage, stack: requestError instanceof Error ? requestError.stack : undefined, context: { action: 'askCoach' } })
    } finally { setIsLoading(false) }
  }

  return <section className="assistant-page"><div className="assistant-heading"><div><p>STAYFIT ASİSTAN</p><h2>Ne yesem?</h2></div><span><i /> Hazır</span></div><div className="suggestion-row"><button type="button" onClick={() => sendMessage('Akşam için hafif ve doyurucu ne yiyebilirim?')}>Akşam önerisi</button><button type="button" onClick={() => sendMessage('Protein ağırlıklı üç öğün öner')}>Protein ağırlıklı</button></div><div className="chat-messages" aria-live="polite">{messages.map((item) => <article className={item.from === 'user' ? 'chat-bubble user' : 'chat-bubble assistant'} key={item.id}>{item.text}</article>)}{isLoading ? <article className="chat-bubble assistant loading">Öneriler hazırlanıyor...</article> : null}</div>{error ? <div className="form-error" role="alert">{error}</div> : null}<form className="chat-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}><input aria-label="Asistana mesaj" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Bir şey sor..." /><button type="submit" disabled={!message.trim() || isLoading} aria-label="Mesaj gönder"><Send size={19} /></button></form></section>
}

function HistorySheet({ dailyRecords, selectedDate, onClose, onSelect }: { dailyRecords: DailyRecords; selectedDate: string; onClose: () => void; onSelect: (date: string) => void }) {
  return <div className="history-backdrop" role="presentation" onClick={onClose}><section className="history-sheet" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}><div className="meal-sheet-handle" /><header className="history-header"><div><h2 id="history-title">Geçmiş günler</h2><p>Son 90 günün kayıtlarını görüntüle</p></div><button type="button" onClick={onClose} aria-label="Geçmiş günleri kapat"><X size={24} /></button></header><div className="history-list">{buildPastDays(90).map((date) => { const key = toDateInputValue(date); const day = dailyRecords[key]; const calories = day?.meals.reduce((sum, meal) => sum + meal.calories, 0) || 0; return <button className={key === selectedDate ? 'history-row active' : 'history-row'} type="button" key={key} onClick={() => onSelect(key)}><span className="history-day">{date.getDate()}</span><span><strong>{formatLongDate(date)}</strong><small>{day ? `${day.meals.length} öğün · ${calories} kcal · ${(day.water / 1000).toFixed(1)} L su` : 'Kayıt bulunmuyor'}</small></span><ChevronRight size={18} /></button> })}</div></section></div>
}

function ProfilePage({ profile, onSave, onSignOut }: { profile: Profile; onSave: (profile: Profile) => void; onSignOut?: () => void }) {
  type SettingsSection = 'general' | 'mealCount' | 'calories' | 'sensitivities' | 'reminders'
  const sensitivityOptions = ['Gluten', 'Laktoz', 'Yumurta', 'Soya', 'Yer fıstığı', 'Deniz ürünleri']
  const reminderOptions = ['Su içme', 'Öğün zamanı', 'Haftalık tartılma']
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [form, setForm] = useState({ name: profile.name, height: String(profile.height || ''), startWeight: String(profile.startWeight || ''), currentWeight: String(profile.currentWeight || ''), targetWeight: String(profile.targetWeight || ''), dailyCalories: String(profile.dailyCalories || ''), mealCount: String(profile.mealCount || 3) })
  const [selectedSensitivities, setSelectedSensitivities] = useState(profile.sensitivities.filter((item) => sensitivityOptions.includes(item)))
  const [customSensitivity, setCustomSensitivity] = useState(profile.sensitivities.filter((item) => !sensitivityOptions.includes(item)).join(', '))
  const [selectedReminders, setSelectedReminders] = useState(profile.reminders || [])
  const displayName = profile.name || 'Profil'
  const bmi = profile.height && profile.currentWeight ? profile.currentWeight / Math.pow(profile.height / 100, 2) : 0
  function update(field: keyof typeof form, value: string) { setForm((current) => ({ ...current, [field]: value })) }
  function toggleItem(item: string, selected: string[], setSelected: (value: string[]) => void) { setSelected(selected.includes(item) ? selected.filter((value) => value !== item) : [...selected, item]) }
  function saveProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const manualSensitivities = customSensitivity.split(',').map((item) => item.trim()).filter(Boolean); onSave({ name: form.name.trim(), height: Number(form.height) || 0, startWeight: Number(form.startWeight) || 0, currentWeight: Number(form.currentWeight) || 0, targetWeight: Number(form.targetWeight) || 0, dailyCalories: Number(form.dailyCalories) || 0, mealCount: Number(form.mealCount) || 3, sensitivities: [...new Set([...selectedSensitivities, ...manualSensitivities])], reminders: selectedReminders }); setSettingsSection(null) }
  const sectionTitle: Record<SettingsSection, [string, string]> = { general: ['Profil ayarları', 'Kişisel bilgilerini ve hedeflerini güncelle'], mealCount: ['Günlük öğün', 'Gün içinde kaç öğün planlamak istersin?'], calories: ['Kalori hedefi', 'Günlük kalori hedefini belirle'], sensitivities: ['Hassasiyetler', 'Sana uygun olmayan besinleri seç'], reminders: ['Hatırlatıcılar', 'Almak istediğin bildirimleri seç'] }
  return <section className="profile-page"><div className="profile-page-title"><div><p>HESABIN</p><h2>Profil</h2></div><button type="button" onClick={() => setSettingsSection('general')} aria-label="Profil ayarlarını aç"><Settings size={21} /></button></div><div className="profile-identity"><div className="profile-avatar-letter">{displayName[0].toLocaleUpperCase('tr-TR')}</div><h3>{displayName}</h3><p>{profile.targetWeight ? `${profile.targetWeight} kg hedefine doğru ilerliyorsun` : 'Hedefini belirleyerek takibe başla'}</p></div><div className="profile-metrics"><div><strong>{profile.height || '--'}</strong><span>Boy · cm</span></div><div><strong>{profile.currentWeight || profile.startWeight || '--'}</strong><span>Kilo · kg</span></div><div><strong>{bmi ? bmi.toFixed(1) : '--'}</strong><span>BMI</span></div></div><h3 className="profile-plan-title">Planın</h3><div className="profile-plan-list"><ProfilePlanRow icon={<Utensils size={20} />} label="Günlük öğün" value={`${profile.mealCount || 3} öğün`} onClick={() => setSettingsSection('mealCount')} /><ProfilePlanRow icon={<Flame size={20} />} label="Kalori hedefi" value={profile.dailyCalories ? `${profile.dailyCalories} kcal` : 'Belirlenmedi'} onClick={() => setSettingsSection('calories')} /><ProfilePlanRow icon={<ShieldCheck size={20} />} label="Hassasiyetler" value={profile.sensitivities.length ? profile.sensitivities.join(', ') : 'Bulunmuyor'} onClick={() => setSettingsSection('sensitivities')} /><ProfilePlanRow icon={<Bell size={20} />} label="Hatırlatıcılar" value={profile.reminders?.length ? profile.reminders.join(', ') : 'Kapalı'} onClick={() => setSettingsSection('reminders')} /></div><div className="plus-banner"><span><Sparkles size={20} /></span><div><strong>StayFit Plus</strong><small>Kişisel analizler ve sınırsız asistan</small></div><ChevronRight size={20} /></div>{onSignOut ? <button className="sign-out-button" type="button" onClick={onSignOut}>Hesaptan çık</button> : null}{settingsSection ? <div className="profile-settings-backdrop" role="presentation" onClick={() => setSettingsSection(null)}><form className="profile-settings-sheet" onSubmit={saveProfile} onClick={(event) => event.stopPropagation()}><div className="meal-sheet-handle" /><header><div><h2>{sectionTitle[settingsSection][0]}</h2><p>{sectionTitle[settingsSection][1]}</p></div><button type="button" onClick={() => setSettingsSection(null)} aria-label="Profil ayarlarını kapat"><X size={22} /></button></header>{settingsSection === 'general' ? <div className="goal-form-grid"><label><span>Adın</span><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Adını yaz" /></label><label><span>Boy</span><input type="number" value={form.height} onChange={(event) => update('height', event.target.value)} placeholder="cm" /></label><label><span>Başlangıç kilosu</span><input type="number" step="0.1" value={form.startWeight} onChange={(event) => update('startWeight', event.target.value)} placeholder="kg" /></label><label><span>Güncel kilo</span><input type="number" step="0.1" value={form.currentWeight} onChange={(event) => update('currentWeight', event.target.value)} placeholder="kg" /></label><label><span>Hedef kilo</span><input type="number" step="0.1" value={form.targetWeight} onChange={(event) => update('targetWeight', event.target.value)} placeholder="kg" /></label></div> : null}{settingsSection === 'mealCount' ? <div className="settings-choice-grid meal-count-choices">{['2', '3', '4', '5'].map((count) => <button className={form.mealCount === count ? 'selected' : ''} type="button" key={count} onClick={() => update('mealCount', count)}><strong>{count}</strong><span>öğün</span></button>)}</div> : null}{settingsSection === 'calories' ? <div className="single-setting-field"><label><span>Günlük kalori hedefi</span><input autoFocus type="number" value={form.dailyCalories} onChange={(event) => update('dailyCalories', event.target.value)} placeholder="Örn. 1800" /></label><small>Bu değer günlük kalori özetinde kullanılacak.</small></div> : null}{settingsSection === 'sensitivities' ? <div className="sensitivity-settings"><div className="settings-choice-grid">{sensitivityOptions.map((item) => <button className={selectedSensitivities.includes(item) ? 'selected' : ''} type="button" key={item} onClick={() => toggleItem(item, selectedSensitivities, setSelectedSensitivities)}>{item}</button>)}</div><label className="manual-sensitivity"><span>Başka bir hassasiyet</span><textarea value={customSensitivity} onChange={(event) => setCustomSensitivity(event.target.value)} placeholder="Manuel olarak yaz. Birden fazlaysa virgülle ayır." rows={3} /></label></div> : null}{settingsSection === 'reminders' ? <div className="reminder-settings">{reminderOptions.map((item) => <button className={selectedReminders.includes(item) ? 'selected' : ''} type="button" key={item} onClick={() => toggleItem(item, selectedReminders, setSelectedReminders)}><span>{item}</span><i /></button>)}</div> : null}<button className="primary-action" type="submit">Değişiklikleri kaydet</button>{onSignOut ? <button className="settings-sign-out-button" type="button" onClick={onSignOut}>Hesaptan çık</button> : null}</form></div> : null}</section>
}

function ProfilePlanRow({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: string; onClick: () => void }) { return <button type="button" onClick={onClick}><span className="profile-plan-icon">{icon}</span><span><strong>{label}</strong><small>{value}</small></span><ChevronRight size={19} /></button> }
function MealTypePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <fieldset className="meal-type-picker"><legend>Hangi öğün?</legend><div>{mealTypes.map((type) => <button className={value === type ? 'selected' : ''} type="button" key={type} onClick={() => onChange(type)}>{type}</button>)}</div></fieldset> }
function MealCard({ meal, onDelete }: { meal: Meal; onDelete?: () => void }) { return <article className="meal-card"><div><p>{meal.type}</p><h3>{meal.name}</h3></div><span className="meal-card-actions"><strong>{meal.calories ? `${meal.calories} kcal` : 'Kalori girilmedi'}</strong>{onDelete ? <button type="button" onClick={onDelete} aria-label={`${meal.name} öğününü sil`} title="Öğünü sil"><Trash2 size={17} /></button> : null}</span></article> }
function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) { return <button className={active ? 'tab active' : 'tab'} type="button" onClick={onClick} aria-current={active ? 'page' : undefined}><span>{icon}</span>{label}</button> }
function buildPastDays(count: number) { const today = new Date(); return Array.from({ length: count }, (_, index) => { const date = new Date(today); date.setDate(today.getDate() - index); return date }) }
function toDateInputValue(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}` }
function parseDateInputValue(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day) }
function formatHeaderDate(date: Date) { return headerDateFormatter.format(date).toLocaleUpperCase('tr-TR') }
function formatShortDay(date: Date) { return shortDayFormatter.format(date).slice(0, 2).toLocaleUpperCase('tr-TR') }
function formatLongDate(date: Date) { const value = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }); return value.charAt(0).toLocaleUpperCase('tr-TR') + value.slice(1) }
function readSavedValue<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function loadDailyRecords(): DailyRecords {
  const existing = readSavedValue<DailyRecords>('ai-stay-fit-daily-records', {})
  if (Object.keys(existing).length) return existing

  const oldMeals = readSavedValue<Meal[]>('ai-stay-fit-meals', [])
  const oldWater = readSavedValue<number>('ai-stay-fit-water', 0)
  if (!oldMeals.length && !oldWater) return {}

  return { [toDateInputValue(new Date())]: { meals: oldMeals, water: oldWater } }
}
function writeSavedValue(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); return true } catch (error) { reportException({ source: 'client', severity: 'error', message: 'Cihaz depolamasına yazılamadı', stack: error instanceof Error ? error.stack : undefined, context: { storageKey: key } }); return false } }
function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
function suggestMealType() { const hour = new Date().getHours(); if (hour < 11) return 'Kahvaltı'; if (hour < 15) return 'Öğle yemeği'; if (hour < 18) return 'Ara öğün'; return 'Akşam yemeği' }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Fotoğraf okunamadı.')); reader.onerror = () => reject(new Error('Fotoğraf okunamadı.')); reader.readAsDataURL(file) }) }
async function prepareMealImage(file: File) {
  const source = await fileToDataUrl(file)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('Fotoğraf işlenemedi.')); element.src = source })
  const maxDimension = 2048
  const scale = Math.min(maxDimension / image.naturalWidth, maxDimension / image.naturalHeight, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Fotoğraf işlenemedi.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  let output = canvas.toDataURL('image/jpeg', 0.88)
  if (output.length > 5_000_000) output = canvas.toDataURL('image/jpeg', 0.68)
  if (output.length > 5_500_000) throw new Error('Fotoğraf analiz için hâlâ çok büyük. Daha düşük çözünürlüklü bir fotoğraf seç.')
  return output
}
export default App
