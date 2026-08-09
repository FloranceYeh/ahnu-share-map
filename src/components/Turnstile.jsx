import React, { useEffect, useRef } from "react";

export default function Turnstile({ onToken }) {
  const ref = useRef(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!siteKey) {
      onToken("development");
      return undefined;
    }
    const render = () => {
      if (window.turnstile && ref.current)
        window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: onToken,
          "expired-callback": () => onToken(""),
        });
    };
    const existing = document.querySelector("script[data-turnstile]");
    if (existing) {
      existing.addEventListener("load", render);
      render();
    } else {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      if (window.turnstile && ref.current)
        window.turnstile.remove?.(ref.current);
    };
  }, [onToken, siteKey]);
  return <div className="turnstile-box" ref={ref} />;
}
