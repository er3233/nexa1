import React from "react";

export function ChatListSkeleton() {
  return (
    <div className="px-3 space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 p-3">
          <div className="w-[46px] h-[46px] rounded-full nx-shimmer shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 rounded-full nx-shimmer" style={{ width: "38%" }} />
            <div className="h-2.5 rounded-full nx-shimmer" style={{ width: "64%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageSkeleton() {
  const rows = [
    { w: "52%", mine: false }, { w: "36%", mine: true },
    { w: "61%", mine: false }, { w: "44%", mine: true },
  ];
  return (
    <div className="space-y-3 px-1 py-2">
      {rows.map((r, i) => (
        <div key={i} className={`flex ${r.mine ? "justify-end" : "justify-start"}`}>
          <div className="h-10 rounded-[20px] nx-shimmer" style={{ width: r.w, maxWidth: "82%" }} />
        </div>
      ))}
    </div>
  );
}
