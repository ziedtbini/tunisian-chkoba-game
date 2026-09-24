import { ActionDeduplicator } from "./authority";
import { createSecureId, type RejectReason } from "./protocol";

export type SessionAdmission =
  | { ok: true; matchId: string; playerToken: string; reconnect: boolean }
  | { ok: false; reason: RejectReason };

export class HostSessionGuard {
  readonly matchId = createSecureId();
  private playerToken: string | null = null;
  private occupied = false;
  private disconnectedAt: number | null = null;
  private readonly actions = new ActionDeduplicator();
  stateVersion = 0;

  join(): SessionAdmission {
    if (this.occupied || this.playerToken) return { ok: false, reason: "ROOM_FULL" };
    this.playerToken = createSecureId();
    this.occupied = true;
    return { ok: true, matchId: this.matchId, playerToken: this.playerToken, reconnect: false };
  }

  disconnect(now = Date.now()): void { this.occupied = false; this.disconnectedAt = now; }

  rejoin(matchId: string, token: string, now = Date.now(), windowMs = 60_000): SessionAdmission {
    if (matchId !== this.matchId || token !== this.playerToken) return { ok: false, reason: "REJOIN_DENIED" };
    if (this.disconnectedAt !== null && now - this.disconnectedAt > windowMs) return { ok: false, reason: "SESSION_EXPIRED" };
    this.occupied = true;
    this.disconnectedAt = null;
    return { ok: true, matchId: this.matchId, playerToken: token, reconnect: true };
  }

  authorize(matchId: string, token: string, actionId: string): RejectReason | null {
    if (matchId !== this.matchId || token !== this.playerToken) return "INVALID_MATCH";
    if (this.actions.has(actionId)) return "DUPLICATE_ACTION";
    this.actions.add(actionId);
    return null;
  }

  validate(matchId: string, token: string): RejectReason | null {
    return matchId === this.matchId && token === this.playerToken ? null : "INVALID_MATCH";
  }

  nextVersion(): number { this.stateVersion += 1; return this.stateVersion; }
  close(): void { this.occupied = false; this.playerToken = null; this.actions.clear(); }
}

export class SingleChargeGuard {
  private charged = false;
  consumeOnce(consume: () => void): boolean {
    if (this.charged) return false;
    this.charged = true;
    consume();
    return true;
  }
  reset(): void { this.charged = false; }
}
