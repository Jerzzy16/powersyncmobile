import { MaterialCommunityIcons } from '@expo/vector-icons';
import firestore from '@react-native-firebase/firestore';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';

interface AnalyticsData {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  adminCount: number;
  userCount: number;
  workoutsCompleted: number;
  videosUploaded: number;
  averageSessionDuration: number;
  peakActivityHour: number;
}

export default function AdminAnalytics() {
  const { userProfile, loading: profileLoading } = useAdminAuth();
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalUsers: 0,
    activeUsers: 0,
    suspendedUsers: 0,
    adminCount: 0,
    userCount: 0,
    workoutsCompleted: 0,
    videosUploaded: 0,
    averageSessionDuration: 0,
    peakActivityHour: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAnalytics = async () => {
    try {
      if (__DEV__) {
        console.log('[ANALYTICS] Loading analytics');
      }

      // Get user statistics
      const usersSnapshot = await firestore().collection('users').get();
      const users = usersSnapshot.docs.map(doc => doc.data());

      const totalUsers = users.length;
      const activeUsers = users.filter(u => u.accountStatus === 'active').length;
      const suspendedUsers = users.filter(u => u.accountStatus === 'suspended').length;
      const adminCount = users.filter(u => u.role === 'admin' || u.role === 'superadmin').length;
      const userCount = users.filter(u => u.role === 'user').length;

      // Get workout sessions (if available)
      const workoutSessionsSnapshot = await firestore()
        .collection('workout_sessions')
        .get()
        .catch(() => ({ docs: [] }));

      const workoutsCompleted = workoutSessionsSnapshot.docs.length;

      // Get video uploads
      const videosSnapshot = await firestore()
        .collection('videos')
        .get()
        .catch(() => ({ docs: [] }));

      const videosUploaded = videosSnapshot.docs.length;

      // Calculate average session duration (simplified)
      let averageSessionDuration = 0;
      if (workoutSessionsSnapshot.docs.length > 0) {
        let totalDuration = 0;
        workoutSessionsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          totalDuration += data.duration || 0;
        });
        averageSessionDuration = Math.round(totalDuration / workoutSessionsSnapshot.docs.length);
      }

      // Get peak activity hour (from audit logs)
      const logsSnapshot = await firestore()
        .collection('audit_logs')
        .where('category', '==', 'auth')
        .get()
        .catch(() => ({ docs: [] }));

      let peakActivityHour = 0;
      const hourCounts = new Array(24).fill(0);
      logsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.timestamp) {
          const hour = new Date(data.timestamp.toDate?.() || data.timestamp).getHours();
          hourCounts[hour]++;
        }
      });
      peakActivityHour = hourCounts.indexOf(Math.max(...hourCounts));

      setAnalytics({
        totalUsers,
        activeUsers,
        suspendedUsers,
        adminCount,
        userCount,
        workoutsCompleted,
        videosUploaded,
        averageSessionDuration,
        peakActivityHour: peakActivityHour || 12,
      });
    } catch (error) {
      if (__DEV__) {
        console.error('[ANALYTICS] Error loading analytics:', error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Only load analytics once profile is loaded
  useEffect(() => {
    if (!profileLoading && userProfile) {
      loadAnalytics();
    }
  }, [profileLoading, userProfile]);

  const onRefresh = () => {
    setRefreshing(true);
    loadAnalytics();
  };

  const StatCard = ({
    icon,
    title,
    value,
    subtitle,
    color = '#3b82f6',
  }: {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    title: string;
    value: string | number;
    subtitle?: string;
    color?: string;
  }) => (
    <View className="bg-neutral-800 rounded-xl p-4 mb-4">
      <View className="flex-row items-center mb-3">
        <View
          className="w-12 h-12 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: color + '20' }}
        >
          <MaterialCommunityIcons name={icon} size={24} color={color} />
        </View>
        <View className="flex-1">
          <AppText className="text-sm color-neutral-400">{title}</AppText>
          <AppText className="text-2xl font-bold color-white mt-1">{value}</AppText>
          {subtitle && <AppText className="text-xs color-neutral-500 mt-1">{subtitle}</AppText>}
        </View>
      </View>
    </View>
  );

  if (profileLoading) {
    return (
      <View className="flex-1 bg-neutral-900 justify-center items-center">
        <AppText className="color-white">Loading...</AppText>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
      >
        {/* Header */}
        <View className="mb-6">
          <AppText className="text-3xl font-bold color-white mb-2">Analytics</AppText>
          <AppText className="text-base color-neutral-400">System-wide usage metrics and insights</AppText>
        </View>

        {/* User Statistics */}
        <AppText className="text-lg font-bold color-white mb-4 mt-6">User Statistics</AppText>

        <StatCard
          icon="account-group"
          title="Total Users"
          value={analytics.totalUsers}
          color="#3b82f6"
        />

        <StatCard
          icon="account-check"
          title="Active Users"
          value={analytics.activeUsers}
          subtitle={`${Math.round((analytics.activeUsers / analytics.totalUsers) * 100) || 0}% active`}
          color="#10b981"
        />

        <StatCard
          icon="account-off"
          title="Suspended Users"
          value={analytics.suspendedUsers}
          color="#ef4444"
        />

        <StatCard
          icon="shield-account"
          title="Administrators"
          value={analytics.adminCount}
          subtitle={`${analytics.userCount} regular users`}
          color="#8b5cf6"
        />

        {/* Activity Statistics */}
        <AppText className="text-lg font-bold color-white mb-4 mt-6">Activity Statistics</AppText>

        <StatCard
          icon="dumbbell"
          title="Workouts Completed"
          value={analytics.workoutsCompleted}
          color="#f59e0b"
        />

        <StatCard
          icon="video"
          title="Videos Uploaded"
          value={analytics.videosUploaded}
          color="#06b6d4"
        />

        <StatCard
          icon="clock"
          title="Average Session Duration"
          value={`${analytics.averageSessionDuration}m`}
          subtitle="minutes"
          color="#ec4899"
        />

        <StatCard
          icon="chart-line"
          title="Peak Activity Hour"
          value={`${analytics.peakActivityHour}:00`}
          subtitle="24-hour format"
          color="#a78bfa"
        />

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
