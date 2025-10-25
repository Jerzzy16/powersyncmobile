import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';

export default function AdminLayout() {
  const { hasAdminAccess, loading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !hasAdminAccess) {
      if (__DEV__) {
        console.warn('[ADMIN LAYOUT] Access denied - redirecting');
      }
      router.replace('/(app)/index');
    }
  }, [hasAdminAccess, loading, router]);

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-neutral-900">
        <ActivityIndicator size="large" color="#3b82f6" />
        <AppText className="color-white mt-4">Loading admin panel...</AppText>
      </View>
    );
  }

  if (!hasAdminAccess) {
    return (
      <View className="flex-1 justify-center items-center bg-neutral-900">
        <AppText className="color-red-500 text-xl font-bold">Access Denied</AppText>
        <AppText className="color-white mt-2">You do not have admin privileges</AppText>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: '#1f2937',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Stack.Screen
        name="dashboard"
        options={{
          title: 'Admin Dashboard',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="user-management"
        options={{
          title: 'User Management',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="security-logs"
        options={{
          title: 'Security Logs',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Admin Settings',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="create-user"
        options={{
          title: 'Create New User',
          headerShown: true,
        }}
      />
    </Stack>
  );
}
