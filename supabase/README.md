# Supabase database setup

1. **Create a project** at [supabase.com](https://supabase.com).

2. **Run the schema**  
   In Dashboard → SQL Editor, run the contents of `schema.sql` to create the `schools` table and policies.

3. **Get API keys**  
   In Project Settings → API copy:
   - Project URL → `VITE_SUPABASE_URL`
   - anon public key → `VITE_SUPABASE_ANON_KEY`

4. **Configure the app**  
   Copy `.env.example` to `.env` in the project root and set:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

5. **Run the app**  
   Restart the dev server (`npm run dev`). Data will load from and save to Supabase.  
   If `.env` is missing or keys are empty, the app runs in local-only mode (no database).

## Table: `schools`

| Column      | Type   | Description                    |
|------------|--------|--------------------------------|
| id         | text   | Primary key (e.g. from app)    |
| name       | text   | School name                    |
| settings   | jsonb  | Classes, staff, options, etc.  |
| students   | jsonb  | Student records                |
| timetable  | jsonb  | Period assignments per class   |
| exam_tm    | jsonb  | Total marks (for future use)   |
| exam_om    | jsonb  | Obtained marks (for future use)|
| created_at | timestamptz | Set on insert            |
| updated_at | timestamptz | Set on update            |
