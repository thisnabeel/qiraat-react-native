import { useState, useEffect } from "react";

/**
 * Verser toggle for mushaf 2; clears when another qiraat is selected or mushaf changes.
 */
export function useVerserMode({ mushafId, selectedNarrators }) {
  const [verserMode, setVerserMode] = useState(false);

  useEffect(() => {
    const onlyHafs = !selectedNarrators.some((id) => id !== "hafs-an-asim");
    if (!onlyHafs || mushafId !== 2) setVerserMode(false);
  }, [selectedNarrators, mushafId]);

  return [verserMode, setVerserMode];
}
