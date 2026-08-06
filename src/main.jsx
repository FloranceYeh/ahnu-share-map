import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import yamlText from './data/places.yml?raw'
import categoryYamlText from './data/categories.yml?raw'
import appYamlText from './data/app.yml?raw'
import detailYamlText from './data/details.yml?raw'
import './styles.css'

function parseScalar(value) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1).split(',').map((item) => {
    const token = item.trim().replace(/^['"]|['"]$/g, '')
    return /^\d+(\.\d+)?$/.test(token) ? Number(token) : token
  }).filter(Boolean)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

function parseYaml(text) {
  const rows = []
  let current = null
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.trim()
    if (!clean || clean.startsWith('#')) return
    if (clean.startsWith('- ')) {
      if (current) rows.push(current)
      current = {}
      const first = clean.slice(2).match(/^([^:]+):\s*(.*)$/)
      if (first) current[first[1].trim()] = parseScalar(first[2])
      return
    }
    const match = clean.match(/^([^:]+):\s*(.*)$/)
    if (match && current) current[match[1].trim()] = parseScalar(match[2])
  })
  if (current) rows.push(current)
  return rows
}

const appConfig = parseYaml(appYamlText)[0]
if (!appConfig) throw new Error('src/data/app.yml must contain one configuration item')
const PI = Math.PI
const AXIS = 6378245.0
const EE = 0.00669342162296594323
const outOfChina = (lng, lat) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
const transformLat = (lng, lat) => {
  let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3
  ret += (20 * Math.sin(lat * PI) + 40 * Math.sin(lat / 3 * PI)) * 2 / 3
  ret += (160 * Math.sin(lat / 12 * PI) + 320 * Math.sin(lat * PI / 30)) * 2 / 3
  return ret
}
const transformLng = (lng, lat) => {
  let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3
  ret += (20 * Math.sin(lng * PI) + 40 * Math.sin(lng / 3 * PI)) * 2 / 3
  ret += (150 * Math.sin(lng / 12 * PI) + 300 * Math.sin(lng / 30 * PI)) * 2 / 3
  return ret
}
const wgs84ToGcj02 = ([lng, lat]) => {
  if (outOfChina(lng, lat)) return [lng, lat]
  const dLat = transformLat(lng - 105, lat - 35)
  const dLng = transformLng(lng - 105, lat - 35)
  const radLat = lat / 180 * PI
  const magic = 1 - EE * Math.sin(radLat) ** 2
  const sqrtMagic = Math.sqrt(magic)
  return [lng + (dLng * 180) / (AXIS / sqrtMagic * Math.cos(radLat) * PI), lat + (dLat * 180) / (AXIS * (1 - EE) / (magic * sqrtMagic) * PI)]
}
const toAmapCoordinates = (coordinates) => appConfig.coordinateSystem === 'wgs84' ? wgs84ToGcj02(coordinates) : coordinates
const fromAmapCoordinates = (coordinates) => {
  if (appConfig.coordinateSystem !== 'wgs84') return coordinates
  const converted = wgs84ToGcj02(coordinates)
  return [coordinates[0] * 2 - converted[0], coordinates[1] * 2 - converted[1]]
}
const CENTER = toAmapCoordinates(appConfig.mapCenter)
const detailConfig = parseYaml(detailYamlText).filter((item) => item.key && item.label)
const categoryConfig = parseYaml(categoryYamlText).filter((item) => item.id && item.label).map((item) => ({
  id: item.id,
  label: item.label,
  color: item.color || appConfig.defaultCategoryColor,
}))
const categoryById = Object.fromEntries(categoryConfig.map((category) => [category.id, category]))
const categories = [{ id: 'all', label: appConfig.allCategoryLabel }, ...categoryConfig]

const places = parseYaml(yamlText).filter((item) => item.name && item.recommendation).map((item, index) => ({
  id: item.id || `${appConfig.placeIdPrefix}-${index + 1}`,
  name: item.name,
  recommendation: item.recommendation,
  category: categoryById[item.category] ? item.category : appConfig.defaultCategory,
  categoryLabel: categoryById[item.category]?.label || categoryById[appConfig.defaultCategory]?.label,
  // Admin data uses [lat, lng]; AMap uses [lng, lat].
  coordinates: Array.isArray(item.coordinates) && item.coordinates.length === 2 ? toAmapCoordinates([item.coordinates[1], item.coordinates[0]]) : [CENTER[0] + index * appConfig.coordinateStep[0], CENTER[1] + index * appConfig.coordinateStep[1]],
  address: item.address || appConfig.defaultAddress,
  rating: item.rating || appConfig.defaultRating,
  cover: item.cover || '',
  tags: Array.isArray(item.tags) ? item.tags : appConfig.defaultTags,
  highlights: Array.isArray(item.highlights) ? item.highlights : appConfig.defaultHighlights,
  tip: item.tip || appConfig.defaultTip,
  details: detailConfig.map((field) => ({ key: field.key, label: field.label, value: item[field.key] || field.default })),
}))

function loadAmap(key) {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (!key) return Promise.reject(new Error('missing-key'))
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-amap-loader]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.AMap))
      existing.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.dataset.amapLoader = 'true'
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.ToolBar,AMap.Scale`
    script.onload = () => resolve(window.AMap)
    script.onerror = () => reject(new Error('amap-load-failed'))
    document.head.appendChild(script)
  })
}

function AmapCanvas({ places: visiblePlaces, selected, onSelect, onStatus, onMapClick, debugEnabled, resetSignal }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const mapClickRef = useRef(onMapClick)
  const key = import.meta.env.VITE_AMAP_KEY

  useEffect(() => { mapClickRef.current = onMapClick }, [onMapClick])

  useEffect(() => {
    let disposed = false
    loadAmap(key).then((AMap) => {
      if (disposed || mapRef.current) return
      const map = new AMap.Map(containerRef.current, { zoom: appConfig.mapZoom, zooms: [appConfig.mapMinZoom, appConfig.mapMaxZoom], center: CENTER, viewMode: '2D', mapStyle: appConfig.mapStyle, resizeEnable: true })
      AMap.plugin(['AMap.ToolBar', 'AMap.Scale'], () => { map.addControl(new AMap.ToolBar({ position: 'RB' })); map.addControl(new AMap.Scale({ position: 'LB' })) })
      map.on('click', (event) => mapClickRef.current?.([event.lnglat.getLng(), event.lnglat.getLat()]))
      mapRef.current = map
      onStatus('ready')
    }).catch((error) => { if (!disposed) onStatus(error.message === 'missing-key' ? 'missing-key' : 'error') })
    return () => { disposed = true; if (mapRef.current) { mapRef.current.destroy(); mapRef.current = null } }
  }, [key, onStatus])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.AMap) return
    map.clearMap()
    visiblePlaces.forEach((place) => {
      const color = categoryById[place.category]?.color || appConfig.defaultCategoryColor
      const marker = new window.AMap.Marker({ position: place.coordinates, content: `<span class="dot-marker ${selected?.id === place.id ? 'is-active' : ''}" style="--dot-color:${color}"></span>`, offset: new window.AMap.Pixel(-9, -9), zIndex: selected?.id === place.id ? 120 : 100, title: place.name })
      marker.on('click', () => onSelect(place))
      map.add(marker)
    })
    if (selected) map.setCenter(selected.coordinates)
  }, [visiblePlaces, selected, onSelect])

  useEffect(() => {
    if (resetSignal > 0 && mapRef.current) mapRef.current.setZoomAndCenter(appConfig.mapZoom, CENTER)
  }, [resetSignal])

  return <div ref={containerRef} className={`amap-canvas ${debugEnabled ? 'is-debugging' : ''}`} />
}

const yamlValue = (value) => `'${String(value).replaceAll("'", "''")}'`

function DebugForm({ draft, setDraft, onClose }) {
  const [copied, setCopied] = useState(false)
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const updateCustom = (index, key, value) => setDraft((current) => ({ ...current, custom: current.custom.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }))
  const addCustom = () => setDraft((current) => ({ ...current, custom: [...current.custom, { key: '', value: '' }] }))
  const removeCustom = (index) => setDraft((current) => ({ ...current, custom: current.custom.filter((_, itemIndex) => itemIndex !== index) }))
  const yaml = useMemo(() => {
    const lines = [`- name: ${yamlValue(draft.name)}`, `  recommendation: ${yamlValue(draft.recommendation)}`, `  category: ${draft.category}`, `  coordinates: [${draft.latitude}, ${draft.longitude}]`]
    detailConfig.forEach((field) => { if (draft[field.key]) lines.push(`  ${field.key}: ${yamlValue(draft[field.key])}`) })
    draft.custom.forEach((field) => { if (field.key.trim() && field.value.trim()) lines.push(`  ${field.key.trim()}: ${yamlValue(field.value.trim())}`) })
    return lines.join('\n')
  }, [draft])
  const copyYaml = async () => { await navigator.clipboard.writeText(yaml); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }

  return <aside className="debug-panel">
    <div className="drawer-heading"><div><p className="section-kicker">MAP DEBUGGER</p><h2>新增推荐点</h2></div><button className="drawer-close" onClick={onClose} aria-label="关闭录点表单">×</button></div>
    <div className="debug-form">
      <div className="coordinate-fields"><label><span>纬度</span><input value={draft.latitude} onChange={(event) => update('latitude', event.target.value)} /></label><label><span>经度</span><input value={draft.longitude} onChange={(event) => update('longitude', event.target.value)} /></label></div>
      <label><span>地名 *</span><input value={draft.name} onChange={(event) => update('name', event.target.value)} autoFocus /></label>
      <label><span>推荐理由 *</span><textarea value={draft.recommendation} onChange={(event) => update('recommendation', event.target.value)} rows="4" /></label>
      <label><span>分类</span><select value={draft.category} onChange={(event) => update('category', event.target.value)}>{categoryConfig.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
      <div className="optional-fields">{detailConfig.map((field) => <label key={field.key}><span>{field.label}</span><input value={draft[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} /></label>)}</div>
      <div className="custom-heading"><span>自定义项</span><button type="button" onClick={addCustom}>＋ 添加</button></div>
      <div className="custom-fields">{draft.custom.map((field, index) => <div className="custom-row" key={index}><input placeholder="字段名" value={field.key} onChange={(event) => updateCustom(index, 'key', event.target.value)} /><input placeholder="内容" value={field.value} onChange={(event) => updateCustom(index, 'value', event.target.value)} /><button type="button" onClick={() => removeCustom(index)} aria-label="删除自定义项">×</button></div>)}</div>
      <textarea className="yaml-preview" value={yaml} readOnly rows="7" aria-label="生成的 YAML" />
      <button className="copy-yaml" onClick={copyYaml} disabled={!draft.name.trim() || !draft.recommendation.trim()}>{copied ? '已复制' : '复制 YAML'}</button>
    </div>
  </aside>
}

function App() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [drawer, setDrawer] = useState(false)
  const [mapStatus, setMapStatus] = useState('loading')
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [draft, setDraft] = useState(null)
  const [resetSignal, setResetSignal] = useState(0)
  const filtered = useMemo(() => places.filter((place) => {
    const matchesCategory = activeCategory === 'all' || place.category === activeCategory
    const query = search.trim().toLowerCase()
    return matchesCategory && (!query || `${place.name} ${place.address} ${place.tags.join(' ')}`.toLowerCase().includes(query))
  }), [activeCategory, search])
  const selectPlace = (place) => { setSelected(place); setDrawer(false) }
  const createDraft = (coordinates) => {
    if (!debugEnabled) return
    const [longitude, latitude] = fromAmapCoordinates(coordinates)
    setSelected(null)
    setDrawer(false)
    setDraft({
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      name: '',
      recommendation: '',
      category: appConfig.defaultCategory,
      custom: [{ key: '', value: '' }],
      ...Object.fromEntries(detailConfig.map((field) => [field.key, ''])),
    })
  }
  const statusMessage = mapStatus === 'missing-key' ? '配置 VITE_AMAP_KEY 后显示高德底图' : mapStatus === 'error' ? '高德地图加载失败，请检查 Key 与域名白名单' : ''

  return <main className="app-shell">
    <div className="fullscreen-map"><AmapCanvas places={filtered} selected={selected} onSelect={selectPlace} onStatus={setMapStatus} onMapClick={createDraft} debugEnabled={debugEnabled} resetSignal={resetSignal} /><div className="map-fallback" aria-hidden="true" /></div>
    <header className="floating-header"><div className="brand-lockup"><div className="brand-mark">赭</div><div><p className="eyebrow">AHNU · ZHESHAN CAMPUS</p><h1>赭山生活地图</h1></div></div><div className="header-actions">{appConfig.enableDebugAddPoint && <button className={`debug-trigger ${debugEnabled ? 'active' : ''}`} onClick={() => { setDebugEnabled((value) => !value); setDraft(null) }}>＋<span>{debugEnabled ? '退出录点' : '调试录点'}</span></button>}<button className="drawer-trigger" onClick={() => { setDrawer(true); setSelected(null); setDraft(null) }}><span className="trigger-icon">☷</span>推荐地点 <b>{filtered.length}</b></button></div></header>
    <section className="floating-tools"><label className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜店面或关键词" /></label><div className="category-row" role="tablist" aria-label="地点分类">{categories.map((category) => <button key={category.id} className={`category-chip ${activeCategory === category.id ? 'active' : ''}`} onClick={() => setActiveCategory(category.id)}>{category.label}</button>)}</div></section>
    <button className="map-stamp" onClick={() => { setSelected(null); setDraft(null); setResetSignal((value) => value + 1) }} title="回到地图起点"><span>赭山校区</span><small>安徽师范大学 → 点我回去</small></button>
    {statusMessage && <div className="map-status-note">{statusMessage}</div>}
    <div className="map-legend">{categoryConfig.map((category) => <span key={category.id}><i className="legend-dot" style={{ background: category.color }} />{category.label}</span>)}</div>
    {debugEnabled && !draft && <div className="debug-hint">点击地图放置新的推荐点</div>}
    {draft && <DebugForm draft={draft} setDraft={setDraft} onClose={() => setDraft(null)} />}
    {drawer && <aside className="recommendation-drawer"><div className="drawer-handle" /><div className="drawer-heading"><div><p className="section-kicker">TODAY'S PICKS</p><h2>附近值得去</h2></div><button className="drawer-close" onClick={() => setDrawer(false)} aria-label="关闭推荐">×</button></div><div className="drawer-filters"><span>{filtered.length} 个地点</span><span>学长精选 · 静态内容</span></div><div className="place-list">{filtered.map((place) => <article key={place.id} role="button" tabIndex="0" className={`place-card ${selected?.id === place.id ? 'selected' : ''} ${place.cover ? '' : 'no-image'}`} onClick={() => selectPlace(place)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectPlace(place) }}>{place.cover && <div className="place-image" style={{ backgroundImage: `url(${place.cover})` }}><span className="place-category" style={{ background: categoryById[place.category]?.color }}>{place.categoryLabel}</span>{place.rating !== appConfig.defaultRating && <span className="rating">★ {place.rating}</span>}</div>}<div className="place-body"><div className="place-title"><h3>{place.name}</h3><span className="arrow">↗</span></div><p className="place-address">{place.address}</p><div className="tag-row">{place.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><p className="quote">“{place.recommendation}”</p></div></article>)}</div></aside>}
    {selected && <div className={`detail-drawer ${selected.cover ? '' : 'no-image'}`}><button className="drawer-close" onClick={() => setSelected(null)} aria-label="关闭详情">×</button>{selected.cover && <div className="drawer-image" style={{ backgroundImage: `url(${selected.cover})` }} />}<div className="drawer-content"><div className="drawer-meta"><span className="place-category" style={{ background: categoryById[selected.category]?.color }}>{selected.categoryLabel}</span>{selected.rating !== appConfig.defaultRating && <span>★ {selected.rating}</span>}</div><h2>{selected.name}</h2><p className="drawer-address">{selected.address}</p><div className="detail-grid">{selected.details.map((detail) => <div key={detail.key}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}</div><div className="senior-note"><div className="avatar">学</div><div><span className="note-label">学长说</span><p>{selected.recommendation}</p></div></div><div className="tip-line"><span>TIP</span>{selected.tip}</div>{selected.highlights.length > 0 && <div className="highlight-list">{selected.highlights.map((item) => <span key={item}>✓ {item}</span>)}</div>}</div></div>}
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
