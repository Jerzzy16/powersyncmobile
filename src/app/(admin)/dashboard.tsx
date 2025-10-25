import { MaterialCommunityIcons } from '@expo/vector-icons';
import firestore from '@react-native-firebase/firestore';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  admins: number;
  todayLogins: number;
  securityAlerts: number;
}

export default function AdminDashboard() {
  const { userProfile, hasAdminAccess, hasSuperAdminAccess, loading: profileLoading } = useAdminAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    activeUsers: 0,
    suspendedUsers: 0,
    admins: 0,
    todayLogins: 0,
    securityAlerts: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboardStats = async () => {
    try {
      if (__DEV__) {
        console.log('[ADMIN DASHBOARD] Loading stats');
      }

      // Get all users
      const usersSnapshot = await firestore().collection('users').get();
      const users = usersSnapshot.docs.map(doc => doc.data());

      // Calculate stats
      const totalUsers = users.length;
      const activeUsers = users.filter(u => u.accountStatus === 'active').length;
      const suspendedUsers = users.filter(u => u.accountStatus === 'suspended').length;
      const admins = users.filter(u => u.role === 'admin' || u.role === 'superadmin').length;

      // Get today's logins (from audit logs)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayFirestoreTime = firestore.Timestamp.fromDate(today);

      // Fetch login logs - no ordering needed, just filter by action
      // We'll filter by timestamp in code to avoid needing a composite index
      const loginLogsSnapshot = await firestore()
        .collection('audit_logs')
        .where('action', '==', 'LOGIN_SUCCESS')
        .get();

      // Filter for today's logins in code
      const todayLogins = loginLogsSnapshot.docs.filter(doc => {
        const timestamp = doc.data().timestamp;
        return timestamp && timestamp.toDate && timestamp.toDate() >= today;
      }).length;

      // Get security alerts (failed logins, unauthorized access)
      // Fetch without ordering constraint to avoid needing composite indexes
      const warningLogsSnapshot = await firestore()
        .collection('audit_logs')
        .where('category', '==', 'security')
        .where('severity', '==', 'warning')
        .get();

      const criticalLogsSnapshot = await firestore()
        .collection('audit_logs')
        .where('category', '==', 'security')
        .where('severity', '==', 'critical')
        .get();

      // Filter for today's security alerts in code
      const todayWarnings = warningLogsSnapshot.docs.filter(doc => {
        const timestamp = doc.data().timestamp;
        return timestamp && timestamp.toDate && timestamp.toDate() >= today;
      }).length;

      const todayCriticals = criticalLogsSnapshot.docs.filter(doc => {
        const timestamp = doc.data().timestamp;
        return timestamp && timestamp.toDate && timestamp.toDate() >= today;
      }).length;

      const securityAlerts = todayWarnings + todayCriticals;

      setStats({
        totalUsers,
        activeUsers,
        suspendedUsers,
        admins,
        todayLogins,
        securityAlerts,
      });
    } catch (error) {
      if (__DEV__) {
        console.error('[ADMIN DASHBOARD] Error loading stats:', error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Only load stats once profile is loaded
  useEffect(() => {
    if (!profileLoading && userProfile) {
      loadDashboardStats();
    }
  }, [profileLoading, userProfile]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardStats();
  };

  const StatCard = ({
    icon,
    title,
    value,
    color,
    onPress,
  }: {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    title: string;
    value: number;
    color: string;
    onPress?: () => void;
  }) => (
    <TouchableOpacity
      className={`bg-neutral-800 rounded-xl p-4 mb-4 ${onPress ? '' : 'opacity-100'}`}
      onPress={onPress}
      disabled={!onPress}
    >
      <View className="flex-row items-center justify-between">
        <View>
          <AppText className="color-gray-400 text-sm">{title}</AppText>
          <AppText className={`${color} text-3xl font-bold mt-2`}>{value}</AppText>
        </View>
        <View className={`w-14 h-14 rounded-full items-center justify-center`} style={{ backgroundColor: color + '20' }}>
          <MaterialCommunityIcons name={icon} size={28} color={color} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const QuickActionButton = ({
    icon,
    title,
    description,
    onPress,
    color = '#3b82f6',
  }: {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    title: string;
    description: string;
    onPress: () => void;
    color?: string;
  }) => (
    <TouchableOpacity className="bg-neutral-800 rounded-xl p-4 mb-3" onPress={onPress}>
      <View className="flex-row items-center">
        <View className="w-12 h-12 rounded-full items-center justify-center mr-4" style={{ backgroundColor: color + '20' }}>
          <MaterialCommunityIcons name={icon} size={24} color={color} />
        </View>
        <View className="flex-1">
          <AppText className="color-white font-bold text-base">{title}</AppText>
          <AppText className="color-gray-400 text-sm mt-1">{description}</AppText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color="#6b7280" />
      </View>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
      >
        {/* Welcome Section */}
        <View className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl p-6 mb-6">
          <AppText className="color-white text-xl font-bold">Welcome, {userProfile?.displayName}</AppText>
          <AppText className="color-blue-200 text-sm mt-2">
            {hasSuperAdminAccess ? 'Super Administrator' : 'Administrator'}
          </AppText>
        </View>

        {/* Statistics */}
        <AppText className="color-white text-lg font-bold mb-4">System Overview</AppText>

        <View className="flex-row mb-4">
          <View className="flex-1 mr-2">
            <StatCard
              icon="account-group"
              title="Total Users"
              value={stats.totalUsers}
              color="#3b82f6"
              onPress={() => router.push('/(admin)/user-management')}
            />
          </View>
          <View className="flex-1 ml-2">
            <StatCard
              icon="account-check"
              title="Active Users"
              value={stats.activeUsers}
              color="#10b981"
            />
          </View>
        </View>

        <View className="flex-row mb-4">
          <View className="flex-1 mr-2">
            <StatCard
              icon="shield-account"
              title="Administrators"
              value={stats.admins}
              color="#8b5cf6"
              onPress={hasSuperAdminAccess ? () => router.push('/(superadmin)/admin-management') : undefined}
            />
          </View>
          <View className="flex-1 ml-2">
            <StatCard
              icon="account-off"
              title="Suspended"
              value={stats.suspendedUsers}
              color="#ef4444"
            />
          </View>
        </View>

        <View className="flex-row mb-6">
          <View className="flex-1 mr-2">
            <StatCard
              icon="login"
              title="Today's Logins"
              value={stats.todayLogins}
              color="#06b6d4"
            />
          </View>
          <View className="flex-1 ml-2">
            <StatCard
              icon="alert"
              title="Security Alerts"
              value={stats.securityAlerts}
              color="#f59e0b"
              onPress={() => router.push('/(admin)/security-logs')}
            />
          </View>
        </View>

        {/* Quick Actions */}
        <AppText className="color-white text-lg font-bold mb-4">Quick Actions</AppText>

        <QuickActionButton
          icon="account-plus"
          title="Create New User"
          description="Add a new user to the system"
          onPress={() => router.push('/(admin)/create-user')}
          color="#10b981"
        />

        <QuickActionButton
          icon="account-multiple"
          title="Manage Users"
          description="View, edit, and manage user accounts"
          onPress={() => router.push('/(admin)/user-management')}
          color="#3b82f6"
        />

        <QuickActionButton
          icon="chart-line"
          title="View Analytics"
          description="Access detailed system analytics"
          onPress={() => router.push('/(admin)/analytics')}
          color="#10b981"
        />

        <QuickActionButton
          icon="shield-lock"
          title="Security Logs"
          description="Review security events and audit trails"
          onPress={() => router.push('/(admin)/security-logs')}
          color="#ef4444"
        />

        {hasSuperAdminAccess && (
          <>
            <QuickActionButton
              icon="shield-crown"
              title="Super Admin Panel"
              description="Access advanced system controls"
              onPress={() => router.push('/(superadmin)/dashboard')}
              color="#8b5cf6"
            />
          </>
        )}

        <QuickActionButton
          icon="cog"
          title="Settings"
          description="Configure admin panel settings"
          onPress={() => router.push('/(admin)/settings')}
          color="#6b7280"
        />

        {/* Security Recommendations */}
        {stats.securityAlerts > 0 && (
          <View className="bg-orange-500 bg-opacity-20 border border-orange-500 rounded-xl p-4 mt-4">
            <View className="flex-row items-center mb-2">
              <MaterialCommunityIcons name="alert-circle" size={24} color="#f59e0b" />
              <AppText className="color-orange-500 font-bold text-base ml-2">Security Alert</AppText>
            </View>
            <AppText className="color-orange-200 text-sm">
              {stats.securityAlerts} security event{stats.securityAlerts > 1 ? 's' : ''} detected today. Review security logs immediately.
            </AppText>
            <TouchableOpacity
              className="bg-orange-500 rounded-lg p-3 mt-3"
              onPress={() => router.push('/(admin)/security-logs')}
            >
              <AppText className="color-white font-bold text-center">View Security Logs</AppText>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
