import React, { useEffect, useState } from 'react'
import { loadPendingPlaces, reviewPlace, signInAdmin, signOutAdmin } from '../lib/supabase'

export default function AdminPanel({ onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState(null)
  const [pending, setPending] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState({})
  const [edits, setEdits] = useState({})
  const login = async () => { setBusy(true); setError(''); try { const admin = await signInAdmin(email, password); setUser(admin); setPending(await loadPendingPlaces()) } catch (loginError) { setError(loginError.message || '登录失败') } finally { setBusy(false) } }
  const review = async (id, status) => { setBusy(true); try { await reviewPlace(id, status, reason[id], edits[id] || {}); setPending((items) => items.filter((item) => item.id !== id)) } catch (reviewError) { setError(reviewError.message || '审核失败') } finally { setBusy(false) } }
  useEffect(() => () => { if (user) signOutAdmin() }, [user])
  return <aside className="debug-panel admin-panel"><div className="drawer-heading"><div><p className="section-kicker">ADMIN REVIEW</p><h2>审核后台</h2></div><button className="drawer-close" onClick={onClose} aria-label="关闭后台">×</button></div>{!user ? <div className="debug-form"><label><span>管理员邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="copy-yaml" onClick={login} disabled={busy || !email || !password}>{busy ? '登录中…' : '登录审核后台'}</button></div> : <div className="pending-list"><div className="admin-toolbar"><span>{pending.length} 条待审核</span><button onClick={() => { signOutAdmin(); onClose() }}>退出</button></div>{error && <p className="form-error">{error}</p>}{pending.map((item) => <article className="pending-card" key={item.id}><input className="pending-edit" value={edits[item.id]?.name ?? item.name} onChange={(event) => setEdits((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), name: event.target.value } }))} /><textarea rows="3" value={edits[item.id]?.recommendation ?? item.recommendation} onChange={(event) => setEdits((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), recommendation: event.target.value } }))} /><small>{item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}</small>{item.custom_details?.duplicate_candidates?.length > 0 && <p className="duplicate-warning">疑似重复：{item.custom_details.duplicate_candidates.map((candidate) => candidate.name).join('、')}</p>}<textarea rows="2" placeholder="驳回原因（可选）" value={reason[item.id] || ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} /><div><button onClick={() => review(item.id, 'approved')} disabled={busy}>通过</button><button onClick={() => review(item.id, 'rejected')} disabled={busy}>驳回</button></div></article>)}</div>}</aside>
}
