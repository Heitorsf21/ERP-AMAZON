"use client";

import * as React from "react";

/** true enquanto a media query casar. No SSR e no 1º render: false. */
export function useMediaQuery(query: string): boolean {
  const [casa, setCasa] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const atualizar = () => setCasa(mq.matches);
    atualizar();
    mq.addEventListener("change", atualizar);
    return () => mq.removeEventListener("change", atualizar);
  }, [query]);
  return casa;
}
