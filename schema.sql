-- ============================================================
-- MisGatos - Sistema de Control Veterinario
-- Ejecuta este SQL en: https://supabase.com/dashboard/project/ryjmssfihczyooumwdxs/sql/new
-- ============================================================

-- Extensión UUID
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLA: gatos
-- ============================================================
create table if not exists public.cats (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  name          text not null,
  breed         text,
  birthdate     date,
  gender        text check (gender in ('macho', 'hembra')),
  color         text,
  weight        decimal(5,2),
  microchip     text,
  photo_url     text,
  is_sterilized boolean default false,
  blood_type    text,
  allergies     text,
  notes         text,
  created_at    timestamptz default now()
);

alter table public.cats enable row level security;

create policy "cats_all" on public.cats for all to authenticated
  using  ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ============================================================
-- TABLA: veterinarios
-- ============================================================
create table if not exists public.veterinarians (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  name         text not null,
  clinic_name  text,
  phone        text,
  email        text,
  address      text,
  city         text,
  schedule     text,
  notes        text,
  created_at   timestamptz default now()
);

alter table public.veterinarians enable row level security;

create policy "vets_all" on public.veterinarians for all to authenticated
  using  ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ============================================================
-- TABLA: gato <-> veterinario (muchos a muchos)
-- ============================================================
create table if not exists public.cat_veterinarians (
  cat_id     uuid references public.cats(id) on delete cascade,
  vet_id     uuid references public.veterinarians(id) on delete cascade,
  is_primary boolean default false,
  primary key (cat_id, vet_id)
);

alter table public.cat_veterinarians enable row level security;

create policy "cat_vets_all" on public.cat_veterinarians for all to authenticated
  using (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  );

-- ============================================================
-- TABLA: citas
-- ============================================================
create table if not exists public.appointments (
  id               uuid primary key default uuid_generate_v4(),
  cat_id           uuid references public.cats(id) on delete cascade not null,
  vet_id           uuid references public.veterinarians(id) on delete set null,
  appointment_date date not null,
  appointment_time time not null,
  reason           text,
  status           text default 'pendiente' check (status in ('pendiente', 'completada', 'cancelada')),
  notes            text,
  created_at       timestamptz default now()
);

alter table public.appointments enable row level security;

create policy "appointments_all" on public.appointments for all to authenticated
  using (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  );

-- ============================================================
-- TABLA: consultas médicas
-- ============================================================
create table if not exists public.consultations (
  id              uuid primary key default uuid_generate_v4(),
  cat_id          uuid references public.cats(id) on delete cascade not null,
  vet_id          uuid references public.veterinarians(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  visit_date      date not null,
  reason          text,
  diagnosis       text,
  treatment       text,
  weight_at_visit decimal(5,2),
  temperature     decimal(4,1),
  notes           text,
  follow_up_date  date,
  created_at      timestamptz default now()
);

alter table public.consultations enable row level security;

create policy "consultations_all" on public.consultations for all to authenticated
  using (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  );

-- ============================================================
-- TABLA: vacunas
-- ============================================================
create table if not exists public.vaccines (
  id              uuid primary key default uuid_generate_v4(),
  cat_id          uuid references public.cats(id) on delete cascade not null,
  vet_id          uuid references public.veterinarians(id) on delete set null,
  consultation_id uuid references public.consultations(id) on delete set null,
  vaccine_name    text not null,
  vaccine_brand   text,
  batch_number    text,
  date_applied    date not null,
  next_due_date   date,
  notes           text,
  created_at      timestamptz default now()
);

alter table public.vaccines enable row level security;

create policy "vaccines_all" on public.vaccines for all to authenticated
  using (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  );

-- ============================================================
-- TABLA: desparasitaciones
-- ============================================================
create table if not exists public.dewormings (
  id              uuid primary key default uuid_generate_v4(),
  cat_id          uuid references public.cats(id) on delete cascade not null,
  vet_id          uuid references public.veterinarians(id) on delete set null,
  consultation_id uuid references public.consultations(id) on delete set null,
  product_name    text not null,
  type            text check (type in ('interno', 'externo', 'ambos')),
  date_applied    date not null,
  next_due_date   date,
  dose            text,
  notes           text,
  created_at      timestamptz default now()
);

alter table public.dewormings enable row level security;

create policy "dewormings_all" on public.dewormings for all to authenticated
  using (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  );

-- ============================================================
-- TABLA: documentos (recetas, análisis, rayos X)
-- ============================================================
create table if not exists public.documents (
  id              uuid primary key default uuid_generate_v4(),
  cat_id          uuid references public.cats(id) on delete cascade not null,
  consultation_id uuid references public.consultations(id) on delete set null,
  type            text check (type in ('receta', 'analisis', 'rayos_x', 'otro')),
  title           text not null,
  file_url        text,
  file_type       text,
  date_issued     date,
  notes           text,
  created_at      timestamptz default now()
);

alter table public.documents enable row level security;

create policy "documents_all" on public.documents for all to authenticated
  using (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  )
  with check (
    exists (select 1 from public.cats where id = cat_id and user_id = (select auth.uid()))
  );

-- ============================================================
-- STORAGE BUCKETS
-- Crear manualmente en: Storage > New bucket
-- 1. "cat-photos"   → público
-- 2. "medical-docs" → privado (solo autenticados)
-- ============================================================

-- Política storage cat-photos (público lectura, auth escritura)
insert into storage.buckets (id, name, public) values ('cat-photos', 'cat-photos', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('medical-docs', 'medical-docs', false)
  on conflict (id) do nothing;

create policy "cat_photos_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'cat-photos');

create policy "cat_photos_read" on storage.objects for select to anon
  using (bucket_id = 'cat-photos');

create policy "cat_photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'cat-photos');

create policy "medical_docs_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'medical-docs');

create policy "medical_docs_read" on storage.objects for select to authenticated
  using (bucket_id = 'medical-docs');

create policy "medical_docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'medical-docs');
