import React, { useMemo, useRef, useState } from 'react'
import { createApprovedPlaceWithImages, submitPlaceWithImages } from '../lib/supabase'
import Turnstile from './Turnstile'

const yamlValue = (value) => `'${String(value).replaceAll("'", "''")}'`

export default function SubmissionForm({ draft, setDraft, categories, detailFields, onClose, onSubmitted, adminMode = false }) {
  const [files, setFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [queryCode, setQueryCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const turnstileRef = useRef(null)
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const updateCustom = (index, key, value) => setDraft((current) => ({ ...current, custom: current.custom.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }))
  const addCustom = () => setDraft((current) => ({ ...current, custom: [...current.custom, { key: '', value: '' }] }))
  const removeCustom = (index) => setDraft((current) => ({ ...current, custom: current.custom.filter((_, itemIndex) => itemIndex !== index) }))
  const yaml = useMemo(() => {
    const lines = [`- name: ${yamlValue(draft.name)}`, `  recommendation: ${yamlValue(draft.recommendation)}`, `  category: ${draft.category}`, `  coordinates: [${draft.latitude}, ${draft.longitude}]`]
    detailFields.forEach((field) => { if (draft[field.key]) lines.push(`  ${field.key}: ${yamlValue(draft[field.key])}`) })
    draft.custom.forEach((field) => { if (field.key.trim() && field.value.trim()) lines.push(`  ${field.key.trim()}: ${yamlValue(field.value.trim())}`) })
    return lines.join('\n')
  }, [draft, detailFields])
  const submit = async (turnstileToken = '') => {
    if (!draft.name.trim() || !draft.recommendation.trim()) return
    setSubmitting(true); setError('')
    try {
      const customDetails = Object.fromEntries(draft.custom.filter((item) => item.key.trim() && item.value.trim()).map((item) => [item.key.trim(), item.value.trim()]))
      const payload = {
        name: draft.name.trim(),
        recommendation: draft.recommendation.trim(),
        category_id: draft.category,
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
        hours: draft.hours || null,
        price: draft.price || null,
        best_for: draft.bestFor || null,
        custom_details: customDetails,
      }
      const code = adminMode ? await createApprovedPlaceWithImages(payload, files) : await submitPlaceWithImages(payload, files, turnstileToken)
      setQueryCode(code)
      onSubmitted?.(code)
    } catch (submitError) {
      setError(submitError.message || '提交失败，请稍后重试')
    } finally { setSubmitting(false); setVerifying(false); if (!adminMode) turnstileRef.current?.reset() }
  }
  const requestSubmit = () => {
    if (adminMode) { submit(); return }
    setError(''); setVerifying(true); turnstileRef.current?.execute()
  }
  if (queryCode) return <aside className="debug-panel"><div className="drawer-heading"><div><p className="section-kicker">{adminMode ? 'PUBLISHED' : 'SUBMITTED'}</p><h2>{adminMode ? '地点已发布' : '已提交审核'}</h2></div><button className="drawer-close" onClick={onClose} aria-label="关闭投稿结果">×</button></div><div className="submission-success"><p>{adminMode ? '管理员加点已直接发布，查询码如下：' : '请保存这串查询码，用于查看审核状态：'}</p><strong>{queryCode}</strong><button onClick={() => navigator.clipboard.writeText(queryCode)}>复制查询码</button></div></aside>
  return <aside className="debug-panel"><div className="drawer-heading"><div><p className="section-kicker">{adminMode ? 'ADMIN PLACE' : 'SHARE A PLACE'}</p><h2>{adminMode ? '管理员加点' : '新增推荐点'}</h2></div><button className="drawer-close" onClick={onClose} aria-label="关闭投稿表单">×</button></div><div className="debug-form"><div className="coordinate-fields"><label><span>纬度</span><input value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label><span>经度</span><input value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div><label><span>地名 *</span><input value={draft.name} onChange={(event) => update('name', event.target.value)} autoFocus /></label><label><span>推荐理由 *</span><textarea value={draft.recommendation} onChange={(event) => update('recommendation', event.target.value)} rows="4" /></label><label><span>分类</span><select value={draft.category} onChange={(event) => update('category', event.target.value)}>{categories.filter((category) => category.id !== 'all').map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label><div className="optional-fields">{detailFields.map((field) => <label key={field.key}><span>{field.label}</span><input value={draft[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} /></label>)}</div><label><span>图片（最多 3 张）</span><input type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 3))} /></label><div className="custom-heading"><span>自定义项</span><button type="button" onClick={addCustom}>＋ 添加</button></div><div className="custom-fields">{draft.custom.map((field, index) => <div className="custom-row" key={index}><input placeholder="字段名" value={field.key} onChange={(event) => updateCustom(index, 'key', event.target.value)} /><input placeholder="内容" value={field.value} onChange={(event) => updateCustom(index, 'value', event.target.value)} /><button type="button" onClick={() => removeCustom(index)} aria-label="删除自定义项">×</button></div>)}</div>{!adminMode && <Turnstile ref={turnstileRef} onToken={submit} onError={(message) => { setVerifying(false); setError(message) }} />}{error && <p className="form-error">{error}</p>}<button className="copy-yaml" onClick={requestSubmit} disabled={submitting || verifying || !draft.name.trim() || !draft.recommendation.trim()}>{submitting ? '提交中…' : verifying ? '安全验证中…' : adminMode ? '直接发布' : '提交审核'}</button><textarea className="yaml-preview" value={yaml} readOnly rows="5" aria-label="投稿内容预览" /></div></aside>
}
