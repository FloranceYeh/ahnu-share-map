import React, { useEffect, useMemo } from "react";

export default function ImageLightbox({
  src,
  images = [],
  alt = "",
  onChange,
  onClose,
}) {
  const gallery = useMemo(
    () => [...new Set([...(images || []), src].filter(Boolean))],
    [images, src],
  );
  const currentIndex = Math.max(0, gallery.indexOf(src));
  const canNavigate = gallery.length > 1;
  const move = (offset) => {
    if (!canNavigate) return;
    const nextIndex = (currentIndex + offset + gallery.length) % gallery.length;
    onChange?.(gallery[nextIndex], nextIndex);
  };

  useEffect(() => {
    if (!src) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [src, onClose, currentIndex, canNavigate, gallery, onChange]);

  if (!src) return null;
  return (
    <div className="image-lightbox" role="presentation" onClick={onClose}>
      <div
        className="image-lightbox-stage"
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="image-lightbox-close"
          onClick={onClose}
          aria-label="关闭图片预览"
        >
          ×
        </button>
        {canNavigate && (
          <button
            className="image-lightbox-nav image-lightbox-prev"
            onClick={() => move(-1)}
            aria-label="上一张图片"
          >
            ‹
          </button>
        )}
        <img src={src} alt={alt} />
        {canNavigate && (
          <button
            className="image-lightbox-nav image-lightbox-next"
            onClick={() => move(1)}
            aria-label="下一张图片"
          >
            ›
          </button>
        )}
        {canNavigate && (
          <span className="image-lightbox-count">
            {currentIndex + 1} / {gallery.length}
          </span>
        )}
      </div>
    </div>
  );
}
