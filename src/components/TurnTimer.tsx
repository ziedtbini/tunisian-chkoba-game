import React, { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";

export const TURN_DURATION_SECONDS = 20;

type Props = {
  turnKey: string;
  active: boolean;
  onExpire?: () => void;
  duration?: number;
  compact?: boolean;
};

export default function TurnTimer({
  turnKey,
  active,
  onExpire,
  duration = TURN_DURATION_SECONDS,
  compact = false,
}: Props) {
  const [remaining, setRemaining] = useState(duration);
  const expireRef = useRef(onExpire);
  const expiredRef = useRef(false);

  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    setRemaining(duration);
    expiredRef.current = false;
    if (!active) return;

    const deadline = Date.now() + duration * 1000;
    const tick = () => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true;
        expireRef.current?.();
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [active, duration, turnKey]);

  const progress = Math.max(0, Math.min(1, remaining / duration));
  const urgent = active && remaining <= 10;

  return (
    <div
      className={cn("turn-timer", compact && "turn-timer--compact", urgent && "turn-timer--urgent", !active && "turn-timer--paused")}
      style={{ "--timer-progress": `${progress * 360}deg` } as React.CSSProperties}
      aria-label={active ? `${remaining} secondes restantes` : "Chronomètre en pause"}
      title={active ? `${remaining} secondes pour jouer` : "Chronomètre en pause"}
    >
      <div className="turn-timer__core">
        <span className="turn-timer__value">{active ? remaining : "–"}</span>
        {!compact && <span className="turn-timer__unit">sec</span>}
      </div>
    </div>
  );
}
