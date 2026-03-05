import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { touchSession, cleanupExpiredSessions } from "./channel.js";

/**
 * Tests for session cleanup functionality (fixes #34).
 *
 * The module-level Maps (_historyMaps, _memberMaps, etc.) were growing
 * unboundedly. This fix adds session expiry tracking and periodic cleanup.
 */
describe("session cleanup", () => {
  // Use unique account IDs per test to avoid state pollution
  let testCounter = 0;
  const getUniqueAccount = () => `test-account-${Date.now()}-${++testCounter}`;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should track session access with touchSession", () => {
    const accountId = getUniqueAccount();
    const sessionId = "session-1";

    // Touch session should not throw
    expect(() => touchSession(accountId, sessionId)).not.toThrow();
  });

  it("should not clean up recently accessed sessions", () => {
    const accountId = getUniqueAccount();
    const sessionId = "session-recent";

    // Touch session now
    touchSession(accountId, sessionId);

    // Advance time by 1 hour (less than 24 hour expiry)
    vi.advanceTimersByTime(60 * 60 * 1000);

    // Should not clean up anything
    const cleaned = cleanupExpiredSessions(accountId);
    expect(cleaned).toBe(0);
  });

  it("should clean up sessions after expiry period", () => {
    const accountId = getUniqueAccount();
    const sessionId = "session-old";

    // Touch session
    touchSession(accountId, sessionId);

    // Advance time by 25 hours (more than 24 hour expiry)
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    // Should clean up the expired session
    const mockLog = { info: vi.fn() };
    const cleaned = cleanupExpiredSessions(accountId, mockLog);
    expect(cleaned).toBe(1);
    expect(mockLog.info).toHaveBeenCalled();
  });

  it("should keep active sessions and only clean expired ones", () => {
    const accountId = getUniqueAccount();
    const oldSession = "session-old-2";
    const newSession = "session-new";

    // Touch old session
    touchSession(accountId, oldSession);

    // Advance 20 hours
    vi.advanceTimersByTime(20 * 60 * 60 * 1000);

    // Touch new session
    touchSession(accountId, newSession);

    // Advance 5 more hours (old session is now 25h, new is 5h)
    vi.advanceTimersByTime(5 * 60 * 60 * 1000);

    // Should only clean old session
    const cleaned = cleanupExpiredSessions(accountId);
    expect(cleaned).toBe(1);
  });

  it("should return 0 when no sessions exist", () => {
    const cleaned = cleanupExpiredSessions("nonexistent-account");
    expect(cleaned).toBe(0);
  });

  it("should handle multiple expired sessions", () => {
    const accountId = "test-multi-cleanup";

    // Touch multiple sessions
    touchSession(accountId, "session-a");
    touchSession(accountId, "session-b");
    touchSession(accountId, "session-c");

    // Advance 25 hours
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    // All should be cleaned
    const cleaned = cleanupExpiredSessions(accountId);
    expect(cleaned).toBe(3);
  });

  it("should refresh session expiry when touched again", () => {
    const accountId = "test-refresh";
    const sessionId = "session-refresh";

    // Touch session
    touchSession(accountId, sessionId);

    // Advance 20 hours
    vi.advanceTimersByTime(20 * 60 * 60 * 1000);

    // Touch again (refresh)
    touchSession(accountId, sessionId);

    // Advance 20 more hours (total 40h, but only 20h since last touch)
    vi.advanceTimersByTime(20 * 60 * 60 * 1000);

    // Should NOT be cleaned (only 20h since last access)
    const cleaned = cleanupExpiredSessions(accountId);
    expect(cleaned).toBe(0);

    // Advance 5 more hours (now 25h since last touch)
    vi.advanceTimersByTime(5 * 60 * 60 * 1000);

    // Now should be cleaned
    const cleanedAfter = cleanupExpiredSessions(accountId);
    expect(cleanedAfter).toBe(1);
  });
});
