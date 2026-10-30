import { useCallback, useEffect, useRef, useState } from "react";
import { createNewRowHighlighter } from "./new-row-highlights.js";

export function useNewRowHighlights(scope) {
  const tracker = useRef(null);
  const [highlighted, setHighlighted] = useState({ scope, ids: new Set() });
  useEffect(() => {
    const current = createNewRowHighlighter({
      onChange: (ids) => setHighlighted({ scope, ids }),
    });
    tracker.current = { scope, current };
    return () => {
      current.dispose();
      if (tracker.current?.current === current) tracker.current = null;
    };
  }, [scope]);
  const observe = useCallback(
    (rows, snapshotScope = "") => {
      if (tracker.current?.scope === scope)
        tracker.current.current.update(rows, snapshotScope);
    },
    [scope],
  );
  return {
    observe,
    isNew: (id) =>
      highlighted.scope === scope && highlighted.ids.has(String(id)),
  };
}
