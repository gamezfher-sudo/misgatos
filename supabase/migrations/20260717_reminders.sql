-- Habilitar pg_cron
create extension if not exists pg_cron;
grant usage on schema cron to postgres;

-- Tabla para evitar envíos duplicados
create table if not exists public.reminder_log (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  days_before    integer not null,
  sent_to        text not null,
  sent_at        timestamptz not null default now(),
  unique (appointment_id, days_before)
);

alter table public.reminder_log enable row level security;
-- Solo lectura interna (service role), el usuario no necesita acceder directo
create policy "sin acceso publico" on public.reminder_log for all using (false);

-- Función helper que devuelve la fecha objetivo
create or replace function public.get_target_date(days_offset integer)
returns text
language sql
security invoker
as $$
  select (current_date + (days_offset || ' days')::interval)::date::text;
$$;

-- Cron: ejecutar la Edge Function todos los días a las 13:00 UTC (7am hora Ciudad de México)
-- IMPORTANTE: reemplaza <PROJECT_REF> con tu project ref de Supabase y <SERVICE_ROLE_KEY> con tu service role key
-- Esto se configura manualmente en el dashboard de Supabase > Database > Cron Jobs
-- O bien ejecuta el siguiente cron una vez conectado:

/*
select cron.schedule(
  'send-appointment-reminders',
  '0 13 * * *',
  $$
    select net.http_post(
      url := 'https://ryjmssfihczyooumwdxs.supabase.co/functions/v1/send-reminders',
      headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
*/
