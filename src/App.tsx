import { isSupabaseConfigured } from './lib/supabase'
import './style.css'

function App() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">AI Stay Fit</p>
        <h1>Supabase bağlantısı hazır</h1>
        <p>
          Proje artık Supabase client kullanacak şekilde ayarlandı. Ortam
          değişkenlerini eklediğinde kullanıcı, ölçüm, antrenman ve beslenme
          verilerini database tarafına yazmaya başlayabiliriz.
        </p>

        <div className={isSupabaseConfigured ? 'status ok' : 'status warning'}>
          <span>{isSupabaseConfigured ? 'Bağlandı' : 'Env bekleniyor'}</span>
          <strong>
            {isSupabaseConfigured
              ? 'VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY bulundu.'
              : '.env dosyasına Supabase URL ve anon key eklenmeli.'}
          </strong>
        </div>
      </section>
    </main>
  )
}

export default App
