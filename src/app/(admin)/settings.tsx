import { MaterialCommunityIcons } from '@expo/vector-icons';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StatusBar, Switch, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';

interface AdminSettings {
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  darkMode: boolean;
  twoFactorAuth: boolean;
}

export default function AdminSettings() {
  const router = useRouter();
  const { userProfile, loading: profileLoading } = useAdminAuth();
  const [settings, setSettings] = useState<AdminSettings>({
    notificationsEnabled: true,
    emailNotifications: true,
    darkMode: true,
    twoFactorAuth: false,
  });
  const [settingsLoading, setSettingsLoading] = useState(true);

  const loadSettings = async () => {
    try {
      if (__DEV__) {
        console.log('[ADMIN SETTINGS] Loading settings');
      }
      
      if (userProfile?.uid) {
        const userDoc = await firestore()
          .collection('users')
          .doc(userProfile.uid)
          .get();
        
        if (userDoc.exists) {
          const data = userDoc.data();
          const adminSettings = data?.adminSettings || {
            notificationsEnabled: true,
            emailNotifications: true,
            darkMode: true,
            twoFactorAuth: false,
          };
          setSettings(adminSettings);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[ADMIN SETTINGS] Error loading settings:', error);
      }
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    if (!profileLoading && userProfile) {
      loadSettings();
    }
  }, [profileLoading, userProfile]);

  const handleToggleSetting = async (setting: keyof AdminSettings) => {
    const newValue = !settings[setting];
    setSettings(prev => ({ ...prev, [setting]: newValue }));

    try {
      // Save to Firestore
      await firestore()
        .collection('users')
        .doc(userProfile?.uid || '')
        .update({
          [`adminSettings.${setting}`]: newValue,
        });

      if (__DEV__) {
        console.log(`[ADMIN SETTINGS] Updated ${setting} to ${newValue}`);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[ADMIN SETTINGS] Error saving setting:', error);
      }
      Alert.alert('Error', 'Failed to save settings');
      // Revert on error
      setSettings(prev => ({ ...prev, [setting]: !newValue }));
    }
  };

  const handleChangePassword = () => {
    Alert.prompt(
      'Change Password',
      'Enter your new password',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change',
          onPress: async (password) => {
            if (!password || password.length < 6) {
              Alert.alert('Error', 'Password must be at least 6 characters');
              return;
            }
            try {
              await auth().currentUser?.updatePassword(password);
              Alert.alert('Success', 'Password changed successfully');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to change password');
            }
          },
        },
      ],
      'secure-text'
    );
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await auth().signOut();
            router.replace('/(auth)/login');
          } catch (error) {
            Alert.alert('Error', 'Failed to logout');
          }
        },
      },
    ]);
  };

  const SettingRow = ({
    title,
    description,
    value,
    onToggle,
    icon,
  }: {
    title: string;
    description: string;
    value: boolean;
    onToggle: () => void;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
  }) => (
    <View className="bg-neutral-800 rounded-xl p-4 mb-3 flex-row items-center justify-between">
      <View className="flex-row items-center flex-1">
        <View className="w-10 h-10 rounded-lg bg-blue-500 bg-opacity-20 items-center justify-center mr-3">
          <MaterialCommunityIcons name={icon} size={20} color="#3b82f6" />
        </View>
        <View className="flex-1">
          <AppText className="text-base font-bold color-white">{title}</AppText>
          <AppText className="text-sm color-neutral-400 mt-1">{description}</AppText>
        </View>
      </View>
      <Switch value={value} onValueChange={onToggle} />
    </View>
  );

  const ActionButton = ({
    title,
    icon,
    color,
    onPress,
  }: {
    title: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    color: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      className="bg-neutral-800 rounded-xl p-4 mb-3 flex-row items-center"
      onPress={onPress}
    >
      <View className="w-10 h-10 rounded-lg items-center justify-center mr-3" style={{ backgroundColor: color + '20' }}>
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      </View>
      <AppText className="text-base font-bold color-white flex-1">{title}</AppText>
      <MaterialCommunityIcons name="chevron-right" size={20} color="#6b7280" />
    </TouchableOpacity>
  );

  if (profileLoading || settingsLoading) {
    return (
      <View className="flex-1 bg-neutral-900 justify-center items-center">
        <AppText className="color-white">Loading...</AppText>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <View className="mb-6">
          <AppText className="text-3xl font-bold color-white mb-2">Settings</AppText>
          <AppText className="text-base color-neutral-400">Manage your admin preferences</AppText>
        </View>

        {/* Account Section */}
        <AppText className="text-lg font-bold color-white mb-4 mt-6">Account</AppText>

        <View className="bg-neutral-800 rounded-xl p-4 mb-4">
          <AppText className="text-sm color-neutral-400 mb-2">Email</AppText>
          <AppText className="text-base color-white font-bold">{userProfile?.email}</AppText>
        </View>

        <View className="bg-neutral-800 rounded-xl p-4 mb-4">
          <AppText className="text-sm color-neutral-400 mb-2">Role</AppText>
          <AppText className="text-base color-white font-bold capitalize">{userProfile?.role}</AppText>
        </View>

        {/* <ActionButton
          title="Change Password"
          icon="lock"
          color="#f59e0b"
          onPress={handleChangePassword}
        /> */}

        {/* Preferences Section */}
        <AppText className="text-lg font-bold color-white mb-4 mt-6">Preferences</AppText>

        <SettingRow
          title="Notifications"
          description="Receive app notifications"
          value={settings.notificationsEnabled}
          onToggle={() => handleToggleSetting('notificationsEnabled')}
          icon="bell"
        />

        <SettingRow
          title="Email Notifications"
          description="Receive email alerts"
          value={settings.emailNotifications}
          onToggle={() => handleToggleSetting('emailNotifications')}
          icon="email"
        />

        {/*
          <SettingRow
          title="Dark Mode"
          description="Use dark theme (default)"
          value={settings.darkMode}
          onToggle={() => handleToggleSetting('darkMode')}
          icon="moon-waning-crescent"
        />

        <SettingRow
          title="Two-Factor Authentication"
          description="Add extra security to your account"
          value={settings.twoFactorAuth}
          onToggle={() => handleToggleSetting('twoFactorAuth')}
          icon="shield-check"
        />*/}

        {/* Security Section */}
        {/* <AppText className="text-lg font-bold color-white mb-4 mt-6">Security</AppText>

        <ActionButton
          title="Logout"
          icon="logout"
          color="#ef4444"
          onPress={handleLogout}
        /> */}

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
