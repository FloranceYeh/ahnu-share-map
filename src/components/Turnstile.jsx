import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

const TOKEN_TTL_MS = 4 * 60 * 1000
let cachedToken = ''
let cachedAt = 0
const tokenListeners = new Set()
let refreshPreloadedToken = null

const publishToken = (token) => {
  tokenListeners.forEach((listener) => listener(token))
}

export const getPreloadedToken = () => {
  if (!cachedToken || Date.now() - cachedAt >= TOKEN_TTL_MS) return ''
  return cachedToken
}

export const clearPreloadedToken = () => {
  cachedToken = ''
  cachedAt = 0
  publishToken('')
}

export const subscribePreloadedToken = (listener) => {
  tokenListeners.add(listener)
  listener(getPreloadedToken())
  return () => tokenListeners.delete(listener)
}

export const refreshPreloadedTokenNow = () => refreshPreloadedToken?.()

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

const Turnstile = forwardRef(function Turnstile({ onToken, onError, autoExecute = false, displayOnly = false }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [active, setActive] = useState(false)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  const rememberToken = (token) => {
    if (token) {
      cachedToken = token
      cachedAt = Date.now()
      publishToken(token)
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
        ...((autoExecute || displayOnly) ? { execution: 'execute', appearance: autoExecute ? 'interaction-only' : 'always' } : {}),
        callback: rememberToken,
        'expired-callback': () => {
          clearPreloadedToken()
          onError?.('安全验证已过期，请重试')
          if (autoExecute) window.setTimeout(() => turnstile.execute(widgetIdRef.current), 0)
        },
        'error-callback': () => onError?.('安全验证失败，请重试'),
      })
      if (autoExecute) {
        setActive(true)
        refreshPreloadedToken = () => turnstile.execute(widgetIdRef.current)
        turnstile.execute(widgetIdRef.current)
      } else if (displayOnly) {
        setActive(true)
      }
    }).catch((error) => { if (!disposed) onError?.(error.message || '安全验证加载失败') })
    return () => { disposed = true }
  }, [autoExecute, displayOnly, onError, onToken, siteKey])

  useEffect(() => () => {
    if (autoExecute) refreshPreloadedToken = null
  }, [autoExecute])

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
      if (autoExecute) refreshPreloadedToken = null
    },
  }), [onError, siteKey])

  return <div className={`turnstile-box ${autoExecute ? 'preloaded-turnstile' : ''} ${active ? 'active' : ''}`} ref={containerRef} />
})

export default Turnstile
