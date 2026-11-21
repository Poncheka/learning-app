# Learning App (placeholder name)

A personal iPhone app that suggests what to learn next, fits it to the minutes you have, and reads it aloud.

- `src/app/` screens (expo-router)
- `src/components/`, `src/lib/`, `src/theme.ts` shared code
- `supabase/migrations/` database changes, in order
- `supabase/functions/` edge functions. API keys live only there, as Supabase secrets, never in the app or this repo
- `scripts/` one-off scripts, such as the milestone 1 "prove the loop" script

## Run it

    npm install
    npx expo start
