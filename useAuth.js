import { useState, useEffect, useCallback, useRef } from "react";
import { getSession, onAuthChange } from "../services/auth";
import { getMyProfile } from "../services/profiles";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const profileRequest = useRef(0);

  const loadProfile = useCallback(async (uid) => {
    const request = ++profileRequest.current;
    if (!uid) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    try {
      const p = await getMyProfile(uid);
      if (request === profileRequest.current) setProfile(p);
    } catch (_) {
      if (request === profileRequest.current) setProfile(null);
    } finally {
      if (request === profileRequest.current) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let authEventSeen = false;
    let profileTimer;

    getSession()
      .then((s) => {
        if (!mounted || authEventSeen) return;
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
      if (!mounted) return;
      authEventSeen = true;
      setSession(s);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      // Supabase auth callback içinden başka Supabase çağrısı başlatmayın.
      ++profileRequest.current;
      clearTimeout(profileTimer);
      if (s?.user?.id) {
        setProfile((current) => current?.id === s.user.id ? current : null);
        setProfileLoading(true);
        profileTimer = setTimeout(() => { if (mounted) loadProfile(s.user.id); }, 0);
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      mounted = false;
      ++profileRequest.current;
      clearTimeout(profileTimer);
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
