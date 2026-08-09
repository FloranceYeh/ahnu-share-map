export default function RecommendationDrawer({
  places,
  selectedPlaceId,
  defaultRating,
  onClose,
  onSelectPlace,
}) {
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
        <span>管理员审核通过</span>
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
