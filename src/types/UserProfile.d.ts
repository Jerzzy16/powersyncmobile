// UserProfile.ts

export type UserRole = 'user' | 'admin' | 'superadmin';
export type AccountStatus = 'active' | 'suspended' | 'locked' | 'pending';

export interface UserPermissions {
  canManageUsers?: boolean;
  canViewAnalytics?: boolean;
  canModifySettings?: boolean;
  canViewAuditLogs?: boolean;
  canManageAdmins?: boolean;
  canAccessSuperAdminPanel?: boolean;
}

export interface SecurityMetadata {
  lastLogin?: Date;
  lastPasswordChange?: Date;
  failedLoginAttempts: number;
  lastFailedLogin?: Date;
  accountLockedUntil?: Date;
  mfaEnabled: boolean;
  mfaSecret?: string;
  sessionToken?: string;
  loginHistory: Array<{
    timestamp: Date;
    ipAddress?: string;
    deviceInfo?: string;
    location?: string;
    success: boolean;
  }>;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  height: number;
  weight: number;
  age: number;
  email: string;
  profileImageUrl?: string;  
  createdAt: Date;
  updatedAt?: Date;
  
  // Security & Role-Based Access Control (RBAC)
  role: UserRole;
  permissions: UserPermissions;
  accountStatus: AccountStatus;
  security: SecurityMetadata;
  
  // Audit Trail
  createdBy?: string;
  modifiedBy?: string;
  lastModifiedAt?: Date;
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  category: 'auth' | 'user_management' | 'system' | 'security' | 'data_access';
  severity: 'info' | 'warning' | 'error' | 'critical';
  details: any;
  ipAddress?: string;
  userAgent?: string;
  resourceId?: string;
  resourceType?: string;
  success: boolean;
  errorMessage?: string;
}