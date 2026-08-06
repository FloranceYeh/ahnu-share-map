import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null

export async function loadDynamicCatalog() {
  if (!supabase) return null
  const [categoriesResult, fieldsResult, placesResult] = await Promise.all([
    supabase.from('categories').select('id,label,color,sort_order').order('sort_order'),
    supabase.from('detail_fields').select('key,label,default_value,sort_order').order('sort_order'),
    supabase.from('places').select('id,name,recommendation,category_id,latitude,longitude,address,hours,price,best_for,rating,cover_url,tags,highlights,custom_details').eq('status', 'approved').order('submitted_at', { ascending: false }),
  ])
  const error = categoriesResult.error || fieldsResult.error || placesResult.error
  if (error) throw error
  return { categories: categoriesResult.data, detailFields: fieldsResult.data, places: placesResult.data }
}

export function mapDynamicPlace(row, categoriesById, detailFields) {
  const category = categoriesById[row.category_id]
  const details = detailFields.map((field) => ({ key: field.key, label: field.label, value: row[field.key] || row[field.key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] || field.default_value || '' }))
  return {
    id: row.id,
    name: row.name,
    recommendation: row.recommendation,
    category: row.category_id,
    categoryLabel: category?.label || row.category_id || '',
    color: category?.color,
    coordinates: [row.longitude, row.latitude],
    address: row.address || '',
    rating: row.rating ?? '—',
    cover: row.cover_url || '',
    tags: row.tags || [],
    highlights: row.highlights || [],
    tip: row.custom_details?.tip || '',
    details,
  }
}

export async function submitPlace(payload, turnstileToken, submissionId = null) {
  if (!supabase) throw new Error('Supabase 未配置')
  let fingerprint = localStorage.getItem('submission-fingerprint')
  if (!fingerprint) { fingerprint = crypto.randomUUID(); localStorage.setItem('submission-fingerprint', fingerprint) }
  const { data, error } = await supabase.functions.invoke('submit-place', { body: { payload, turnstileToken, fingerprint, submissionId } })
  if (error) {
    let message = error.message
    try {
      const responseBody = await error.context?.json()
      message = responseBody?.error || message
    } catch {
      // Keep the SDK message when the function response is not JSON.
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data.queryCode
}

export async function submitPlaceWithImages(payload, files = [], turnstileToken) {
  if (!supabase) throw new Error('Supabase 未配置')
  const submissionId = crypto.randomUUID()
  const imagePaths = []
  for (const file of files) {
    const path = `${submissionId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, '_')}`
    const { error } = await supabase.storage.from('submission-images').upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw error
    imagePaths.push(path)
  }
  return submitPlace({ ...payload, custom_details: { ...(payload.custom_details || {}), images: imagePaths } }, turnstileToken, submissionId)
}

export async function getSubmissionStatus(queryCode) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.rpc('get_submission_status', { code: queryCode.trim() })
  if (error) throw error
  return data?.[0] || null
}

export async function signInAdmin(email, password) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  const { data: membership, error: membershipError } = await supabase.from('admin_users').select('email').eq('user_id', data.user.id).maybeSingle()
  if (membershipError || !membership) {
    await supabase.auth.signOut()
    throw new Error('该账号不是管理员')
  }
  return data.user
}

export async function signOutAdmin() {
  await supabase?.auth.signOut()
}

export async function loadPendingPlaces() {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.from('places').select('*').eq('status', 'pending').order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function loadPlacesByStatus(status) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.from('places').select('*').eq('status', status).order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function updatePlace(id, changes) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.from('places').update(changes).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deletePlace(id) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { error } = await supabase.from('places').delete().eq('id', id)
  if (error) throw error
}

export async function loadAdminCatalog() {
  if (!supabase) throw new Error('Supabase 未配置')
  const [categories, fields] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('detail_fields').select('*').order('sort_order'),
  ])
  if (categories.error || fields.error) throw categories.error || fields.error
  return { categories: categories.data || [], fields: fields.data || [] }
}

export async function saveCategory(category) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.from('categories').upsert(category).select().single()
  if (error) throw error
  return data
}

export async function saveDetailField(field) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data, error } = await supabase.from('detail_fields').upsert(field).select().single()
  if (error) throw error
  return data
}

export async function deleteCategory(id) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data: referencedPlaces, error: referenceError } = await supabase.from('places').select('id').eq('category_id', id).limit(1)
  if (referenceError) throw referenceError
  if (referencedPlaces?.length) throw new Error('该分类仍被地点使用，请先修改相关地点的分类')
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export async function deleteDetailField(key) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { error } = await supabase.from('detail_fields').delete().eq('key', key)
  if (error) throw error
}

export async function createApprovedPlaceWithImages(payload, files = []) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data: userResult, error: userError } = await supabase.auth.getUser()
  if (userError || !userResult.user) throw userError || new Error('管理员登录已失效')
  const id = payload.id || crypto.randomUUID()
  const publicUrls = []
  for (const file of files) {
    const path = `${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, '_')}`
    const { error } = await supabase.storage.from('place-images').upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw error
    publicUrls.push(supabase.storage.from('place-images').getPublicUrl(path).data.publicUrl)
  }
  const { data, error } = await supabase.from('places').insert({
    ...payload,
    id,
    status: 'approved',
    cover_url: publicUrls[0] || payload.cover_url || null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: userResult.user.id,
  }).select('query_code').single()
  if (error) throw error
  return data.query_code
}

export async function loadPendingImageUrls(paths = []) {
  if (!supabase || !paths.length) return []
  const { data, error } = await supabase.storage.from('submission-images').createSignedUrls(paths, 3600)
  if (error) throw error
  return (data || []).map((item) => item.signedUrl).filter(Boolean)
}

export async function reviewPlace(id, status, rejectionReason = '', changes = {}) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { data: existing, error: fetchError } = await supabase.from('places').select('*').eq('id', id).single()
  if (fetchError) throw fetchError
  let coverUrl = existing.cover_url
  const imagePaths = existing.custom_details?.images || []
  if (status === 'approved' && imagePaths.length) {
    const publicUrls = []
    for (const path of imagePaths) {
      const { data: file, error: downloadError } = await supabase.storage.from('submission-images').download(path)
      if (downloadError) throw downloadError
      const publicPath = `${id}/${path.split('/').pop()}`
      const { error: uploadError } = await supabase.storage.from('place-images').upload(publicPath, file, { upsert: true, contentType: file.type })
      if (uploadError) throw uploadError
      publicUrls.push(supabase.storage.from('place-images').getPublicUrl(publicPath).data.publicUrl)
    }
    coverUrl = publicUrls[0] || coverUrl
  }
  const { data: userResult } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('places').update({ ...changes, status, cover_url: coverUrl, custom_details: { ...(existing.custom_details || {}), ...(status === 'approved' ? { images: undefined } : {}) }, rejection_reason: rejectionReason || null, reviewed_at: new Date().toISOString(), reviewed_by: userResult.user?.id || null }).eq('id', id).select().single()
  if (error) throw error
  return data
}
