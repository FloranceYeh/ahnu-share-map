import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { payload, turnstileToken, fingerprint } = await request.json()
    if (!payload?.name || !payload?.recommendation || !turnstileToken || !fingerprint) return json({ error: '投稿信息不完整' }, 400)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const verifyBody = new URLSearchParams({ secret: Deno.env.get('TURNSTILE_SECRET_KEY') || '', response: turnstileToken, remoteip: ip })
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: verifyBody }).then((response) => response.json())
    if (!verification.success) return json({ error: '人机验证失败' }, 403)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}:${fingerprint}`))
    const rateKey = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: allowed, error: quotaError } = await admin.rpc('consume_submission_quota', { key: rateKey, max_count: 5 })
    if (quotaError) throw quotaError
    if (!allowed) return json({ error: '今天的投稿次数已用完' }, 429)
    const latitude = Number(payload.latitude)
    const longitude = Number(payload.longitude)
    const { data: nearby } = await admin.from('places').select('id,name').gte('latitude', latitude - 0.0015).lte('latitude', latitude + 0.0015).gte('longitude', longitude - 0.0015).lte('longitude', longitude + 0.0015).limit(5)
    const duplicateCandidates = (nearby || []).filter((place) => place.name.includes(payload.name) || payload.name.includes(place.name)).map((place) => ({ id: place.id, name: place.name }))
    const { data, error } = await admin.from('places').insert({ ...payload, custom_details: { ...(payload.custom_details || {}), duplicate_candidates: duplicateCandidates }, status: 'pending' }).select('query_code').single()
    if (error) throw error
    return json({ queryCode: data.query_code })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '投稿失败' }, 500)
  }
})
