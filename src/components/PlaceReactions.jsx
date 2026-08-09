import { useEffect, useState } from "react";
import { loadPlaceReactions, setPlaceReaction } from "../lib/supabase";

const REACTIONS = [
  { value: "like", emoji: "👍", label: "赞同" },
  { value: "love", emoji: "❤️", label: "喜欢" },
  { value: "fire", emoji: "🔥", label: "很棒" },
  { value: "want_to_go", emoji: "👀", label: "想去" },
];

const emptySummary = () =>
  Object.fromEntries(
    REACTIONS.map(({ value }) => [value, { count: 0, selected: false }]),
  );

function rowsToSummary(rows = []) {
  const summary = emptySummary();
  rows.forEach((row) => {
    if (summary[row.reaction_value])
      summary[row.reaction_value] = {
        count: Number(row.reaction_count),
        selected: row.selected,
      };
  });
  return summary;
}

export default function PlaceReactions({ placeId }) {
  const [summary, setSummary] = useState(emptySummary);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setSummary(emptySummary());
    setLoading(true);
    setError("");
    loadPlaceReactions(placeId)
      .then((rows) => {
        if (active) setSummary(rowsToSummary(rows));
      })
      .catch(() => {
        if (active) setError("响应暂时无法加载");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [placeId]);

  const react = async (reaction) => {
    if (pending) return;
    const nextReaction = summary[reaction].selected ? null : reaction;
    setPending(true);
    setError("");
    try {
      setSummary(rowsToSummary(await setPlaceReaction(placeId, nextReaction)));
    } catch {
      setError("响应未保存，请重试");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="place-reactions" aria-label="地点表情响应">
      <div className="reaction-heading">
        <span>用表情回应这个推荐</span>
        {error && <small role="status">{error}</small>}
      </div>
      <div className="reaction-list">
        {REACTIONS.map(({ value, emoji, label }) => (
          <button
            key={value}
            type="button"
            className={summary[value].selected ? "selected" : ""}
            onClick={() => react(value)}
            disabled={loading || pending}
            aria-pressed={summary[value].selected}
            aria-label={`${label}，${summary[value].count} 人`}
            title={label}
          >
            <span aria-hidden="true">{emoji}</span>
            <b>{summary[value].count}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
