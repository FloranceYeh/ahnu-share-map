import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

const TOKEN_TTL_MS = 4 * 60 * 1000
let cachedToken = ''
let cachedAt = 0

export const getPreloadedToken = () => {
  if (!cachedToken || Date.now() - cachedAt >= TOKEN_TTL_MS) return ''
  return cachedToken
}

export const clearPreloadedToken = () => {
  cachedToken = ''
  cachedAt = 0
}

const loadTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true })
      existing.addEventListener('error', () => reject(new Error('安全验证加载失败')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstile = 'true'
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('安全验证加载失败'))
    document.head.appendChild(script)
  })
}

const Turnstile = forwardRef(function Turnstile({ onToken, onError, autoExecute = false }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  const [active, setActive] = useState(false)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => { onTokenRef.current = onToken }, [onToken])
  useEffect(() => { onErrorRef.current = onError }, [onError])
  useEffect(() => {
    if (siteKey) loadTurnstile().catch(() => {})
  }, [siteKey])

  const handleToken = useCallback((token) => {
    if (token) {
      cachedToken = token
      cachedAt = Date.now()
    }
    onTokenRef.current?.(token)
  }, [])

  const execute = useCallback(async () => {
    if (!siteKey) {
      handleToken('development')
      return
    }
    setActive(true)
    try {
      const turnstile = await loadTurnstile()
      if (widgetIdRef.current === null) {
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          execution: 'execute',
          appearance: 'interaction-only',
          callback: handleToken,
          'expired-callback': () => {
            clearPreloadedToken()
            onErrorRef.current?.('安全验证已过期，请重试')
          },
          'error-callback': () => onErrorRef.current?.('安全验证失败，请重试'),
        })
      }
      turnstile.execute(widgetIdRef.current)
    } catch (error) {
      setActive(false)
      onErrorRef.current?.(error.message || '安全验证加载失败')
    }
  }, [handleToken, siteKey])

  useEffect(() => {
    if (!autoExecute) return undefined
    const timer = window.setTimeout(() => execute(), 0)
    return () => window.clearTimeout(timer)
  }, [autoExecute, execute])

  useImperativeHandle(ref, () => ({
    execute,
    reset() {
      if (window.turnstile && widgetIdRef.current !== null) window.turnstile.reset(widgetIdRef.current)
      setActive(false)
      clearPreloadedToken()
    },
  }), [execute])

  return <div className={`turnstile-box ${autoExecute ? 'preloaded-turnstile' : ''} ${active ? 'active' : ''}`} ref={containerRef} />
})

export default Turnstile
