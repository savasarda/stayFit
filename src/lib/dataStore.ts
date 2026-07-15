import { supabase } from "./supabase";

export type StoredMeal = {
  id: string;
  type: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  favorite?: boolean;
};
export type StoredProfile = {
  name: string;
  height: number;
  startWeight: number;
  currentWeight: number;
  targetWeight: number;
  dailyCalories: number;
  mealCount: number;
  sensitivities: string[];
  reminders: string[];
  coachMemory: string[];
};
export type StoredDailyRecords = Record<
  string,
  { meals: StoredMeal[]; water: number }
>;
export type StoredAssistantMessage = {
  id: string;
  from: "user" | "assistant";
  text: string;
  createdAt?: string;
};

function requireClient() {
  if (!supabase) throw new Error("Supabase bağlantısı yapılandırılmamış.");
  return supabase;
}

export async function loadUserData(
  userId: string,
  fallbackProfile: StoredProfile,
) {
  const client = requireClient();
  const [profileResult, mealsResult, waterResult, assistantResult] =
    await Promise.all([
      client
        .from("profiles")
        .select(
          "id,full_name,height_cm,start_weight_kg,current_weight_kg,target_weight_kg,daily_calories,meal_count,sensitivities,reminders,coach_memory",
        )
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("meals")
        .select(
          "id,meal_date,meal_type,food_name,calories,protein_g,carbs_g,fat_g,is_favorite,created_at",
        )
        .eq("user_id", userId)
        .order("meal_date", { ascending: false }),
      client
        .from("daily_water")
        .select("water_date,amount_ml")
        .eq("user_id", userId)
        .order("water_date", { ascending: false }),
      client
        .from("assistant_messages")
        .select("id,sender,message_text,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(200),
    ]);

  const firstError =
    profileResult.error ||
    mealsResult.error ||
    waterResult.error ||
    assistantResult.error;
  if (firstError) throw firstError;

  const row = profileResult.data;
  const profile: StoredProfile = row
    ? {
        name: row.full_name || "",
        height: Number(row.height_cm) || 0,
        startWeight: Number(row.start_weight_kg) || 0,
        currentWeight: Number(row.current_weight_kg) || 0,
        targetWeight: Number(row.target_weight_kg) || 0,
        dailyCalories: Number(row.daily_calories) || 0,
        mealCount: Number(row.meal_count) || 3,
        sensitivities: Array.isArray(row.sensitivities)
          ? row.sensitivities
          : [],
        reminders: Array.isArray(row.reminders) ? row.reminders : [],
        coachMemory: Array.isArray(row.coach_memory) ? row.coach_memory : [],
      }
    : fallbackProfile;

  const dailyRecords: StoredDailyRecords = {};
  for (const meal of mealsResult.data || []) {
    const date = meal.meal_date;
    if (!dailyRecords[date]) dailyRecords[date] = { meals: [], water: 0 };
    dailyRecords[date].meals.push({
      id: meal.id,
      type: meal.meal_type,
      name: meal.food_name,
      calories: Number(meal.calories) || 0,
      protein: Number(meal.protein_g) || 0,
      carbs: Number(meal.carbs_g) || 0,
      fat: Number(meal.fat_g) || 0,
      favorite: Boolean(meal.is_favorite),
    });
  }
  for (const water of waterResult.data || []) {
    const date = water.water_date;
    if (!dailyRecords[date]) dailyRecords[date] = { meals: [], water: 0 };
    dailyRecords[date].water = Number(water.amount_ml) || 0;
  }

  const assistantMessages: StoredAssistantMessage[] = (
    assistantResult.data || []
  ).map((message) => ({
    id: message.id,
    from: message.sender === "user" ? "user" : "assistant",
    text: message.message_text,
    createdAt: message.created_at,
  }));

  return { profile, dailyRecords, assistantMessages, hasProfile: Boolean(row) };
}

export async function saveUserProfile(userId: string, profile: StoredProfile) {
  const client = requireClient();
  const { error } = await client.from("profiles").upsert({
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
    coach_memory: profile.coachMemory,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  await client
    .from("goals")
    .delete()
    .eq("user_id", userId)
    .in("goal_type", ["daily_calories", "target_weight", "meal_count"]);
  const goals = [
    profile.dailyCalories
      ? {
          user_id: userId,
          goal_type: "daily_calories",
          target_value: profile.dailyCalories,
          current_value: 0,
          unit: "kcal",
        }
      : null,
    profile.targetWeight
      ? {
          user_id: userId,
          goal_type: "target_weight",
          target_value: profile.targetWeight,
          current_value: profile.currentWeight || null,
          unit: "kg",
        }
      : null,
    {
      user_id: userId,
      goal_type: "meal_count",
      target_value: profile.mealCount || 3,
      current_value: 0,
      unit: "öğün",
    },
  ].filter((goal): goal is NonNullable<typeof goal> => goal !== null);
  const { error: goalError } = await client.from("goals").insert(goals);
  if (goalError) throw goalError;
}

export async function createUserMeal(
  userId: string,
  date: string,
  meal: Omit<StoredMeal, "id">,
) {
  const client = requireClient();
  const { data, error } = await client
    .from("meals")
    .insert({
      user_id: userId,
      meal_date: date,
      meal_type: meal.type,
      food_name: meal.name,
      calories: meal.calories,
      protein_g: meal.protein || 0,
      carbs_g: meal.carbs || 0,
      fat_g: meal.fat || 0,
      is_favorite: meal.favorite || false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { ...meal, id: data.id } as StoredMeal;
}

export async function removeUserMeal(userId: string, mealId: string) {
  const client = requireClient();
  const { error } = await client
    .from("meals")
    .delete()
    .eq("id", mealId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function setUserMealFavorite(
  userId: string,
  mealId: string,
  favorite: boolean,
) {
  const client = requireClient();
  const { error } = await client
    .from("meals")
    .update({ is_favorite: favorite })
    .eq("id", mealId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function saveUserWater(
  userId: string,
  date: string,
  amount: number,
) {
  const client = requireClient();
  const { error } = await client
    .from("daily_water")
    .upsert(
      {
        user_id: userId,
        water_date: date,
        amount_ml: amount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,water_date" },
    );
  if (error) throw error;
}

export async function createUserAssistantMessage(
  userId: string,
  message: Omit<StoredAssistantMessage, "id" | "createdAt">,
) {
  const client = requireClient();
  const { data, error } = await client
    .from("assistant_messages")
    .insert({
      user_id: userId,
      sender: message.from,
      message_text: message.text,
    })
    .select("id,created_at")
    .single();
  if (error) throw error;
  return {
    ...message,
    id: data.id,
    createdAt: data.created_at,
  } as StoredAssistantMessage;
}

export async function migrateLocalData(
  userId: string,
  profile: StoredProfile,
  dailyRecords: StoredDailyRecords,
  assistantMessages: StoredAssistantMessage[] = [],
) {
  await saveUserProfile(userId, profile);
  const client = requireClient();
  const meals = Object.entries(dailyRecords).flatMap(([date, record]) =>
    record.meals.map((meal) => ({
      user_id: userId,
      meal_date: date,
      meal_type: meal.type,
      food_name: meal.name,
      calories: meal.calories,
      protein_g: meal.protein || 0,
      carbs_g: meal.carbs || 0,
      fat_g: meal.fat || 0,
      is_favorite: meal.favorite || false,
    })),
  );
  const waters = Object.entries(dailyRecords)
    .filter(([, record]) => record.water > 0)
    .map(([date, record]) => ({
      user_id: userId,
      water_date: date,
      amount_ml: record.water,
    }));
  const messages = assistantMessages.map((message) => ({
    user_id: userId,
    sender: message.from,
    message_text: message.text,
    created_at: message.createdAt || new Date().toISOString(),
  }));
  if (meals.length) {
    const { error } = await client.from("meals").insert(meals);
    if (error) throw error;
  }
  if (waters.length) {
    const { error } = await client
      .from("daily_water")
      .upsert(waters, { onConflict: "user_id,water_date" });
    if (error) throw error;
  }
  if (messages.length) {
    const { error } = await client.from("assistant_messages").insert(messages);
    if (error) throw error;
  }
}
