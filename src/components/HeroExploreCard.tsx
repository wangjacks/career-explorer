"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";

export default function HeroExploreCard() {
  const [expanded, setExpanded] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Respect prefers-reduced-motion
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    // nothing else for now
  }, [reducedMotion]);

  return (
    <div className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-80" ref={hostRef}>
      <div
        className={`bg-white/95 text-stone-900 rounded-2xl p-4 shadow-2xl border border-white/20 transform transition-all duration-200 ease-out ${expanded ? "scale-100" : "scale-95"}`}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((s) => !s)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((s) => !s);
            }
          }}
          className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-accent text-stone-900"><Compass size={24} strokeWidth={1.5} /></div>
            <div>
              <div className="text-sm font-semibold">快速了解：学生探索流程</div>
              <div className="text-xs text-stone-500 mt-1">步骤化引导 · 约 6 步完成</div>
            </div>
          </div>
        </button>

        <div
          className={`mt-3 text-sm space-y-2 overflow-hidden ${expanded ? "max-h-80 opacity-100" : "max-h-0 opacity-0"} transition-all duration-200 ease-out`}
          aria-hidden={!expanded}
        >
          <ul className="">
            <li className="flex items-start gap-2"><span className="text-accent font-semibold">1.</span><span>选择标签（兴趣 / 技能 / 性格）</span></li>
            <li className="flex items-start gap-2"><span className="text-accent font-semibold">2.</span><span>上传词云与评价</span></li>
            <li className="flex items-start gap-2"><span className="text-accent font-semibold">3.</span><span>上传虚拟形象并确认提交</span></li>
          </ul>
          <div className="mt-3 text-right">
            <Link href="/form/create-profile" className="text-sm font-semibold text-accent hover:underline" aria-label="浏览学生探索流程">查看流程</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
