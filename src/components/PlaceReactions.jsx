import { useEffect, useState } from "react";
import { loadPlaceReactions, setPlaceReaction } from "../lib/supabase";

const emptySummary = (reactions = []) =>
  Object.fromEntries(
    reactions.map(({ value }) => [value, { count: 0, selected: false }]),
  );

function rowsToSummary(rows = [], reactions = []) {
  const configuredReactions = rows.length
    ? rows.map((row) => ({
        value: row.reaction_value,
        emoji: row.reaction_emoji,
        label: row.reaction_label,
      }))
    : reactions;
  const summary = emptySummary(configuredReactions);
  rows.forEach((row) => {
    if (summary[row.reaction_value])
      summary[row.reaction_value] = {
        count: Number(row.reaction_count),
        selected: row.selected,
      };
  });
  return { configuredReactions, summary };
}

export default function PlaceReactions({ placeId, reactions = [] }) {
  const [configuredReactions, setConfiguredReactions] = useState(reactions);
  const [summary, setSummary] = useState(() => emptySummary(reactions));
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setConfiguredReactions(reactions);
    setSummary(emptySummary(reactions));
    setLoading(true);
    setError("");
    loadPlaceReactions(placeId)
      .then((rows) => {
        if (!active) return;
        const next = rowsToSummary(rows, reactions);
        setConfiguredReactions(next.configuredReactions);
        setSummary(next.summary);
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
  }, [placeId, reactions]);

  const react = async (reaction) => {
    if (pending) return;
    const nextReaction = summary[reaction].selected ? null : reaction;
    setPending(true);
    setError("");
    try {
      const next = rowsToSummary(
        await setPlaceReaction(placeId, nextReaction),
        reactions,
      );
      setConfiguredReactions(next.configuredReactions);
      setSummary(next.summary);
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
        {configuredReactions.map(({ value, emoji, label }) => (
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
