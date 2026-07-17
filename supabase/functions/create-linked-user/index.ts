import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  // Verificar que el request viene de un usuario autenticado
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  const sb        = createClient(SUPABASE_URL, SERVICE_KEY)
  const sbCaller  = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: authHeader } },
  })

  // Obtener el usuario que hace la solicitud
  const { data: { user: caller }, error: callerErr } = await sbCaller.auth.getUser()
  if (callerErr || !caller) {
    return json({ error: 'unauthorized' }, 401)
  }

  const { email, password, first_name, phone } = await req.json()

  if (!email || !password) {
    return json({ error: 'missing_fields' }, 400)
  }

  // Crear la cuenta nueva
  const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: first_name || '', phone: phone || '' },
  })

  if (createErr) {
    const msg = createErr.message?.includes('already registered')
      ? 'email_taken'
      : 'create_error'
    return json({ error: msg }, 400)
  }

  const newId = newUser.user.id

  // Vincular bidireccional
  await sb.from('account_links').upsert([
    { owner_id: caller.id, linked_id: newId },
    { owner_id: newId,     linked_id: caller.id },
  ], { onConflict: 'owner_id,linked_id' })

  return json({ ok: true, email: newUser.user.email })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
