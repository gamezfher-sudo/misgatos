-- Ampliar reminder_log para vacunas y desparasitaciones

-- Hacer appointment_id nullable
ALTER TABLE public.reminder_log
  ALTER COLUMN appointment_id DROP NOT NULL;

-- Agregar columnas para vacunas y desparasitaciones
ALTER TABLE public.reminder_log
  ADD COLUMN IF NOT EXISTS vaccine_id    uuid REFERENCES public.vaccines(id)    ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS deworming_id  uuid REFERENCES public.dewormings(id)  ON DELETE CASCADE;

-- Constraint: exactamente uno de los tres IDs debe estar presente
ALTER TABLE public.reminder_log
  ADD CONSTRAINT reminder_log_one_entity CHECK (
    (CASE WHEN appointment_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN vaccine_id     IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN deworming_id   IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Eliminar unique anterior y reemplazar con uno que cubra los tres tipos
ALTER TABLE public.reminder_log
  DROP CONSTRAINT IF EXISTS reminder_log_appointment_id_days_before_key;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_apt_days
  ON public.reminder_log (appointment_id, days_before)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_vac_days
  ON public.reminder_log (vaccine_id, days_before)
  WHERE vaccine_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_dew_days
  ON public.reminder_log (deworming_id, days_before)
  WHERE deworming_id IS NOT NULL;
