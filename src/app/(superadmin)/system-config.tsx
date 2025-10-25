import { MaterialCommunityIcons } from '@expo/vector-icons';
import firestore from '@react-native-firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StatusBar, Switch, TextInput, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';
import { logAuditEvent } from '../../utils/security';

interface SystemConfig {
  maintenanceMode: boolean;
  maxLoginAttempts: number;
  sessionTimeoutMinutes: number;
  requireMFAForAdmins: boolean;
  allowUserRegistration: boolean;
  minPasswordLength: number;
  maxFileUploadMB: number;
}

export default function SystemConfig() {
  const { userProfile, loading: profileLoading } = useAdminAuth();
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Only load config once profile is loaded
    if (!profileLoading && userProfile) {
      loadConfig();
    }
  }, [profileLoading, userProfile]);

  const loadConfig = async () => {
    try {
      if (__DEV__) {
        console.log('[SYSTEM CONFIG] Loading configuration');
      }
      
      // Wait for profile to load
      if (!userProfile) {
        if (__DEV__) {
          console.log('[SYSTEM CONFIG] Waiting for user profile to load...');
        }
        return;
      }
      
      const configDoc = await firestore().collection('system_config').doc('global').get();
      if (configDoc.exists) {
        setConfig(configDoc.data() as SystemConfig);
      } else {
        // Create default config
        const defaultConfig: SystemConfig = {
          maintenanceMode: false,
          maxLoginAttempts: 5,
          sessionTimeoutMinutes: 30,
          requireMFAForAdmins: false,
          allowUserRegistration: true,
          minPasswordLength: 8,
          maxFileUploadMB: 10,
        };
        await firestore().collection('system_config').doc('global').set(defaultConfig);
        setConfig(defaultConfig);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[SYSTEM CONFIG] Error loading config:', error);
      }
      Alert.alert('Error', 'Failed to load system configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async (newConfig: SystemConfig, changedField: string) => {
    setSaving(true);
    try {
      await firestore().collection('system_config').doc('global').set(newConfig);
      
      await logAuditEvent({
        userId: userProfile?.uid || 'unknown',
        userEmail: userProfile?.email || 'unknown',
        userRole: userProfile?.role || 'superadmin',
        action: 'system_config_updated',
        category: 'system',
        severity: 'warning',
        details: { 
          changedField,
          oldValue: config[changedField as keyof SystemConfig],
          newValue: newConfig[changedField as keyof SystemConfig]
        },
        success: true
      });

      if (__DEV__) {
        console.log('[SYSTEM CONFIG] Configuration updated:', changedField);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[SYSTEM CONFIG] Error saving config:', error);
      }
      Alert.alert('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (field: keyof SystemConfig) => {
    if (!config) return;
    const newConfig = { ...config, [field]: !config[field] };
    setConfig(newConfig);
    saveConfig(newConfig, field as string);
  };

  const handleNumberChange = (field: keyof SystemConfig, value: string) => {
    if (!config) return;
    const numValue = parseInt(value) || 0;
    if (numValue < 0) return;
    
    const newConfig = { ...config, [field]: numValue };
    setConfig(newConfig);
  };

  const handleSaveNumber = (field: keyof SystemConfig) => {
    if (!config) return;
    saveConfig(config, field as string);
  };

  if (loading || !config) {
    return (
      <View className="flex-1 bg-neutral-900 justify-center items-center">
        <AppText className="color-white">Loading configuration...</AppText>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Warning Banner */}
        <View className="bg-red-500 bg-opacity-10 border border-red-500 rounded-xl p-4 mb-6">
          <View className="flex-row items-center mb-2">
            <MaterialCommunityIcons name="alert-circle" size={24} color="#ef4444" />
            <AppText className="color-red-500 font-bold ml-2">Critical Settings</AppText>
          </View>
          <AppText className="color-red-200 text-xs">
            Changes to these settings affect all users. Exercise extreme caution.
          </AppText>
        </View>

        {/* System Status */}
        <AppText className="color-white text-lg font-bold mb-4">System Status</AppText>
        <View className="bg-neutral-800 rounded-xl p-4 mb-6">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-1">
              <AppText className="color-white font-bold">Maintenance Mode</AppText>
              <AppText className="color-gray-400 text-xs mt-1">
                {config.maintenanceMode ? 'App is in maintenance mode' : 'App is operational'}
              </AppText>
            </View>
            <Switch
              value={config.maintenanceMode}
              onValueChange={() => handleToggle('maintenanceMode')}
              trackColor={{ false: '#4b5563', true: '#ef4444' }}
              thumbColor={config.maintenanceMode ? '#fff' : '#9ca3af'}
            />
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <AppText className="color-white font-bold">User Registration</AppText>
              <AppText className="color-gray-400 text-xs mt-1">
                {config.allowUserRegistration ? 'New users can register' : 'Registration disabled'}
              </AppText>
            </View>
            <Switch
              value={config.allowUserRegistration}
              onValueChange={() => handleToggle('allowUserRegistration')}
              trackColor={{ false: '#4b5563', true: '#10b981' }}
              thumbColor={config.allowUserRegistration ? '#fff' : '#9ca3af'}
            />
          </View>
        </View>

        {/* Security Settings */}
        <AppText className="color-white text-lg font-bold mb-4">Security Settings</AppText>
        <View className="bg-neutral-800 rounded-xl p-4 mb-6">
          <View className="mb-4">
            <AppText className="color-white font-bold mb-2">Max Login Attempts</AppText>
            <AppText className="color-gray-400 text-xs mb-2">
              Number of failed attempts before account lockout
            </AppText>
            <TextInput
              className="bg-neutral-700 color-white p-3 rounded-lg"
              value={config.maxLoginAttempts.toString()}
              onChangeText={(value) => handleNumberChange('maxLoginAttempts', value)}
              onBlur={() => handleSaveNumber('maxLoginAttempts')}
              keyboardType="numeric"
              maxLength={2}
            />
          </View>

          <View className="mb-4">
            <AppText className="color-white font-bold mb-2">Session Timeout (minutes)</AppText>
            <AppText className="color-gray-400 text-xs mb-2">
              Auto-logout after inactivity
            </AppText>
            <TextInput
              className="bg-neutral-700 color-white p-3 rounded-lg"
              value={config.sessionTimeoutMinutes.toString()}
              onChangeText={(value) => handleNumberChange('sessionTimeoutMinutes', value)}
              onBlur={() => handleSaveNumber('sessionTimeoutMinutes')}
              keyboardType="numeric"
              maxLength={3}
            />
          </View>

          <View className="mb-4">
            <AppText className="color-white font-bold mb-2">Min Password Length</AppText>
            <AppText className="color-gray-400 text-xs mb-2">
              Minimum characters required for passwords
            </AppText>
            <TextInput
              className="bg-neutral-700 color-white p-3 rounded-lg"
              value={config.minPasswordLength.toString()}
              onChangeText={(value) => handleNumberChange('minPasswordLength', value)}
              onBlur={() => handleSaveNumber('minPasswordLength')}
              keyboardType="numeric"
              maxLength={2}
            />
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <AppText className="color-white font-bold">Require MFA for Admins</AppText>
              <AppText className="color-gray-400 text-xs mt-1">
                Force 2FA for all administrators
              </AppText>
            </View>
            <Switch
              value={config.requireMFAForAdmins}
              onValueChange={() => handleToggle('requireMFAForAdmins')}
              trackColor={{ false: '#4b5563', true: '#8b5cf6' }}
              thumbColor={config.requireMFAForAdmins ? '#fff' : '#9ca3af'}
            />
          </View>
        </View>

        {/* File Upload Settings */}
        <AppText className="color-white text-lg font-bold mb-4">File Upload</AppText>
        <View className="bg-neutral-800 rounded-xl p-4 mb-6">
          <AppText className="color-white font-bold mb-2">Max Upload Size (MB)</AppText>
          <AppText className="color-gray-400 text-xs mb-2">
            Maximum file size for uploads
          </AppText>
          <TextInput
            className="bg-neutral-700 color-white p-3 rounded-lg"
            value={config.maxFileUploadMB.toString()}
            onChangeText={(value) => handleNumberChange('maxFileUploadMB', value)}
            onBlur={() => handleSaveNumber('maxFileUploadMB')}
            keyboardType="numeric"
            maxLength={3}
          />
        </View>

        {saving && (
          <View className="bg-green-500 bg-opacity-10 border border-green-500 rounded-xl p-3 mb-4">
            <AppText className="color-green-500 text-center">✓ Configuration saved</AppText>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
