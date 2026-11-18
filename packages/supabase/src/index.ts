// The Card and Settings stores on Supabase Postgres, shared by the app and
// the KIM connector. Each acts as whoever the given client is signed in as:
// row level security scopes every query to that Account.
export { supabaseCardStore } from "./cardStore";
export { supabaseSettingsStore } from "./settingsStore";
