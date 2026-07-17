import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BREVO_API_KEY  = Deno.env.get('BREVO_API_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const FROM_NAME  = 'MisGatos'
const FROM_EMAIL = 'gamezfher@gmail.com'

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  const intervals = [7, 3, 1, 0]
  let sent = 0
  let errors = 0

  for (const days of intervals) {
    // Fecha objetivo
    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + days)
    const dateStr = targetDate.toISOString().split('T')[0]

    // Citas pendientes en esa fecha, con gato (que tiene user_id) y veterinario
    const { data: apts, error: aptErr } = await sb
      .from('appointments')
      .select(`
        id, appointment_date, appointment_time, reason,
        cats ( name, user_id ),
        veterinarians ( name, clinic_name )
      `)
      .eq('appointment_date', dateStr)
      .eq('status', 'pendiente')

    if (aptErr) {
      console.error('Error fetching appointments:', aptErr)
      continue
    }
    if (!apts?.length) continue

    for (const apt of apts) {
      const cat = apt.cats as any
      const userId = cat?.user_id
      if (!userId) continue

      // Verificar si ya enviamos este recordatorio
      const { data: logged } = await sb
        .from('reminder_log')
        .select('id')
        .eq('appointment_id', apt.id)
        .eq('days_before', days)
        .maybeSingle()

      if (logged) continue

      // Obtener email del dueño
      const { data: userData, error: userErr } = await sb.auth.admin.getUserById(userId)
      const toEmail = userData?.user?.email
      if (userErr || !toEmail) continue

      const catName  = cat?.name || 'Tu gato'
      const vet      = apt.veterinarians as any
      const vetName  = vet?.name || ''
      const clinic   = vet?.clinic_name || ''
      const apptDate = formatDate(apt.appointment_date)
      const apptTime = apt.appointment_time ? formatTime(apt.appointment_time) : ''
      const reason   = apt.reason || ''

      const whenLabel = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`
      const subject   = `Recordatorio: ${catName} tiene cita ${whenLabel}`

      const html = buildEmail({ catName, vetName, clinic, apptDate, apptTime, reason, whenLabel, days })

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: FROM_NAME, email: FROM_EMAIL },
          to: [{ email: toEmail }],
          subject,
          htmlContent: html,
        }),
      })

      if (res.ok) {
        await sb.from('reminder_log').insert({
          appointment_id: apt.id,
          days_before: days,
          sent_to: toEmail,
        })
        sent++
        console.log(`Sent reminder (${days}d) to ${toEmail} for ${catName}`)
      } else {
        const errText = await res.text()
        console.error('Resend error:', errText)
        errors++
      }
    }
  }

  return new Response(JSON.stringify({ sent, errors, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function formatDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  const months = ['enero','febrero','marzo','abril','mayo','junio',
                  'julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${day} de ${months[m - 1]} de ${y}`
}

function formatTime(t: string): string {
  const [h, min] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12  = h % 12 || 12
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`
}

function buildEmail({ catName, vetName, clinic, apptDate, apptTime, reason, whenLabel, days }: {
  catName: string; vetName: string; clinic: string;
  apptDate: string; apptTime: string; reason: string; whenLabel: string; days: number;
}): string {
  const urgencyColor = days === 0 ? '#b91c1c' : days === 1 ? '#b45309' : '#00694d'
  const urgencyBg    = days === 0 ? '#fef2f2' : days === 1 ? '#fffbeb' : '#f0fdf4'

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${catName} tiene cita ${whenLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:100%">

        <!-- Header -->
        <tr><td style="background:#00694d;padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="width:38px;height:38px;background:rgba(255,255,255,0.18);border-radius:8px;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:-.5px">MG</td>
              <td style="padding-left:10px;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-.3px">MisGatos</td>
            </tr>
          </table>
        </td></tr>

        <!-- Urgency banner -->
        <tr><td style="background:${urgencyBg};padding:12px 32px">
          <p style="margin:0;font-size:13px;font-weight:600;color:${urgencyColor}">
            ${days === 0 ? 'Cita hoy' : days === 1 ? 'Cita mañana' : `Cita en ${days} días`}
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px">
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#191c1d;line-height:1.2">
            ${catName} tiene cita ${whenLabel}
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6e7a73">Recuerda confirmar asistencia con tu veterinario.</p>

          <!-- Detalles -->
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f5;border-radius:12px;padding:0">
            <tr><td style="padding:20px">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="font-size:12px;color:#6e7a73;font-weight:600;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;width:100px;padding:6px 0">Fecha</td>
                  <td style="font-size:14px;font-weight:600;color:#191c1d;padding:6px 0">${apptDate}${apptTime ? ' · ' + apptTime : ''}</td>
                </tr>
                ${vetName ? `<tr>
                  <td style="font-size:12px;color:#6e7a73;font-weight:600;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;padding:6px 0">Veterinario</td>
                  <td style="font-size:14px;font-weight:600;color:#191c1d;padding:6px 0">${vetName}${clinic ? `<br><span style="font-size:13px;font-weight:400;color:#6e7a73">${clinic}</span>` : ''}</td>
                </tr>` : ''}
                ${reason ? `<tr>
                  <td style="font-size:12px;color:#6e7a73;font-weight:600;text-transform:uppercase;letter-spacing:.05em;vertical-align:top;padding:6px 0">Motivo</td>
                  <td style="font-size:14px;color:#191c1d;padding:6px 0">${reason}</td>
                </tr>` : ''}
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #edeeef">
          <p style="margin:0;font-size:12px;color:#6e7a73;text-align:center">
            Este recordatorio fue enviado automáticamente por MisGatos.<br>
            Control veterinario personal.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
