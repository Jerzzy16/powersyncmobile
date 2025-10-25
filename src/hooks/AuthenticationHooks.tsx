// hooks/AuthenticationHooks.ts (or wherever your hook is located)
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "react-native";
import type { AccountStatus, UserProfile } from '../types/UserProfile.d';
import {
    checkRateLimit,
    generateSessionToken,
    getDefaultPermissions,
    hashToken,
    isAccountActive,
    logAuditEvent,
    resetRateLimit,
    shouldLockAccount
} from '../utils/security';

export const useAuthentication = () => {
  const [loading, setLoading] = useState(false);

  const {
    register,
    setValue,
    handleSubmit,
    watch,
    formState: { errors },
    trigger,
  } = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      age: "",
      height: "",
      weight: "",
    },
  });

  const onLogin = async (data: any) => {
    setLoading(true);
    const email = data.email?.toLowerCase().trim();
    
    try {
      // 1. Check rate limiting BEFORE attempting login
      const rateLimitCheck = await checkRateLimit(email);
      if (!rateLimitCheck.allowed) {
        const minutesLeft = Math.ceil(rateLimitCheck.retryAfter! / 60);
        if (__DEV__) {
          console.warn(`[AUTH] Rate limit exceeded for ${email}. Retry after ${minutesLeft} minutes`);
        }
        
        await logAuditEvent({
          userId: 'unknown',
          userEmail: email,
          userRole: 'user',
          action: 'login_rate_limited',
          category: 'security',
          severity: 'warning',
          details: { 
            attemptsRemaining: rateLimitCheck.attemptsRemaining,
            retryAfter: rateLimitCheck.retryAfter 
          },
          success: false,
          errorMessage: 'Too many login attempts'
        });
        
        Alert.alert(
          "Too Many Attempts",
          `Account temporarily locked. Please try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`
        );
        throw new Error('RATE_LIMIT_EXCEEDED');
      }

      // 2. Attempt Firebase authentication
      const userCredential = await auth().signInWithEmailAndPassword(email, data.password);
      const user = userCredential.user;

      // 3. Fetch user profile to check account status
      const userDoc = await firestore().collection('users').doc(user.uid).get();
      const userProfile = userDoc.data() as UserProfile;

      // 4. Check account status (suspended/locked)
      if (!isAccountActive(userProfile.accountStatus)) {
        if (__DEV__) {
          console.warn(`[AUTH] Login blocked - account status: ${userProfile.accountStatus}`);
        }
        
        await auth().signOut(); // Force logout
        
        await logAuditEvent({
          userId: user.uid,
          userEmail: email,
          userRole: userProfile.role || 'user',
          action: 'login_blocked_inactive_account',
          category: 'security',
          severity: 'warning',
          details: { accountStatus: userProfile.accountStatus },
          success: false,
          errorMessage: `Account is ${userProfile.accountStatus}`
        });
        
        const statusMessage = userProfile.accountStatus === 'suspended' 
          ? 'Your account has been suspended. Please contact support.'
          : userProfile.accountStatus === 'locked'
          ? 'Your account is locked due to security concerns. Please contact support.'
          : 'Your account is pending activation. Please check your email.';
          
        Alert.alert("Account Unavailable", statusMessage);
        throw new Error('ACCOUNT_INACTIVE');
      }

      // 5. Generate new session token
      const sessionToken = generateSessionToken();
      const hashedToken = hashToken(sessionToken);

      // 6. Update security metadata with successful login
      const now = new Date();
      await firestore().collection('users').doc(user.uid).update({
        'security.lastLogin': now,
        'security.failedLoginAttempts': 0,
        'security.lastFailedLogin': null,
        'security.accountLockedUntil': null,
        'security.sessionToken': hashedToken,
        'security.loginHistory': firestore.FieldValue.arrayUnion({
          timestamp: now,
          success: true,
          ipAddress: 'N/A', // TODO: Implement IP detection for React Native
          deviceInfo: 'Mobile App'
        }),
        updatedAt: now
      });

      // 7. Reset rate limit on successful login
      await resetRateLimit(email);

      // 8. Log successful authentication
      await logAuditEvent({
        userId: user.uid,
        userEmail: email,
        userRole: userProfile.role || 'user',
        action: 'login_success',
        category: 'auth',
        severity: 'info',
        details: { 
          loginMethod: 'email_password',
          sessionToken: sessionToken.substring(0, 8) + '...' // Log only prefix for debugging
        },
        success: true
      });

      if (__DEV__) {
        console.log(`[AUTH] Login successful for ${email}`, {
          role: userProfile.role,
          sessionCreated: true
        });
      }
      
      // Success: The onAuthStateChanged listener in AuthProvider will detect this
      // and your root layout will handle navigation based on the updated state.
    } catch (err: any) {
      if (__DEV__) {
        console.error("[AUTH] Login error:", err);
      }

      // Skip error handling for rate limit and account status (already handled)
      if (err.message === 'RATE_LIMIT_EXCEEDED' || err.message === 'ACCOUNT_INACTIVE') {
        throw err;
      }

      // 9. Handle Firebase authentication errors and update failed attempts
      let errorMessage = "An unexpected error occurred during login.";
      let shouldIncrementFailures = true;

      if (err.code === "auth/user-not-found") {
        errorMessage = "User not found. Please check your email or register.";
        shouldIncrementFailures = false; // Don't count as failure if user doesn't exist
      } else if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        errorMessage = "Incorrect password. Please try again.";
        
        // Increment failed login attempts
        try {
          const usersQuery = await firestore()
            .collection('users')
            .where('email', '==', email)
            .limit(1)
            .get();

          if (!usersQuery.empty) {
            const userDoc = usersQuery.docs[0];
            const userData = userDoc.data() as UserProfile;
            const currentFailures = (userData.security?.failedLoginAttempts || 0) + 1;
            const now = new Date();

            // Check if account should be locked
            let accountStatus: AccountStatus = userData.accountStatus || 'active';
            let accountLockedUntil = userData.security?.accountLockedUntil;

            if (shouldLockAccount(currentFailures)) {
              accountStatus = 'locked';
              accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
              
              if (__DEV__) {
                console.warn(`[AUTH] Account locked for ${email} after ${currentFailures} failed attempts`);
              }
            }

            await firestore().collection('users').doc(userDoc.id).update({
              'security.failedLoginAttempts': currentFailures,
              'security.lastFailedLogin': now,
              'security.accountLockedUntil': accountLockedUntil,
              'security.loginHistory': firestore.FieldValue.arrayUnion({
                timestamp: now,
                success: false,
                ipAddress: 'N/A',
                deviceInfo: 'Mobile App'
              }),
              accountStatus: accountStatus,
              updatedAt: now
            });

            // Log failed login attempt
            await logAuditEvent({
              userId: userDoc.id,
              userEmail: email,
              userRole: userData.role || 'user',
              action: 'login_failed',
              category: 'security',
              severity: currentFailures >= 3 ? 'warning' : 'info',
              details: { 
                failedAttempts: currentFailures,
                locked: accountStatus === 'locked',
                reason: 'invalid_credentials'
              },
              success: false,
              errorMessage: 'Invalid credentials'
            });

            if (accountStatus === 'locked') {
              errorMessage = "Account locked due to multiple failed login attempts. Please try again in 30 minutes or contact support.";
            } else if (currentFailures >= 3) {
              errorMessage = `Incorrect password. ${5 - currentFailures} attempt(s) remaining before account lockout.`;
            }
          }
        } catch (updateErr) {
          if (__DEV__) {
            console.error("[AUTH] Failed to update login attempts:", updateErr);
          }
        }
      } else if (err.code === "auth/too-many-requests") {
        errorMessage = "Too many failed attempts. Please try again later.";
      }

      Alert.alert("Login Error", errorMessage);
      throw err; // Re-throw to allow component to handle if needed
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (data: any) => {
    setLoading(true);
    const email = data.email?.toLowerCase().trim();
    
    try {
      // Check if this is the first user (will become super admin)
      const usersSnapshot = await firestore().collection('users').limit(1).get();
      const isFirstUser = usersSnapshot.empty;
      
      const userCredential = await auth().createUserWithEmailAndPassword(email, data.password);
      const user = userCredential.user;

      await user.updateProfile({ displayName: data.name });

      const now = new Date();
      const sessionToken = generateSessionToken();
      const hashedToken = hashToken(sessionToken);

      // Assign role: first user becomes superadmin, rest are users
      const assignedRole = isFirstUser ? 'superadmin' : 'user';
      
      if (__DEV__) {
        console.log(`[AUTH] Registering ${isFirstUser ? 'FIRST USER (Super Admin)' : 'regular user'}:`, email);
      }

      // Create user document with security metadata
      await firestore().collection('users').doc(user.uid).set({
        uid: user.uid,
        email: email,
        displayName: data.name,
        height: parseFloat(data.height),
        weight: parseFloat(data.weight),
        age: parseInt(data.age),
        createdAt: now,
        updatedAt: now,
        
        // Security & RBAC fields
        role: assignedRole,
        accountStatus: 'active',
        permissions: getDefaultPermissions(assignedRole),
        security: {
          lastLogin: now,
          failedLoginAttempts: 0,
          mfaEnabled: false,
          sessionToken: hashedToken,
          loginHistory: [{
            timestamp: now,
            success: true,
            ipAddress: 'N/A',
            deviceInfo: 'Mobile App'
          }]
        }
      });

      // Log successful registration
      await logAuditEvent({
        userId: user.uid,
        userEmail: email,
        userRole: assignedRole,
        action: isFirstUser ? 'superadmin_created' : 'user_registered',
        category: 'auth',
        severity: isFirstUser ? 'warning' : 'info',
        details: { 
          registrationMethod: 'email_password',
          displayName: data.name,
          isFirstUser,
          assignedRole
        },
        success: true
      });

      if (__DEV__) {
        console.log(`[AUTH] Registration successful for ${email}`, {
          uid: user.uid,
          role: assignedRole,
          isFirstUser
        });
      }

      const successMessage = isFirstUser 
        ? "Account created successfully!\n\nYou are the first user and have been granted Super Admin privileges."
        : "Account created successfully!";
      
      Alert.alert("Success", successMessage);
      // Success: The onAuthStateChanged listener in AuthProvider will detect this
      // and your root layout will handle navigation based on the updated state.
    } catch (err: any) {
      if (__DEV__) {
        console.error("[AUTH] Registration error:", err);
      }
      
      let errorMessage = "An unexpected error occurred during registration.";
      
      if (err.code === "auth/email-already-in-use") {
        errorMessage = "This email is already in use. Please try logging in or use a different email.";
      } else if (err.code === "auth/invalid-email") {
        errorMessage = "The email address is not valid.";
      } else if (err.code === "auth/weak-password") {
        errorMessage = "The password is too weak. Please choose a stronger password (at least 6 characters).";
      }
      
      Alert.alert("Registration Error", errorMessage);
      throw err; // Re-throw to allow component to handle if needed
    } finally {
      setLoading(false);
    }
  };

  const reauthenticateAndChangePassword = async (currentPassword: string, newPassword: string) => {
    setLoading(true);
    const user = auth().currentUser;

    if (!user || !user.email) {
      setLoading(false);
      throw new Error("No authenticated user found or user email is missing.");
    }

    try {
      // 1. Re-authenticate the user
      const credential = auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);

      // 2. Update the password
      await user.updatePassword(newPassword);
      
      // 3. Update security metadata
      const now = new Date();
      await firestore().collection('users').doc(user.uid).update({
        'security.lastPasswordChange': now,
        updatedAt: now
      });

      // 4. Log password change
      const userDoc = await firestore().collection('users').doc(user.uid).get();
      const userProfile = userDoc.data() as UserProfile;
      
      await logAuditEvent({
        userId: user.uid,
        userEmail: user.email,
        userRole: userProfile.role || 'user',
        action: 'password_changed',
        category: 'security',
        severity: 'info',
        details: { method: 'user_initiated' },
        success: true
      });

      if (__DEV__) {
        console.log(`[AUTH] Password changed successfully for ${user.email}`);
      }
      
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      if (__DEV__) {
        console.error("[AUTH] Error reauthenticating or changing password:", error);
      }
      
      // Log failed password change attempt
      if (user?.email) {
        try {
          const userDoc = await firestore().collection('users').doc(user.uid).get();
          const userProfile = userDoc.data() as UserProfile;
          
          await logAuditEvent({
            userId: user.uid,
            userEmail: user.email,
            userRole: userProfile.role || 'user',
            action: 'password_change_failed',
            category: 'security',
            severity: 'warning',
            details: { reason: error.code || 'unknown' },
            success: false,
            errorMessage: error.message
          });
        } catch (logErr) {
          if (__DEV__) {
            console.error("[AUTH] Failed to log password change error:", logErr);
          }
        }
      }
      
      if (error.code === "auth/wrong-password") {
        throw new Error("The current password you entered is incorrect.");
      } else if (error.code === "auth/too-many-requests") {
        throw new Error("Too many failed attempts. Please try again later.");
      } else if (error.code === "auth/requires-recent-login") {
        throw new Error("This operation is sensitive and requires recent authentication. Please log in again.");
      } else {
        throw new Error(error.message || "An unexpected error occurred during password change.");
      }
    }
  };

  return {
    register,
    setValue,
    handleSubmit,
    onRegister,
    onLogin,
    loading,
    errors,
    watch,
    trigger,
    reauthenticateAndChangePassword
  };
};

// Default export for easier importing
export default useAuthentication;