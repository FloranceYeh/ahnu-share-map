import { useEffect, useRef, useState } from "react";

const SORT_OPTIONS = [
  ["distance", "距离最近"],
  ["response", "响应最多"],
  ["combined", "综合推荐"],
];

export default function RecommendationDrawer({
  places,
  selectedPlaceId,
  defaultRating,
  sortMode,
  onSortModeChange,
  onClose,
  onSelectPlace,
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  useEffect(() => {
    const close = (event) => {
      if (!sortRef.current?.contains(event.target)) setSortOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const currentSortLabel = SORT_OPTIONS.find(([value]) => value === sortMode)?.[1] || "综合推荐";
  return (
    <aside className="recommendation-drawer">
      <div className="drawer-handle" />
      <div className="drawer-heading">
        <div>
          <p className="section-kicker">SUGGESTED PLACES</p>
          <h2>附近值得去</h2>
        </div>
        <button
          className="drawer-close"
          onClick={onClose}
          aria-label="关闭推荐"
        >
          ×
        </button>
      </div>
      <div className="drawer-filters">
        <span>{places.length} 个地点</span>
        <div className="sort-select" ref={sortRef}>
          <span>排序</span>
          <button
            type="button"
            className={`apple-select-trigger ${sortOpen ? "is-open" : ""}`}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((open) => !open)}
          >
            {currentSortLabel}<span aria-hidden="true">⌄</span>
          </button>
          {sortOpen && (
            <div className="apple-select-menu" role="listbox" aria-label="排序方式">
              {SORT_OPTIONS.map(([value, label]) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={sortMode === value}
                  className={sortMode === value ? "is-selected" : ""}
                  key={value}
                  onClick={() => {
                    onSortModeChange(value);
                    setSortOpen(false);
                  }}
                >
                  {label}
                  {sortMode === value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="place-list">
        {places.map((place) => (
          <article
            key={place.id}
            role="button"
            tabIndex="0"
            className={`place-card ${selectedPlaceId === place.id ? "selected" : ""} ${place.cover ? "" : "no-image"}`}
            onClick={() => onSelectPlace(place)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                onSelectPlace(place);
            }}
          >
            {place.cover && (
              <div
                className="place-image"
                style={{ backgroundImage: `url(${place.cover})` }}
              >
                <span
                  className="place-category"
                  style={{ background: place.color }}
                >
                  {place.categoryLabel}
                </span>
                {place.rating !== defaultRating && (
                  <span className="rating">★ {place.rating}</span>
                )}
              </div>
            )}
            <div className="place-body">
              <div className="place-title">
                <h3>{place.name}</h3>
                <span className="arrow">↗</span>
              </div>
              <p className="place-address">{place.address}</p>
              <div className="tag-row">
                {place.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
              <p className="quote">“{place.recommendation}”</p>
              {place.reactions?.some(
                (reaction) => Number(reaction.reaction_count) > 0,
              ) && (
                <div className="place-reaction-summary" aria-label="表情响应">
                  {place.reactions
                    .filter((reaction) => Number(reaction.reaction_count) > 0)
                    .map((reaction) => (
                    <span key={reaction.reaction_value}>
                      {reaction.reaction_emoji} {reaction.reaction_count}
                    </span>
                    ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
