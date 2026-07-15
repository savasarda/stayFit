import { supabase } from './supabase'

export type StoredMeal = { id: string; type: string; name: string; calories: number }
export type StoredProfile = { name: string; height: number; startWeight: number; currentWeight: number; targetWeight: number; dailyCalories: number; mealCount: number; sensitivities: string[]; reminders: string[] }
export type StoredDailyRecords = Record<string, { meals: StoredMeal[]; water: number }>

function requireClient() {
  if (!supabase) throw new Error('Supabase bağlantısı yapılandırılmamış.')
  return supabase
}

export async function loadUserData(userId: string, fallbackProfile: StoredProfile) {
  const client = requireClient()
  const [profileResult, mealsResult, waterResult] = await Promise.all([
    client.from('profiles').select('id,full_name,height_cm,start_weight_kg,current_weight_kg,target_weight_kg,daily_calories,meal_count,sensitivities,reminders').eq('id', userId).maybeSingle(),
    client.from('meals').select('id,meal_date,meal_type,food_name,calories,created_at').eq('user_id', userId).order('meal_date', { ascending: false }),
    client.from('daily_water').select('water_date,amount_ml').eq('user_id', userId).order('water_date', { ascending: false }),
  ])

  const firstError = profileResult.error || mealsResult.error || waterResult.error
  if (firstError) throw firstError

  const row = profileResult.data
  const profile: StoredProfile = row ? {
    name: row.full_name || '',
    height: Number(row.height_cm) || 0,
    startWeight: Number(row.start_weight_kg) || 0,
    currentWeight: Number(row.current_weight_kg) || 0,
    targetWeight: Number(row.target_weight_kg) || 0,
    dailyCalories: Number(row.daily_calories) || 0,
    mealCount: Number(row.meal_count) || 3,
    sensitivities: Array.isArray(row.sensitivities) ? row.sensitivities : [],
    reminders: Array.isArray(row.reminders) ? row.reminders : [],
  } : fallbackProfile

  const dailyRecords: StoredDailyRecords = {}
  for (const meal of mealsResult.data || []) {
    const date = meal.meal_date
    if (!dailyRecords[date]) dailyRecords[date] = { meals: [], water: 0 }
    dailyRecords[date].meals.push({ id: meal.id, type: meal.meal_type, name: meal.food_name, calories: Number(meal.calories) || 0 })
  }
  for (const water of waterResult.data || []) {
    const date = water.water_date
    if (!dailyRecords[date]) dailyRecords[date] = { meals: [], water: 0 }
    dailyRecords[date].water = Number(water.amount_ml) || 0
  }

  return { profile, dailyRecords, hasProfile: Boolean(row) }
}

export async function saveUserProfile(userId: string, profile: StoredProfile) {
  const client = requireClient()
  const { error } = await client.from('profiles').upsert({
    id: userId,
    full_name: profile.name,
    height_cm: profile.height || null,
    start_weight_kg: profile.startWeight || null,
    current_weight_kg: profile.currentWeight || null,
    target_weight_kg: profile.targetWeight || null,
    daily_calories: profile.dailyCalories || null,
    meal_count: profile.mealCount || 3,
    sensitivities: profile.sensitivities,
    reminders: profile.reminders,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error

  await client.from('goals').delete().eq('user_id', userId).in('goal_type', ['daily_calories', 'target_weight', 'meal_count'])
  const goals = [
    profile.dailyCalories ? { user_id: userId, goal_type: 'daily_calories', target_value: profile.dailyCalories, current_value: 0, unit: 'kcal' } : null,
    profile.targetWeight ? { user_id: userId, goal_type: 'target_weight', target_value: profile.targetWeight, current_value: profile.currentWeight || null, unit: 'kg' } : null,
    { user_id: userId, goal_type: 'meal_count', target_value: profile.mealCount || 3, current_value: 0, unit: 'öğün' },
  ].filter((goal): goal is NonNullable<typeof goal> => goal !== null)
  const { error: goalError } = await client.from('goals').insert(goals)
  if (goalError) throw goalError
}

export async function createUserMeal(userId: string, date: string, meal: Omit<StoredMeal, 'id'>) {
  const client = requireClient()
  const { data, error } = await client.from('meals').insert({ user_id: userId, meal_date: date, meal_type: meal.type, food_name: meal.name, calories: meal.calories }).select('id').single()
  if (error) throw error
  return { ...meal, id: data.id } as StoredMeal
}

export async function removeUserMeal(userId: string, mealId: string) {
  const client = requireClient()
  const { error } = await client.from('meals').delete().eq('id', mealId).eq('user_id', userId)
  if (error) throw error
}

export async function saveUserWater(userId: string, date: string, amount: number) {
  const client = requireClient()
  const { error } = await client.from('daily_water').upsert({ user_id: userId, water_date: date, amount_ml: amount, updated_at: new Date().toISOString() }, { onConflict: 'user_id,water_date' })
  if (error) throw error
}

export async function migrateLocalData(userId: string, profile: StoredProfile, dailyRecords: StoredDailyRecords) {
  await saveUserProfile(userId, profile)
  const client = requireClient()
  const meals = Object.entries(dailyRecords).flatMap(([date, record]) => record.meals.map((meal) => ({ user_id: userId, meal_date: date, meal_type: meal.type, food_name: meal.name, calories: meal.calories })))
  const waters = Object.entries(dailyRecords).filter(([, record]) => record.water > 0).map(([date, record]) => ({ user_id: userId, water_date: date, amount_ml: record.water }))
  if (meals.length) { const { error } = await client.from('meals').insert(meals); if (error) throw error }
  if (waters.length) { const { error } = await client.from('daily_water').upsert(waters, { onConflict: 'user_id,water_date' }); if (error) throw error }
}
