import React, { useEffect } from 'react'

export default function ImageLightbox({ src, alt = '', onClose }) {
  useEffect(() => {
    if (!src) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [src, onClose])

  if (!src) return null
  return <div className="image-lightbox" role="presentation" onClick={onClose}><div className="image-lightbox-stage" role="dialog" aria-modal="true" aria-label="图片预览" onClick={(event) => event.stopPropagation()}><button className="image-lightbox-close" onClick={onClose} aria-label="关闭图片预览">×</button><img src={src} alt={alt} /></div></div>
}
