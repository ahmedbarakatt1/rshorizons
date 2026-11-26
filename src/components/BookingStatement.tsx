"use client";

import {useEffect, useRef} from "react";

export function BookingStatement({text}:{text:string}) {
  const statement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const root = statement.current;
    if (!root || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-read");
          observer.unobserve(entry.target);
        }
      }
    }, {rootMargin: "0px 0px -12% 0px"});
    root.dataset.reveal = "ready";
    for (const word of root.children) observer.observe(word);
    return () => {
      observer.disconnect();
      delete root.dataset.reveal;
    };
  }, [text]);

  return <p ref={statement} className="manual-statement">
    {text.split(/\s+/u).map((word,index) => <span key={index} style={{transitionDelay:`${Math.min(index * 30, 400)}ms`}}>{word} </span>)}
  </p>;
}
