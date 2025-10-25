import { MaterialCommunityIcons } from '@expo/vector-icons';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';
import { UserRole } from '../../types/UserProfile';

interface AdminCredentials {
  email: string;
  uid: string;
}

export default function CreateUserScreen() {
  const { userProfile, loading: profileLoading } = useAdminAuth();
  const [loading, setLoading] = useState(false);
  const [adminCredentials, setAdminCredentials] = useState<AdminCredentials | null>(null);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [age, setAge] = useState('');
  const [role, setRole] = useState<UserRole>('user');

  React.useEffect(() => {
    const currentUser = auth().currentUser;
    if (currentUser?.email && currentUser?.uid) {
      setAdminCredentials({
        email: currentUser.email,
        uid: currentUser.uid
      });
    }
  }, []);

  const validateForm = (): boolean => {
    if (!email.trim()) {
      Alert.alert('Validation Error', 'Email is required');
      return false;
    }
    if (!email.includes('@')) {
      Alert.alert('Validation Error', 'Invalid email format');
      return false;
    }
    if (!password || password.length < 6) {
      Alert.alert('Validation Error', 'Password must be at least 6 characters');
      return false;
    }
    if (!displayName.trim()) {
      Alert.alert('Validation Error', 'Display name is required');
      return false;
    }
    if (!height || parseFloat(height) <= 0) {
      Alert.alert('Validation Error', 'Valid height is required');
      return false;
    }
    if (!weight || parseFloat(weight) <= 0) {
      Alert.alert('Validation Error', 'Valid weight is required');
      return false;
    }
    if (!age || parseInt(age) <= 0) {
      Alert.alert('Validation Error', 'Valid age is required');
      return false;
    }
    
    if (role === 'superadmin') {
      Alert.alert('Permission Denied', 'You do not have permission to create Super Admin accounts');
      return false;
    }
    
    return true;
  };

  const handleCreateUser = async () => {
    if (!validateForm()) return;

    setLoading(true);
    const adminUid = adminCredentials?.uid;
    const adminEmail = adminCredentials?.email;
    
    try {
      if (!userProfile) {
        throw new Error('Failed to load user profile');
      }

      if (userProfile.role !== 'admin' && userProfile.role !== 'superadmin') {
        throw new Error('Only admins and super admins can create users');
      }

      if (!userProfile.permissions?.canManageUsers) {
        throw new Error('You do not have permission to create users');
      }

      if (userProfile.accountStatus !== 'active') {
        throw new Error('Your account is not active. Please contact an administrator');
      }

      const currentUser = auth().currentUser;
      if (!currentUser) {
        throw new Error('You must be logged in to create users');
      }

      console.log('[ADMIN] Creating user:', email.toLowerCase());

      const userCredential = await auth().createUserWithEmailAndPassword(
        email.toLowerCase(),
        password
      );

      if (!userCredential.user) {
        throw new Error('Failed to create user account');
      }

      const newUserUid = userCredential.user.uid;
      const now = firestore.Timestamp.now();

      await firestore()
        .collection('users')
        .doc(newUserUid)
        .set({
          uid: newUserUid,
          email: email.toLowerCase(),
          displayName: displayName.trim(),
          height: parseFloat(height),
          weight: parseFloat(weight),
          age: parseInt(age),
          role: role,
          accountStatus: 'active',
          createdBy: adminUid || currentUser.uid,
          createdAt: now,
          updatedAt: now,
          permissions: role === 'admin'
            ? { canManageUsers: true, canManageAdmins: false, canViewAuditLogs: true, canModifySettings: false }
            : { canManageUsers: false, canManageAdmins: false, canViewAuditLogs: false, canModifySettings: false }
        });

      console.log('[ADMIN] Created new user:', newUserUid);

      if (adminUid && adminEmail) {
        const currentSessionUid = auth().currentUser?.uid;
        if (currentSessionUid !== adminUid) {
          await auth().signOut();
          console.log('[ADMIN] Switched auth back to admin');
        }
      }

      setEmail('');
      setPassword('');
      setDisplayName('');
      setHeight('');
      setWeight('');
      setAge('');
      setRole('user');

      Alert.alert(
        'Success',
        `User "${displayName}" created successfully`,
        [
          {
            text: 'OK',
            onPress: () => router.back()
          }
        ]
      );
      
    } catch (error: any) {
      console.error('[ADMIN] Error:', error);

      let errorMessage = 'Failed to create user';

      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Email is already in use';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email format';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak';
      } else if (error.message) {
        errorMessage = error.message;
      }

      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <View className="flex-1 bg-neutral-900 justify-center items-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <AppText className="color-white mt-4">Loading...</AppText>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <View className="p-6">
        {/* Header */}
        <View className="mb-8">
          <AppText className="text-3xl font-bold color-white mb-2">Create New User</AppText>
          <AppText className="text-base color-neutral-400">
            Add a new user to the system with specified role and permissions
          </AppText>
        </View>

        {/* Form */}
        <View className="space-y-6">
          {/* Email */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Email *</AppText>
            <TextInput
              className="bg-neutral-800 color-white text-base px-4 py-3 rounded-lg border border-neutral-700"
              placeholder="user@example.com"
              placeholderTextColor="#666"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!loading}
            />
          </View>

          {/* Password */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Password *</AppText>
            <TextInput
              className="bg-neutral-800 color-white text-base px-4 py-3 rounded-lg border border-neutral-700"
              placeholder="Minimum 6 characters"
              placeholderTextColor="#666"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
            />
          </View>

          {/* Display Name */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Display Name *</AppText>
            <TextInput
              className="bg-neutral-800 color-white text-base px-4 py-3 rounded-lg border border-neutral-700"
              placeholder="John Doe"
              placeholderTextColor="#666"
              value={displayName}
              onChangeText={setDisplayName}
              editable={!loading}
            />
          </View>

          {/* Height */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Height (cm) *</AppText>
            <TextInput
              className="bg-neutral-800 color-white text-base px-4 py-3 rounded-lg border border-neutral-700"
              placeholder="170"
              placeholderTextColor="#666"
              value={height}
              onChangeText={setHeight}
              keyboardType="decimal-pad"
              editable={!loading}
            />
          </View>

          {/* Weight */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Weight (kg) *</AppText>
            <TextInput
              className="bg-neutral-800 color-white text-base px-4 py-3 rounded-lg border border-neutral-700"
              placeholder="70"
              placeholderTextColor="#666"
              value={weight}
              onChangeText={setWeight}
              keyboardType="decimal-pad"
              editable={!loading}
            />
          </View>

          {/* Age */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Age *</AppText>
            <TextInput
              className="bg-neutral-800 color-white text-base px-4 py-3 rounded-lg border border-neutral-700"
              placeholder="25"
              placeholderTextColor="#666"
              value={age}
              onChangeText={setAge}
              keyboardType="number-pad"
              editable={!loading}
            />
          </View>

          {/* Role - Admins can only create users and admins */}
          <View>
            <AppText className="text-base color-white mb-2 font-semibold">Role *</AppText>
            <View className="space-y-2">
              {/* User Role */}
              <TouchableOpacity
                className={`flex-row items-center p-4 rounded-lg border ${
                  role === 'user' 
                    ? 'bg-blue-900 border-blue-500' 
                    : 'bg-neutral-800 border-neutral-700'
                }`}
                onPress={() => setRole('user')}
                disabled={loading}
              >
                <MaterialCommunityIcons 
                  name={role === 'user' ? 'radiobox-marked' : 'radiobox-blank'} 
                  size={24} 
                  color={role === 'user' ? '#3b82f6' : '#9ca3af'} 
                />
                <View className="ml-3 flex-1">
                  <AppText className="text-base color-white font-semibold">User</AppText>
                  <AppText className="text-sm color-neutral-400">Regular user - can use app and track workouts</AppText>
                </View>
              </TouchableOpacity>

              {/* Admin Role */}
              <TouchableOpacity
                className={`flex-row items-center p-4 rounded-lg border ${
                  role === 'admin' 
                    ? 'bg-purple-900 border-purple-500' 
                    : 'bg-neutral-800 border-neutral-700'
                }`}
                onPress={() => setRole('admin')}
                disabled={loading}
              >
                <MaterialCommunityIcons 
                  name={role === 'admin' ? 'radiobox-marked' : 'radiobox-blank'} 
                  size={24} 
                  color={role === 'admin' ? '#8b5cf6' : '#9ca3af'} 
                />
                <View className="ml-3 flex-1">
                  <AppText className="text-base color-white font-semibold">Administrator</AppText>
                  <AppText className="text-sm color-neutral-400">Admin - can manage users and view analytics</AppText>
                </View>
              </TouchableOpacity>

              {/* Super Admin Role - Disabled for regular admins */}
              <View
                className="flex-row items-center p-4 rounded-lg border border-neutral-700 opacity-50"
              >
                <MaterialCommunityIcons 
                  name="radiobox-blank" 
                  size={24} 
                  color="#9ca3af" 
                />
                <View className="ml-3 flex-1">
                  <AppText className="text-base color-neutral-600 font-semibold">Super Administrator</AppText>
                  <AppText className="text-sm color-neutral-500">Only Super Admins can create Super Admin accounts</AppText>
                </View>
              </View>
            </View>
          </View>

          {/* Warning */}
          <View className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
            <AppText className="text-sm color-yellow-500 font-semibold mb-1">ℹ️ Note</AppText>
            <AppText className="text-sm color-yellow-300">
              User creation is processed securely by our backend. You will remain logged in and can continue managing users without interruption.
            </AppText>
          </View>

          {/* Buttons */}
          <View className="flex-row gap-3 mt-4">
            <View className="flex-1">
              <Button
                title="Cancel"
                onPress={() => router.back()}
                className="bg-neutral-700"
                disabled={loading}
              />
            </View>
            <View className="flex-1">
              <Button
                title={loading ? 'Creating...' : 'Create User'}
                onPress={handleCreateUser}
                className="bg-blue-600"
                disabled={loading}
              />
            </View>
          </View>

          {loading && (
            <View className="items-center mt-4">
              <ActivityIndicator size="large" color="#3b82f6" />
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
