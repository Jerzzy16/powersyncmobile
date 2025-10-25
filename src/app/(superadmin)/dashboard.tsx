import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StatusBar, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';

export default function SuperAdminDashboard() {
  const { userProfile } = useAdminAuth();
  const router = useRouter();

  const ActionCard = ({
    icon,
    title,
    description,
    onPress,
    color = '#8b5cf6',
    danger = false,
  }: {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    title: string;
    description: string;
    onPress: () => void;
    color?: string;
    danger?: boolean;
  }) => (
    <TouchableOpacity
      className={`rounded-xl p-5 mb-4 ${danger ? 'bg-red-900 border border-red-500' : 'bg-neutral-800'}`}
      onPress={onPress}
    >
      <View className="flex-row items-center mb-3">
        <View
          className="w-14 h-14 rounded-full items-center justify-center mr-4"
          style={{ backgroundColor: color + '30' }}
        >
          <MaterialCommunityIcons name={icon} size={28} color={color} />
        </View>
        <View className="flex-1">
          <AppText className={`font-bold text-lg ${danger ? 'color-red-400' : 'color-white'}`}>{title}</AppText>
          <AppText className={danger ? 'color-red-200 text-sm mt-1' : 'color-gray-400 text-sm mt-1'}>
            {description}
          </AppText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={danger ? '#ef4444' : '#6b7280'} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <View className="bg-gradient-to-r from-purple-600 to-purple-900 rounded-xl p-6 mb-6">
          <View className="flex-row items-center mb-2">
            <MaterialCommunityIcons name="shield-crown" size={32} color="#fff" />
            <View className="ml-3 flex-1">
              <AppText className="color-white text-2xl font-bold">Super Admin</AppText>
              <AppText className="color-purple-200 text-sm mt-1">{userProfile?.displayName}</AppText>
            </View>
          </View>
          <View className="bg-purple-800 bg-opacity-50 rounded-lg p-3 mt-3">
            <AppText className="color-purple-100 text-xs">
              ⚠️ You have elevated privileges. All actions are audited and logged.
            </AppText>
          </View>
        </View>

        {/* Critical Actions Warning */}
        <View className="bg-red-500 bg-opacity-10 border border-red-500 rounded-xl p-4 mb-6">
          <View className="flex-row items-center mb-2">
            <MaterialCommunityIcons name="alert-octagon" size={24} color="#ef4444" />
            <AppText className="color-red-500 font-bold ml-2">High-Security Zone</AppText>
          </View>
          <AppText className="color-red-200 text-xs">
            This panel provides access to critical system functions. Exercise caution and verify all actions before execution.
          </AppText>
        </View>

        {/* Super Admin Actions */}
        <AppText className="color-white text-lg font-bold mb-4">System Administration</AppText>

        <ActionCard
          icon="account-plus"
          title="Create New User"
          description="Add a new user to the system with specified role"
          onPress={() => router.push('/(superadmin)/create-user')}
          color="#10b981"
        />

        <ActionCard
          icon="shield-account"
          title="Admin Management"
          description="Manage administrator accounts and permissions"
          onPress={() => router.push('/(superadmin)/admin-management')}
          color="#8b5cf6"
        />

        {/* <ActionCard
          icon="cog-outline"
          title="System Configuration"
          description="Configure global system settings and parameters"
          onPress={() => router.push('/(superadmin)/system-config')}
          color="#3b82f6"
        /> */}

        <ActionCard
          icon="clipboard-text-clock"
          title="Complete Audit Trails"
          description="Access comprehensive audit logs and system history"
          onPress={() => router.push('/(superadmin)/audit-trails')}
          color="#10b981"
        />
{/* 
        <ActionCard
          icon="database"
          title="Database Management"
          description="Manage Firestore collections and data integrity"
          onPress={() => {}}
          color="#f59e0b"
        /> */}

        {/* <AppText className="color-white text-lg font-bold mb-4 mt-4">Danger Zone</AppText>

        <ActionCard
          icon="delete-forever"
          title="System Cleanup"
          description="Remove old logs, orphaned data, and temporary files"
          onPress={() => {}}
          color="#ef4444"
          danger
        />

        <ActionCard
          icon="backup-restore"
          title="System Backup & Restore"
          description="Create system backups or restore from previous state"
          onPress={() => {}}
          color="#f97316"
          danger
        /> */}

        {/* Back to Admin Panel */}
        <TouchableOpacity
          className="bg-neutral-800 rounded-xl p-4 mt-6 border border-neutral-700"
          onPress={() => router.push('/(admin)/dashboard')}
        >
          <View className="flex-row items-center justify-center">
            <MaterialCommunityIcons name="arrow-left" size={20} color="#3b82f6" />
            <AppText className="color-blue-500 font-bold ml-2">Back to Admin Panel</AppText>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
