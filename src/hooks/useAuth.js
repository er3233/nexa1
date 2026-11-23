import { useState, useEffect, useCallback } from "react";
import { getSession, onAuthChange } from "../services/auth";
import { getMyProfile } from "../services/profiles";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [recovery, setRecovery] = useState(false);

  const loadProfile = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      const p = await getMyProfile(uid);
      setProfile(p);
    } catch (_) {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    getSession()
      .then((s) => {
        if (!mounted) return;
        setSession(s);
        setLoading(false);
        if (s?.user?.id) loadProfile(s.user.id);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const {
      data: { subscription },
    } = onAuthChange((s, event) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (s?.user?.id) loadProfile(s.user.id);
      else setProfile(null);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadProfile]);

  const user = session?.user ?? null;

  const banned = !!profile?.banned_at;
  const deactivated = !!profile?.deactivated_at;
  const approvalStatus = profile?.approval_status || null;

  return {
    session,
    user,
    loading,
    profile,
    profileLoading,
    isAdmin: profile?.role === "admin",
    isModerator: profile?.role === "admin" || profile?.role === "moderator",
    banned,
    banReason: profile?.ban_reason || null,
    deactivated,
    deactivationReason: profile?.deactivation_reason || null,
    approvalStatus,
    rejectionReason: profile?.rejection_reason || null,
    // Onaylı = approved + yasaksız + devre dışı değil (backend ile aynı mantık).
    approved: approvalStatus === "approved" && !banned && !deactivated,
    recovery,
    clearRecovery: () => setRecovery(false),
    refreshProfile: () => loadProfile(user?.id),
  };
}
