import firestore from '@react-native-firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog, UserPermissions, UserProfile, UserRole } from '../types/UserProfile.d';
import {
  AccountLockedError,
  canAccessAdminPanel,
  canAccessSuperAdminPanel,
  hasPermission,
  hasRole,
  InsufficientPermissionsError,
  isAccountActive,
  logAuditEvent,
} from '../utils/security';

export const useAdminAuth = () => {
  const { user, isAuthenticated } = useAuth();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAdminAccess, setHasAdminAccess] = useState(false);
  const [hasSuperAdminAccess, setHasSuperAdminAccess] = useState(false);

  // Load user profile with role and permissions
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setUserProfile(null);
      setHasAdminAccess(false);
      setHasSuperAdminAccess(false);
      setLoading(false);
      return;
    }

    const unsubscribe = firestore()
      .collection('users')
      .doc(user.uid)
      .onSnapshot(
        (doc) => {
          if (doc.exists) {
            const data = doc.data() as UserProfile;
            setUserProfile(data);

            // Check admin access
            const adminAccess = canAccessAdminPanel(data.role);
            const superAdminAccess = canAccessSuperAdminPanel(data.role, data.permissions);

            setHasAdminAccess(adminAccess);
            setHasSuperAdminAccess(superAdminAccess);

            // Verify account status
            if (!isAccountActive(data.accountStatus)) {
              if (__DEV__) {
                console.warn('[ADMIN AUTH] Account not active:', data.accountStatus);
              }
              setHasAdminAccess(false);
              setHasSuperAdminAccess(false);
            }
          } else {
            if (__DEV__) {
              console.error('[ADMIN AUTH] User profile not found');
            }
            setUserProfile(null);
            setHasAdminAccess(false);
            setHasSuperAdminAccess(false);
          }
          setLoading(false);
        },
        (error) => {
          if (__DEV__) {
            console.error('[ADMIN AUTH] Error loading profile:', error);
          }
          setLoading(false);
        }
      );

    return () => unsubscribe();
  }, [isAuthenticated, user]);

  /**
   * Check if user has required role
   */
  const checkRole = (requiredRole: UserRole): boolean => {
    if (!userProfile) return false;
    return hasRole(userProfile.role, requiredRole);
  };

  /**
   * Check if user has specific permission
   */
  const checkPermission = (permission: keyof UserPermissions): boolean => {
    if (!userProfile) return false;
    return hasPermission(userProfile.permissions, permission);
  };

  /**
   * Require specific role or throw error
   */
  const requireRole = (requiredRole: UserRole): void => {
    if (!userProfile) {
      throw new Error('User profile not loaded');
    }

    if (!isAccountActive(userProfile.accountStatus)) {
      throw new AccountLockedError();
    }

    if (!hasRole(userProfile.role, requiredRole)) {
      logAuditEvent({
        userId: userProfile.uid,
        userEmail: userProfile.email,
        userRole: userProfile.role,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        category: 'security',
        severity: 'warning',
        details: { requiredRole, actualRole: userProfile.role },
        success: false,
      });

      throw new InsufficientPermissionsError(`Role ${requiredRole} required`);
    }
  };

  /**
   * Require specific permission or throw error
   */
  const requirePermission = (permission: keyof UserPermissions): void => {
    if (!userProfile) {
      throw new Error('User profile not loaded');
    }

    if (!isAccountActive(userProfile.accountStatus)) {
      throw new AccountLockedError();
    }

    if (!hasPermission(userProfile.permissions, permission)) {
      logAuditEvent({
        userId: userProfile.uid,
        userEmail: userProfile.email,
        userRole: userProfile.role,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        category: 'security',
        severity: 'warning',
        details: { requiredPermission: permission },
        success: false,
      });

      throw new InsufficientPermissionsError(`Permission ${permission} required`);
    }
  };

  /**
   * Fetch user by ID (admin/superadmin only)
   */
  const getUserById = async (userId: string): Promise<UserProfile | null> => {
    try {
      requirePermission('canManageUsers');

      const doc = await firestore().collection('users').doc(userId).get();

      if (!doc.exists) {
        return null;
      }

      await logAuditEvent({
        userId: userProfile!.uid,
        userEmail: userProfile!.email,
        userRole: userProfile!.role,
        action: 'USER_PROFILE_VIEWED',
        category: 'data_access',
        severity: 'info',
        details: { targetUserId: userId },
        resourceId: userId,
        resourceType: 'user',
        success: true,
      });

      return doc.data() as UserProfile;
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error fetching user:', error);
      }
      throw error;
    }
  };

  /**
   * Update user role (superadmin only)
   */
  const updateUserRole = async (userId: string, newRole: UserRole): Promise<void> => {
    try {
      requireRole('superadmin');
      requirePermission('canManageAdmins');

      // Cannot modify your own role
      if (userId === userProfile!.uid) {
        throw new Error('Cannot modify your own role');
      }

      const userRef = firestore().collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const targetUser = userDoc.data() as UserProfile;

      await userRef.update({
        role: newRole,
        permissions: await import('../utils/security').then(m => m.getDefaultPermissions(newRole)),
        lastModifiedAt: new Date(),
        modifiedBy: userProfile!.uid,
      });

      await logAuditEvent({
        userId: userProfile!.uid,
        userEmail: userProfile!.email,
        userRole: userProfile!.role,
        action: 'USER_ROLE_CHANGED',
        category: 'user_management',
        severity: 'warning',
        details: {
          targetUserId: userId,
          targetEmail: targetUser.email,
          oldRole: targetUser.role,
          newRole,
        },
        resourceId: userId,
        resourceType: 'user',
        success: true,
      });

      Alert.alert('Success', 'User role updated successfully');
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error updating role:', error);
      }

      await logAuditEvent({
        userId: userProfile?.uid || 'unknown',
        userEmail: userProfile?.email || 'unknown',
        userRole: userProfile?.role || 'user',
        action: 'USER_ROLE_CHANGE_FAILED',
        category: 'user_management',
        severity: 'error',
        details: { targetUserId: userId, newRole, error: error.message },
        resourceId: userId,
        resourceType: 'user',
        success: false,
        errorMessage: error.message,
      });

      throw error;
    }
  };

  /**
   * Suspend user account (admin/superadmin only)
   */
  const suspendUser = async (userId: string, reason: string): Promise<void> => {
    try {
      requirePermission('canManageUsers');

      if (userId === userProfile!.uid) {
        throw new Error('Cannot suspend your own account');
      }

      const userRef = firestore().collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const targetUser = userDoc.data() as UserProfile;

      await userRef.update({
        accountStatus: 'suspended',
        lastModifiedAt: new Date(),
        modifiedBy: userProfile!.uid,
      });

      await logAuditEvent({
        userId: userProfile!.uid,
        userEmail: userProfile!.email,
        userRole: userProfile!.role,
        action: 'USER_SUSPENDED',
        category: 'user_management',
        severity: 'warning',
        details: {
          targetUserId: userId,
          targetEmail: targetUser.email,
          reason,
        },
        resourceId: userId,
        resourceType: 'user',
        success: true,
      });

      Alert.alert('Success', 'User account suspended');
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error suspending user:', error);
      }
      throw error;
    }
  };

  /**
   * Reactivate suspended user (admin/superadmin only)
   */
  const reactivateUser = async (userId: string): Promise<void> => {
    try {
      requirePermission('canManageUsers');

      const userRef = firestore().collection('users').doc(userId);
      await userRef.update({
        accountStatus: 'active',
        'security.failedLoginAttempts': 0,
        lastModifiedAt: new Date(),
        modifiedBy: userProfile!.uid,
      });

      await logAuditEvent({
        userId: userProfile!.uid,
        userEmail: userProfile!.email,
        userRole: userProfile!.role,
        action: 'USER_REACTIVATED',
        category: 'user_management',
        severity: 'info',
        details: { targetUserId: userId },
        resourceId: userId,
        resourceType: 'user',
        success: true,
      });

      Alert.alert('Success', 'User account reactivated');
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error reactivating user:', error);
      }
      throw error;
    }
  };

  /**
   * Get all users (admin/superadmin only)
   */
  const getAllUsers = async (): Promise<UserProfile[]> => {
    try {
      if (!userProfile) {
        throw new Error('User profile not loaded');
      }

      requirePermission('canManageUsers');

      const snapshot = await firestore()
        .collection('users')
        .orderBy('createdAt', 'desc')
        .get();

      const users = snapshot.docs.map(doc => doc.data() as UserProfile);

      await logAuditEvent({
        userId: userProfile.uid,
        userEmail: userProfile.email,
        userRole: userProfile.role,
        action: 'USER_LIST_ACCESSED',
        category: 'data_access',
        severity: 'info',
        details: { userCount: users.length },
        success: true,
      });

      return users;
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error fetching users:', error);
      }
      throw error;
    }
  };

  /**
   * Get audit logs (admin/superadmin only)
   */
  const getAuditLogs = async (limit: number = 100): Promise<AuditLog[]> => {
    try {
      if (!userProfile) {
        throw new Error('User profile not loaded');
      }

      requirePermission('canViewAuditLogs');

      const snapshot = await firestore()
        .collection('audit_logs')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const logs = snapshot.docs.map(doc => doc.data() as AuditLog);

      await logAuditEvent({
        userId: userProfile.uid,
        userEmail: userProfile.email,
        userRole: userProfile.role,
        action: 'AUDIT_LOGS_ACCESSED',
        category: 'data_access',
        severity: 'info',
        details: { logCount: logs.length },
        success: true,
      });

      return logs;
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error fetching audit logs:', error);
      }
      throw error;
    }
  };

  /**
   * Delete user account (admin/superadmin only)
   * Admins can only delete non-superadmin users
   * Superadmins can delete any user
   */
  const deleteUser = async (userId: string, reason: string): Promise<void> => {
    try {
      requirePermission('canManageUsers');

      if (userId === userProfile!.uid) {
        throw new Error('Cannot delete your own account');
      }

      const userRef = firestore().collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const targetUser = userDoc.data() as UserProfile;

      // Admins cannot delete superadmins
      if (userProfile!.role === 'admin' && targetUser.role === 'superadmin') {
        throw new Error('Admins cannot delete Super Admin accounts');
      }

      // Delete the user document
      await userRef.delete();

      await logAuditEvent({
        userId: userProfile!.uid,
        userEmail: userProfile!.email,
        userRole: userProfile!.role,
        action: 'USER_DELETED',
        category: 'user_management',
        severity: 'warning',
        details: {
          targetUserId: userId,
          targetEmail: targetUser.email,
          targetRole: targetUser.role,
          reason,
        },
        resourceId: userId,
        resourceType: 'user',
        success: true,
      });

      Alert.alert('Success', 'User account deleted successfully');
    } catch (error: any) {
      if (__DEV__) {
        console.error('[ADMIN AUTH] Error deleting user:', error);
      }

      await logAuditEvent({
        userId: userProfile?.uid || 'unknown',
        userEmail: userProfile?.email || 'unknown',
        userRole: userProfile?.role || 'user',
        action: 'USER_DELETE_FAILED',
        category: 'user_management',
        severity: 'error',
        details: { targetUserId: userId, reason, error: error.message },
        resourceId: userId,
        resourceType: 'user',
        success: false,
        errorMessage: error.message,
      });

      throw error;
    }
  };

  return {
    userProfile,
    loading,
    hasAdminAccess,
    hasSuperAdminAccess,
    checkRole,
    checkPermission,
    requireRole,
    requirePermission,
    getUserById,
    updateUserRole,
    suspendUser,
    reactivateUser,
    deleteUser,
    getAllUsers,
    getAuditLogs,
  };
};

export default useAdminAuth;
