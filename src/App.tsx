import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bot,
  CalendarDays,
  Camera,
  ChartNoAxesColumnIncreasing,
  Droplets,
  Flame,
  Plus,
  Sparkles,
  Utensils,
  User,
} from 'lucide-react'
import './style.css'

type OpenAIStatus = {
  configured: boolean
  model: string
}

type Tab = 'today' | 'progress' | 'assistant' | 'profile'

type Meal = {
  id: string
  type: string
  name: string
  calories: number
}

const initialMeals: Meal[] = []

const profile = {
  name: '',
  height: 0,
  startWeight: 0,
  currentWeight: 0,
  targetWeight: 0,
  dailyCalories: 0,
  mealCount: 0,
}

const shortDayFormatter = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' })
const headerDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
})

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('today')
  const [meals, setMeals] = useState(initialMeals)
  const [water, setWater] = useState(0)
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()))
  const [lastPhotoName, setLastPhotoName] = useState('')
  const [openAIStatus, setOpenAIStatus] = useState<OpenAIStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedDateObject = useMemo(() => parseDateInputValue(selectedDate), [selectedDate])
  const consumed = useMemo(
    () => meals.reduce((total, meal) => total + meal.calories, 0),
    [meals],
  )
  const progress =
    profile.startWeight && profile.targetWeight
      ? Math.round(
          ((profile.startWeight - profile.currentWeight) / (profile.startWeight - profile.targetWeight)) * 100,
        )
      : 0

  useEffect(() => {
    fetch('/api/openai-status')
      .then((response) => response.json())
      .then((data: OpenAIStatus) => setOpenAIStatus(data))
      .catch(() => setOpenAIStatus({ configured: false, model: 'Bilinmiyor' }))
  }, [])

  function openCamera() {
    fileInputRef.current?.click()
  }

  function addMealFromCamera(file: File) {
    setLastPhotoName(file.name)
    setMeals((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: 'Yeni öğün',
        name: 'Fotoğraftan eklendi',
        calories: 0,
      },
    ])
    setActiveTab('today')
  }

  return (
    <main className="app-shell">
      <section className="phone-shell">
        <header className="app-header">
          <div>
            <p>{formatHeaderDate(selectedDateObject)}</p>
            <h1>{activeTab === 'today' ? 'Günaydın' : pageTitle(activeTab)}</h1>
          </div>
          <div className="header-actions">
            {openAIStatus?.configured ? (
              <span className="openai-dot" aria-label="OpenAI API aktif" />
            ) : null}
            <button className="avatar" type="button" onClick={() => setActiveTab('profile')}>
              <User size={20} strokeWidth={2.4} />
            </button>
          </div>
        </header>

        <div className="screen">
          {activeTab === 'today' ? (
            <TodayPage
              water={water}
              meals={meals}
              selectedDate={selectedDate}
              lastPhotoName={lastPhotoName}
              onSelectDate={setSelectedDate}
              onAddWater={() => setWater((value) => Math.min(value + 250, 5000))}
              onAddMeal={openCamera}
            />
          ) : null}
          {activeTab === 'progress' ? (
            <ProgressPage progress={progress} consumed={consumed} water={water} meals={meals} />
          ) : null}
          {activeTab === 'assistant' ? <AssistantPage /> : null}
          {activeTab === 'profile' ? <ProfilePage /> : null}
        </div>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) addMealFromCamera(file)
            event.currentTarget.value = ''
          }}
        />

        <nav className="tab-bar" aria-label="Alt menü">
          <TabButton
            active={activeTab === 'today'}
            icon={<CalendarDays size={23} strokeWidth={2.3} />}
            label="Takvim"
            onClick={() => setActiveTab('today')}
          />
          <TabButton
            active={activeTab === 'progress'}
            icon={<ChartNoAxesColumnIncreasing size={23} strokeWidth={2.3} />}
            label="İlerleme"
            onClick={() => setActiveTab('progress')}
          />
          <button className="camera-button" type="button" onClick={openCamera} aria-label="Kamera ile öğün ekle">
            <Camera size={27} strokeWidth={2.4} />
          </button>
          <TabButton
            active={activeTab === 'assistant'}
            icon={<Bot size={23} strokeWidth={2.3} />}
            label="Koç"
            onClick={() => setActiveTab('assistant')}
          />
          <TabButton
            active={activeTab === 'profile'}
            icon={<User size={23} strokeWidth={2.3} />}
            label="Profil"
            onClick={() => setActiveTab('profile')}
          />
        </nav>
      </section>
    </main>
  )
}

function TodayPage({
  water,
  meals,
  selectedDate,
  lastPhotoName,
  onSelectDate,
  onAddWater,
  onAddMeal,
}: {
  water: number
  meals: Meal[]
  selectedDate: string
  lastPhotoName: string
  onSelectDate: (date: string) => void
  onAddWater: () => void
  onAddMeal: () => void
}) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const days = useMemo(() => buildPastDays(60), [])
  const consumed = meals.reduce((total, meal) => total + meal.calories, 0)
  const caloriesLeft = profile.dailyCalories ? Math.max(profile.dailyCalories - consumed, 0) : 0

  function openDatePicker() {
    const input = dateInputRef.current
    if (!input) return

    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }

    input.click()
  }

  return (
    <>
      <div className="date-toolbar">
        <section className="date-strip" aria-label="Tarih seçimi" dir="rtl">
          {days.map((date) => {
            const value = toDateInputValue(date)
            return (
              <button
                className={selectedDate === value ? 'date active' : 'date'}
                key={value}
                type="button"
                onClick={() => onSelectDate(value)}
                dir="ltr"
              >
                <span>{formatShortDay(date)}</span>
                <strong>{date.getDate()}</strong>
              </button>
            )
          })}
        </section>

        <button className="date-picker-button" type="button" onClick={openDatePicker} aria-label="Manuel tarih seç">
          <CalendarDays size={22} strokeWidth={2.4} />
          <input
            ref={dateInputRef}
            className="date-native-input"
            type="date"
            value={selectedDate}
            max={toDateInputValue(new Date())}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSelectDate(event.target.value)}
            aria-label="Tarih seç"
          />
        </button>
      </div>

      <section className="daily-hero" aria-label="Gün özeti">
        <div>
          <p>Bugünün odağı</p>
          <h2>{profile.dailyCalories ? `${caloriesLeft} kcal kaldı` : 'Hedef bekleniyor'}</h2>
          <span>İlk öğününü veya profil hedefini ekle</span>
        </div>
        <div className="hero-metric">
          <Flame size={22} />
          <strong>{consumed}</strong>
          <small>alındı</small>
        </div>
      </section>

      <button className="tracker-card dark" type="button" onClick={onAddMeal}>
        <span className="tracker-icon"><Utensils size={22} /></span>
        <div>
          <p>Öğün gir</p>
          <strong>Kamera ile öğün ekle</strong>
          <small>{lastPhotoName || (meals.length ? `${meals.length} öğün kaydı var` : 'Henüz öğün yok')}</small>
        </div>
        <Plus size={18} />
      </button>

      <button className="tracker-card water" type="button" onClick={onAddWater}>
        <span className="tracker-icon"><Droplets size={22} /></span>
        <div>
          <p>Su gir</p>
          <strong>{(water / 1000).toFixed(1)} / 2.5 L</strong>
          <div className="water-progress">
            <span style={{ width: `${Math.min((water / 2500) * 100, 100)}%` }} />
          </div>
        </div>
        <b>+250 ml</b>
      </button>
    </>
  )
}

function ProgressPage({
  progress,
  consumed,
  water,
  meals,
}: {
  progress: number
  consumed: number
  water: number
  meals: Meal[]
}) {
  return (
    <section className="page-stack">
      <div className="progress-hero">
        <p>Güncel kilon</p>
        <h2>{profile.currentWeight ? profile.currentWeight : '--'} <span>kg</span></h2>
        <div className="goal-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="goal-labels">
          <small>{profile.startWeight ? `${profile.startWeight} kg başlangıç` : 'Başlangıç yok'}</small>
          <small>{profile.targetWeight ? `${profile.targetWeight} kg hedef` : 'Hedef yok'}</small>
        </div>
      </div>

      <div className="stat-grid">
        <div><strong>--</strong><span>Verilen</span></div>
        <div><strong>--</strong><span>Kalan</span></div>
        <div><strong>{progress}%</strong><span>Tamamlandı</span></div>
      </div>

      <section className="detail-panel">
        <div className="section-title">
          <h2>Gün detayları</h2>
          <span>{meals.length} kayıt</span>
        </div>
        <div className="detail-row"><span>Kalori</span><strong>{consumed} / {profile.dailyCalories || '--'} kcal</strong></div>
        <div className="detail-row"><span>Su</span><strong>{(water / 1000).toFixed(1)} / 2.5 L</strong></div>
        {meals.map((meal) => (
          <article className="meal-card" key={meal.id}>
            <div>
              <p>{meal.type}</p>
              <h3>{meal.name}</h3>
            </div>
            <strong>{meal.calories ? `${meal.calories} kcal` : 'Analiz bekliyor'}</strong>
          </article>
        ))}
        {meals.length === 0 ? <p className="empty-state">Bugün için henüz öğün kaydı yok.</p> : null}
      </section>
    </section>
  )
}

function AssistantPage() {
  return (
    <section className="page-stack">
      <div className="coach-message">
        <Sparkles size={22} />
        <p>Merhaba. Bugün öğün, su ve kalori durumuna göre öneri alabilirsin.</p>
      </div>
      <button className="primary-action" type="button">AI önerisi al</button>
    </section>
  )
}

function ProfilePage() {
  return (
    <section className="page-stack">
      <div className="profile-card">
        <div className="large-avatar"><User size={30} strokeWidth={2.4} /></div>
        <h2>Profilini tamamla</h2>
        <p>Hedeflerini eklediğinde takip ekranı kişiselleşir</p>
      </div>
      <div className="profile-list">
        <ProfileRow label="Günlük öğün" value={profile.mealCount ? `${profile.mealCount} öğün` : '--'} />
        <ProfileRow label="Kalori hedefi" value={profile.dailyCalories ? `${profile.dailyCalories} kcal` : '--'} />
        <ProfileRow label="Boy" value={profile.height ? `${profile.height} cm` : '--'} />
      </div>
    </section>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return <div className="profile-row"><span>{label}</span><strong>{value}</strong></div>
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className={active ? 'tab active' : 'tab'} type="button" onClick={onClick}>
      <span>{icon}</span>
      {label}
    </button>
  )
}

function buildPastDays(count: number) {
  const today = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - index)
    return date
  })
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInputValue(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatHeaderDate(date: Date) {
  return headerDateFormatter.format(date).toLocaleUpperCase('tr-TR')
}

function formatShortDay(date: Date) {
  return shortDayFormatter.format(date).slice(0, 2).toLocaleUpperCase('tr-TR')
}

function pageTitle(tab: Tab) {
  if (tab === 'progress') return 'İlerleme'
  if (tab === 'assistant') return 'AI Koç'
  if (tab === 'profile') return 'Profil'
  return 'Bugün'
}

export default App
