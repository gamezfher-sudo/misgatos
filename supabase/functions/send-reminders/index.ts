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
    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + days)
    const dateStr = targetDate.toISOString().split('T')[0]

    // ── Citas ────────────────────────────────────────────────────────────────
    const { data: apts, error: aptErr } = await sb
      .from('appointments')
      .select(`id, appointment_date, appointment_time, reason,
               cats ( name, user_id ),
               veterinarians ( name, clinic_name )`)
      .eq('appointment_date', dateStr)
      .eq('status', 'pendiente')

    if (aptErr) {
      console.error('Error fetching appointments:', aptErr)
    } else {
      for (const apt of apts ?? []) {
        const cat    = apt.cats as any
        const userId = cat?.user_id
        if (!userId) continue

        const { data: logged } = await sb.from('reminder_log').select('id')
          .eq('appointment_id', apt.id).eq('days_before', days).maybeSingle()
        if (logged) continue

        const toEmails = await getEmailsForUser(sb, userId)
        if (!toEmails.length) continue

        const whenLabel = daysLabel(days)
        const subject   = `Recordatorio: ${cat?.name || 'Tu gato'} tiene cita ${whenLabel}`
        const html = buildAppointmentEmail({
          catName:  cat?.name || 'Tu gato',
          vetName:  (apt.veterinarians as any)?.name || '',
          clinic:   (apt.veterinarians as any)?.clinic_name || '',
          apptDate: formatDate(apt.appointment_date),
          apptTime: apt.appointment_time ? formatTime(apt.appointment_time) : '',
          reason:   apt.reason || '',
          whenLabel, days,
        })

        let ok = false
        for (const email of toEmails) { if (await sendEmail(email, subject, html)) ok = true }
        if (ok) {
          await sb.from('reminder_log').insert({ appointment_id: apt.id, days_before: days, sent_to: toEmails.join(',') })
          sent++
          console.log(`[apt] ${days}d → ${toEmails.join(',')} (${cat?.name})`)
        } else { errors++ }
      }
    }

    // ── Vacunas ───────────────────────────────────────────────────────────────
    const { data: vacs, error: vacErr } = await sb
      .from('vaccines')
      .select(`id, vaccine_name, next_due_date, cats ( name, user_id )`)
      .eq('next_due_date', dateStr)

    if (vacErr) {
      console.error('Error fetching vaccines:', vacErr)
    } else {
      for (const vac of vacs ?? []) {
        const cat    = vac.cats as any
        const userId = cat?.user_id
        if (!userId) continue

        const { data: logged } = await sb.from('reminder_log').select('id')
          .eq('vaccine_id', vac.id).eq('days_before', days).maybeSingle()
        if (logged) continue

        const toEmails = await getEmailsForUser(sb, userId)
        if (!toEmails.length) continue

        const whenLabel = daysLabel(days)
        const catName   = cat?.name || 'Tu gato'
        const subject   = days === 0
          ? `Vacuna vencida hoy: ${vac.vaccine_name} — ${catName}`
          : `Vacuna próxima ${whenLabel}: ${vac.vaccine_name} — ${catName}`

        const html = buildDoseEmail({
          type: 'vacuna', name: vac.vaccine_name, catName,
          dueDate: formatDate(vac.next_due_date), whenLabel, days,
        })

        let ok = false
        for (const email of toEmails) { if (await sendEmail(email, subject, html)) ok = true }
        if (ok) {
          await sb.from('reminder_log').insert({ vaccine_id: vac.id, days_before: days, sent_to: toEmails.join(',') })
          sent++
          console.log(`[vac] ${days}d → ${toEmails.join(',')} (${catName}: ${vac.vaccine_name})`)
        } else { errors++ }
      }
    }

    // ── Desparasitaciones ─────────────────────────────────────────────────────
    const { data: dews, error: dewErr } = await sb
      .from('dewormings')
      .select(`id, product_name, next_due_date, cats ( name, user_id )`)
      .eq('next_due_date', dateStr)

    if (dewErr) {
      console.error('Error fetching dewormings:', dewErr)
    } else {
      for (const dew of dews ?? []) {
        const cat    = dew.cats as any
        const userId = cat?.user_id
        if (!userId) continue

        const { data: logged } = await sb.from('reminder_log').select('id')
          .eq('deworming_id', dew.id).eq('days_before', days).maybeSingle()
        if (logged) continue

        const toEmails = await getEmailsForUser(sb, userId)
        if (!toEmails.length) continue

        const whenLabel = daysLabel(days)
        const catName   = cat?.name || 'Tu gato'
        const subject   = days === 0
          ? `Desparasitación vencida hoy: ${dew.product_name} — ${catName}`
          : `Desparasitación próxima ${whenLabel}: ${dew.product_name} — ${catName}`

        const html = buildDoseEmail({
          type: 'desparasitación', name: dew.product_name, catName,
          dueDate: formatDate(dew.next_due_date), whenLabel, days,
        })

        let ok = false
        for (const email of toEmails) { if (await sendEmail(email, subject, html)) ok = true }
        if (ok) {
          await sb.from('reminder_log').insert({ deworming_id: dew.id, days_before: days, sent_to: toEmails.join(',') })
          sent++
          console.log(`[dew] ${days}d → ${toEmails.join(',')} (${catName}: ${dew.product_name})`)
        } else { errors++ }
      }
    }
  }

  return new Response(JSON.stringify({ sent, errors, timestamp: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

// Devuelve el email del dueño + emails de todas las cuentas vinculadas
async function getEmailsForUser(sb: any, userId: string): Promise<string[]> {
  const emails: string[] = []
  const { data: owner } = await sb.auth.admin.getUserById(userId)
  if (owner?.user?.email) emails.push(owner.user.email)

  const { data: links } = await sb
    .from('account_links')
    .select('linked_id')
    .eq('owner_id', userId)

  for (const link of links ?? []) {
    const { data: linked } = await sb.auth.admin.getUserById(link.linked_id)
    if (linked?.user?.email) emails.push(linked.user.email)
  }
  return emails
}

function daysLabel(days: number): string {
  return days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`
}

async function sendEmail(toEmail: string, subject: string, html: string): Promise<boolean> {
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
  if (!res.ok) {
    console.error('Brevo error:', await res.text())
  }
  return res.ok
}

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

// ── Plantilla: Cita ───────────────────────────────────────────────────────────

function buildAppointmentEmail({ catName, vetName, clinic, apptDate, apptTime, reason, whenLabel, days }: {
  catName: string; vetName: string; clinic: string;
  apptDate: string; apptTime: string; reason: string; whenLabel: string; days: number;
}): string {
  const urgencyColor = days === 0 ? '#b91c1c' : days === 1 ? '#b45309' : '#00694d'
  const urgencyBg    = days === 0 ? '#fef2f2' : days === 1 ? '#fffbeb' : '#f0fdf4'
  const bannerLabel  = days === 0 ? 'Cita hoy' : days === 1 ? 'Cita mañana' : `Cita en ${days} días`

  return emailShell({ title: `${catName} tiene cita ${whenLabel}`, urgencyColor, urgencyBg, bannerLabel, rows: `
    <tr>
      <td style="font-size:12px;color:#6e7a73;font-weight:600;vertical-align:top;width:100px;padding:6px 0">Fecha</td>
      <td style="font-size:14px;font-weight:600;color:#191c1d;padding:6px 0">${apptDate}${apptTime ? ' · ' + apptTime : ''}</td>
    </tr>
    ${vetName ? `<tr>
      <td style="font-size:12px;color:#6e7a73;font-weight:600;vertical-align:top;padding:6px 0">Veterinario</td>
      <td style="font-size:14px;font-weight:600;color:#191c1d;padding:6px 0">${vetName}${clinic ? `<br><span style="font-size:13px;font-weight:400;color:#6e7a73">${clinic}</span>` : ''}</td>
    </tr>` : ''}
    ${reason ? `<tr>
      <td style="font-size:12px;color:#6e7a73;font-weight:600;vertical-align:top;padding:6px 0">Motivo</td>
      <td style="font-size:14px;color:#191c1d;padding:6px 0">${reason}</td>
    </tr>` : ''}
  `, subtitle: 'Recuerda confirmar asistencia con tu veterinario.' })
}

// ── Plantilla: Vacuna / Desparasitación ───────────────────────────────────────

function buildDoseEmail({ type, name, catName, dueDate, whenLabel, days }: {
  type: string; name: string; catName: string; dueDate: string; whenLabel: string; days: number;
}): string {
  const urgencyColor = days === 0 ? '#b91c1c' : days === 1 ? '#b45309' : '#00694d'
  const urgencyBg    = days === 0 ? '#fef2f2' : days === 1 ? '#fffbeb' : '#f0fdf4'
  const typeLabel    = type.charAt(0).toUpperCase() + type.slice(1)
  const bannerLabel  = days === 0 ? `${typeLabel} vence hoy` : days === 1 ? `${typeLabel} vence mañana` : `${typeLabel} vence en ${days} días`
  const title        = days === 0
    ? `La ${type} de ${catName} venció hoy`
    : `La ${type} de ${catName} vence ${whenLabel}`

  return emailShell({ title, urgencyColor, urgencyBg, bannerLabel, rows: `
    <tr>
      <td style="font-size:12px;color:#6e7a73;font-weight:600;vertical-align:top;width:100px;padding:6px 0">Gato</td>
      <td style="font-size:14px;font-weight:600;color:#191c1d;padding:6px 0">${catName}</td>
    </tr>
    <tr>
      <td style="font-size:12px;color:#6e7a73;font-weight:600;vertical-align:top;padding:6px 0">${typeLabel}</td>
      <td style="font-size:14px;font-weight:600;color:#191c1d;padding:6px 0">${name}</td>
    </tr>
    <tr>
      <td style="font-size:12px;color:#6e7a73;font-weight:600;vertical-align:top;padding:6px 0">Fecha límite</td>
      <td style="font-size:14px;font-weight:600;color:${urgencyColor};padding:6px 0">${dueDate}</td>
    </tr>
  `, subtitle: `Agenda una cita con tu veterinario para aplicar la ${type} a tiempo.` })
}

// ── Shell de email compartido ─────────────────────────────────────────────────

function emailShell({ title, urgencyColor, urgencyBg, bannerLabel, rows, subtitle }: {
  title: string; urgencyColor: string; urgencyBg: string;
  bannerLabel: string; rows: string; subtitle: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:100%">

        <tr><td style="background:#00694d;padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="width:38px;height:38px;background:rgba(255,255,255,0.18);border-radius:8px;text-align:center;vertical-align:middle;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:-.5px">MG</td>
              <td style="padding-left:10px;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-.3px">MisGatos</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="background:${urgencyBg};padding:12px 32px">
          <p style="margin:0;font-size:13px;font-weight:600;color:${urgencyColor}">${bannerLabel}</p>
        </td></tr>

        <tr><td style="padding:28px 32px">
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#191c1d;line-height:1.2">${title}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6e7a73">${subtitle}</p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f5;border-radius:12px">
            <tr><td style="padding:20px">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${rows}</table>
            </td></tr>
          </table>
        </td></tr>

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
