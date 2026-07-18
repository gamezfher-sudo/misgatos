-- ── Cuentas vinculadas (acceso compartido entre usuarios) ─────────────────────
-- Permite que dos cuentas vean y editen los mismos datos.
-- La relación es bidireccional: al vincular se crean DOS filas.

CREATE TABLE IF NOT EXISTS public.account_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, linked_id),
  CHECK (owner_id <> linked_id)
);

ALTER TABLE public.account_links ENABLE ROW LEVEL SECURITY;

-- Solo el dueño puede ver y gestionar sus propios enlaces
CREATE POLICY "account_links_owner" ON public.account_links
  FOR ALL TO authenticated
  USING  (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ── Helper: devuelve todos los user_ids a los que el usuario actual tiene acceso ──
-- Incluye el propio uid + los owner_ids de quienes lo han vinculado.
-- SECURITY DEFINER es necesario: la función consulta account_links buscando
-- filas donde linked_id = auth.uid(), pero el RLS de esa tabla solo permite
-- ver filas donde owner_id = auth.uid(). Sin definer, la función no ve los
-- vínculos entrantes y la cuenta vinculada no puede ver los datos del dueño.
CREATE OR REPLACE FUNCTION public.accessible_owner_ids()
RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT auth.uid()
    UNION
    SELECT owner_id FROM public.account_links WHERE linked_id = auth.uid()
  )
$$;

-- ── Actualizar RLS ─────────────────────────────────────────────────────────────

-- CATS
DROP POLICY IF EXISTS cats_all ON public.cats;
CREATE POLICY cats_all ON public.cats FOR ALL TO authenticated
  USING  (user_id = ANY(public.accessible_owner_ids()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- VETERINARIANS
DROP POLICY IF EXISTS vets_all ON public.veterinarians;
CREATE POLICY vets_all ON public.veterinarians FOR ALL TO authenticated
  USING  (user_id = ANY(public.accessible_owner_ids()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- APPOINTMENTS
DROP POLICY IF EXISTS appointments_all ON public.appointments;
CREATE POLICY appointments_all ON public.appointments FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cats
    WHERE cats.id = appointments.cat_id
      AND cats.user_id = ANY(public.accessible_owner_ids())
  ));

-- CONSULTATIONS
DROP POLICY IF EXISTS consultations_all ON public.consultations;
CREATE POLICY consultations_all ON public.consultations FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cats
    WHERE cats.id = consultations.cat_id
      AND cats.user_id = ANY(public.accessible_owner_ids())
  ));

-- VACCINES
DROP POLICY IF EXISTS vaccines_all ON public.vaccines;
CREATE POLICY vaccines_all ON public.vaccines FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cats
    WHERE cats.id = vaccines.cat_id
      AND cats.user_id = ANY(public.accessible_owner_ids())
  ));

-- DEWORMINGS
DROP POLICY IF EXISTS dewormings_all ON public.dewormings;
CREATE POLICY dewormings_all ON public.dewormings FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cats
    WHERE cats.id = dewormings.cat_id
      AND cats.user_id = ANY(public.accessible_owner_ids())
  ));

-- DOCUMENTS
DROP POLICY IF EXISTS documents_all ON public.documents;
CREATE POLICY documents_all ON public.documents FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cats
    WHERE cats.id = documents.cat_id
      AND cats.user_id = ANY(public.accessible_owner_ids())
  ));

-- ── RPCs para vincular/desvincular desde la app ────────────────────────────────

-- Vincula dos cuentas de forma bidireccional.
-- Devuelve: 'ok' | 'not_found' | 'self' | 'already_linked'
CREATE OR REPLACE FUNCTION public.link_account(p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target_id uuid;
  v_me        uuid := auth.uid();
BEGIN
  SELECT id INTO v_target_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email));

  IF v_target_id IS NULL THEN RETURN 'not_found'; END IF;
  IF v_target_id = v_me    THEN RETURN 'self';      END IF;

  IF EXISTS (SELECT 1 FROM public.account_links WHERE owner_id = v_me AND linked_id = v_target_id) THEN
    RETURN 'already_linked';
  END IF;

  -- Vínculo bidireccional
  INSERT INTO public.account_links (owner_id, linked_id) VALUES (v_me, v_target_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.account_links (owner_id, linked_id) VALUES (v_target_id, v_me) ON CONFLICT DO NOTHING;

  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.link_account(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.link_account(text) TO authenticated;

-- Desvincula dos cuentas (elimina ambas direcciones).
CREATE OR REPLACE FUNCTION public.unlink_account(p_linked_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.account_links
  WHERE (owner_id = auth.uid() AND linked_id = p_linked_id)
     OR (owner_id = p_linked_id AND linked_id = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.unlink_account(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.unlink_account(uuid) TO authenticated;

-- Devuelve las cuentas vinculadas al usuario actual con su email.
CREATE OR REPLACE FUNCTION public.get_linked_accounts()
RETURNS TABLE (linked_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT al.linked_id, u.email::text
  FROM public.account_links al
  JOIN auth.users u ON u.id = al.linked_id
  WHERE al.owner_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.get_linked_accounts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_linked_accounts() TO authenticated;
