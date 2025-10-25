import firestore from '@react-native-firebase/firestore';
import { AccountStatus, AuditLog, UserPermissions, UserRole } from '../types/UserProfile.d';

// ============================================================================
// RATE LIMITING - Prevent brute force attacks
// ============================================================================

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

const RATE_LIMIT_CONFIG = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  lockoutDurationMs: 30 * 60 * 1000, // 30 minutes lockout
};

export const checkRateLimit = (identifier: string): { 
  allowed: boolean; 
  retryAfter?: number;
  attemptsRemaining?: number;
} => {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry) {
    rateLimitMap.set(identifier, {
      count: 1,
      firstAttempt: now,
      lastAttempt: now,
    });
    return { allowed: true, attemptsRemaining: RATE_LIMIT_CONFIG.maxAttempts - 1 };
  }

  // Check if window has expired
  if (now - entry.firstAttempt > RATE_LIMIT_CONFIG.windowMs) {
    // Reset counter
    rateLimitMap.set(identifier, {
      count: 1,
      firstAttempt: now,
      lastAttempt: now,
    });
    return { allowed: true, attemptsRemaining: RATE_LIMIT_CONFIG.maxAttempts - 1 };
  }

  // Check if lockout period is active
  if (entry.count >= RATE_LIMIT_CONFIG.maxAttempts) {
    const lockoutEnd = entry.lastAttempt + RATE_LIMIT_CONFIG.lockoutDurationMs;
    if (now < lockoutEnd) {
      const retryAfter = Math.ceil((lockoutEnd - now) / 1000 / 60); // minutes
      return { allowed: false, retryAfter, attemptsRemaining: 0 };
    } else {
      // Lockout expired, reset
      rateLimitMap.set(identifier, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
      });
      return { allowed: true, attemptsRemaining: RATE_LIMIT_CONFIG.maxAttempts - 1 };
    }
  }

  // Increment counter
  entry.count += 1;
  entry.lastAttempt = now;
  rateLimitMap.set(identifier, entry);

  return { allowed: true, attemptsRemaining: RATE_LIMIT_CONFIG.maxAttempts - entry.count };
};

export const resetRateLimit = (identifier: string): void => {
  rateLimitMap.delete(identifier);
};

// ============================================================================
// ROLE-BASED ACCESS CONTROL (RBAC)
// ============================================================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  user: 1,
  admin: 2,
  superadmin: 3,
};

const DEFAULT_PERMISSIONS: Record<UserRole, UserPermissions> = {
  user: {
    canManageUsers: false,
    canViewAnalytics: false,
    canModifySettings: false,
    canViewAuditLogs: false,
    canManageAdmins: false,
    canAccessSuperAdminPanel: false,
  },
  admin: {
    canManageUsers: true,
    canViewAnalytics: true,
    canModifySettings: true,
    canViewAuditLogs: true,
    canManageAdmins: false,
    canAccessSuperAdminPanel: false,
  },
  superadmin: {
    canManageUsers: true,
    canViewAnalytics: true,
    canModifySettings: true,
    canViewAuditLogs: true,
    canManageAdmins: true,
    canAccessSuperAdminPanel: true,
  },
};

export const hasRole = (userRole: UserRole, requiredRole: UserRole): boolean => {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
};

export const hasPermission = (
  userPermissions: UserPermissions,
  requiredPermission: keyof UserPermissions
): boolean => {
  return userPermissions[requiredPermission] === true;
};

export const getDefaultPermissions = (role: UserRole): UserPermissions => {
  return { ...DEFAULT_PERMISSIONS[role] };
};

export const canAccessAdminPanel = (role: UserRole): boolean => {
  return hasRole(role, 'admin');
};

export const canAccessSuperAdminPanel = (role: UserRole, permissions: UserPermissions): boolean => {
  return role === 'superadmin' && permissions.canAccessSuperAdminPanel === true;
};

export const logAuditEvent = async (auditLog: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> => {
  try {
    const logEntry: AuditLog = {
      ...auditLog,
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };

    await firestore().collection('audit_logs').add(logEntry);

    if (__DEV__) {
      console.log('[AUDIT LOG]', {
        action: logEntry.action,
        user: logEntry.userEmail,
        category: logEntry.category,
        severity: logEntry.severity,
        success: logEntry.success,
      });
    }

    // Alert on critical security events
    if (logEntry.severity === 'critical') {
      if (__DEV__) {
        console.error('[CRITICAL SECURITY EVENT]', logEntry);
      }
      // TODO: Implement real-time alerting (e.g., push notification to super admins)
    }
  } catch (error) {
    if (__DEV__) {
      console.error('[AUDIT LOG ERROR]', error);
    }
    // Fallback: Store locally if Firestore fails
    // TODO: Implement local persistence for audit logs
  }
};

// ============================================================================
// ACCOUNT STATUS MANAGEMENT
// ============================================================================

export const isAccountActive = (status: AccountStatus): boolean => {
  return status === 'active';
};

export const isAccountLocked = (status: AccountStatus): boolean => {
  return status === 'locked';
};

export const isAccountSuspended = (status: AccountStatus): boolean => {
  return status === 'suspended';
};

export const shouldLockAccount = (failedAttempts: number): boolean => {
  return failedAttempts >= 5;
};

// ============================================================================
// DATA SANITIZATION & VALIDATION
// ============================================================================

export const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '') // Basic XSS prevention
    .substring(0, 1000); // Prevent DoS via large inputs
};

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isStrongPassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Generate a secure session token using timestamp and random values
 * Note: For production, consider using expo-crypto or similar for stronger randomness
 */
export const generateSessionToken = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart1 = Math.random().toString(36).substring(2, 15);
  const randomPart2 = Math.random().toString(36).substring(2, 15);
  const randomPart3 = Math.random().toString(36).substring(2, 15);
  return `${timestamp}_${randomPart1}${randomPart2}${randomPart3}`;
};

/**
 * Simple hash function for token comparison
 * Note: For production, use a proper crypto library
 */
export const hashToken = (token: string): string => {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
};

export const getSecurityRecommendations = (): string[] => {
  return [
    'Enable Multi-Factor Authentication (MFA)',
    'Use strong, unique passwords',
    'Review login activity regularly',
    'Keep your app updated',
    'Be cautious of phishing attempts',
    'Never share your credentials',
    'Use a secure network connection',
  ];
};

// ============================================================================
// IP & DEVICE FINGERPRINTING (for audit logs)
// ============================================================================

export const getDeviceInfo = (): { deviceInfo: string } => {
  // In a real implementation, use expo-device or similar
  return {
    deviceInfo: 'React Native Mobile App',
  };
};

// ============================================================================
// FIRESTORE SECURITY HELPERS
// ============================================================================

export const createSecureUserDocument = async (
  uid: string,
  email: string,
  displayName: string,
  role: UserRole = 'user'
): Promise<void> => {
  const now = new Date();
  
  const userDoc = {
    uid,
    email: sanitizeInput(email),
    displayName: sanitizeInput(displayName),
    role,
    permissions: getDefaultPermissions(role),
    accountStatus: 'active' as AccountStatus,
    security: {
      lastLogin: now,
      lastPasswordChange: now,
      failedLoginAttempts: 0,
      mfaEnabled: false,
      loginHistory: [],
    },
    createdAt: now,
    updatedAt: now,
  };

  await firestore().collection('users').doc(uid).set(userDoc);

  // Log account creation
  await logAuditEvent({
    userId: uid,
    userEmail: email,
    userRole: role,
    action: 'ACCOUNT_CREATED',
    category: 'auth',
    severity: 'info',
    details: { role, accountStatus: 'active' },
    success: true,
  });
};

// ============================================================================
// PERMISSION VALIDATION ERRORS
// ============================================================================

export class InsufficientPermissionsError extends Error {
  constructor(requiredPermission: string) {
    super(`Insufficient permissions: ${requiredPermission} required`);
    this.name = 'InsufficientPermissionsError';
  }
}

export class AccountLockedError extends Error {
  constructor(retryAfter?: number) {
    super(
      retryAfter
        ? `Account locked. Try again in ${retryAfter} minutes`
        : 'Account locked. Contact administrator'
    );
    this.name = 'AccountLockedError';
  }
}

export class RateLimitExceededError extends Error {
  constructor(retryAfter: number) {
    super(`Too many attempts. Try again in ${retryAfter} minutes`);
    this.name = 'RateLimitExceededError';
  }
}
