import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
  const [active, setActive] = useState(false)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  const rememberToken = (token) => {
    if (token) {
      cachedToken = token
      cachedAt = Date.now()
    }
    onToken?.(token)
  }

  useEffect(() => {
    let disposed = false
    if (!siteKey) {
      rememberToken('development')
      return undefined
    }
    loadTurnstile().then((turnstile) => {
      if (disposed || !containerRef.current || widgetIdRef.current !== null) return
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        ...(autoExecute ? { execution: 'execute', appearance: 'interaction-only' } : {}),
        callback: rememberToken,
        'expired-callback': () => {
          clearPreloadedToken()
          onError?.('安全验证已过期，请重试')
        },
        'error-callback': () => onError?.('安全验证失败，请重试'),
      })
      if (autoExecute) {
        setActive(true)
        turnstile.execute(widgetIdRef.current)
      }
    }).catch((error) => { if (!disposed) onError?.(error.message || '安全验证加载失败') })
    return () => { disposed = true }
  }, [autoExecute, onError, onToken, siteKey])

  useImperativeHandle(ref, () => ({
    async execute() {
      if (!siteKey) {
        rememberToken('development')
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
            callback: rememberToken,
            'expired-callback': () => { clearPreloadedToken(); onError?.('安全验证已过期，请重试') },
            'error-callback': () => onError?.('安全验证失败，请重试'),
          })
        }
        turnstile.execute(widgetIdRef.current)
      } catch (error) {
        setActive(false)
        onError?.(error.message || '安全验证加载失败')
      }
    },
    reset() {
      if (window.turnstile && widgetIdRef.current !== null) window.turnstile.reset(widgetIdRef.current)
      setActive(false)
      clearPreloadedToken()
    },
  }), [onError, siteKey])

  return <div className={`turnstile-box ${autoExecute ? 'preloaded-turnstile' : ''} ${active ? 'active' : ''}`} ref={containerRef} />
})

export default Turnstile
