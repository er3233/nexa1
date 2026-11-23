import React from "react";

function fmtDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Bugün";
  if (diffDays === 1) return "Dün";
  return d.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export default function DayDivider({ date }) {
  return (
    <div className="flex items-center justify-center py-2 nx-in">
      <span
        className="nx-mono text-[9.5px] tracking-[0.14em] px-3 py-1 rounded-full"
        style={{ color: "var(--txt3)", background: "var(--ink2)", border: "1px solid var(--line)" }}
      >
        {fmtDay(date).toUpperCase()}
      </span>
    </div>
  );
}

// Mesajları gün bazında gruplar: [{ key, date, items: [...] }]
export function groupMessagesByDay(messages) {
  const groups = [];
  let currentKey = null;
  let currentGroup = null;
  for (const m of messages) {
    const d = new Date(m.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== currentKey) {
      currentKey = key;
      currentGroup = { key, date: m.created_at, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(m);
  }
  return groups;
}
