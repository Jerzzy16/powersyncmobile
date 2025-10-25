import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';

export default function SuperAdminLayout() {
  const { hasSuperAdminAccess, loading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !hasSuperAdminAccess) {
      if (__DEV__) {
        console.warn('[SUPER ADMIN LAYOUT] Access denied - redirecting');
      }
      router.replace('/(app)/index');
    }
  }, [hasSuperAdminAccess, loading, router]);

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-neutral-900">
        <ActivityIndicator size="large" color="#8b5cf6" />
        <AppText className="color-white mt-4">Loading super admin panel...</AppText>
      </View>
    );
  }

  if (!hasSuperAdminAccess) {
    return (
      <View className="flex-1 justify-center items-center bg-neutral-900">
        <AppText className="color-red-500 text-xl font-bold">Access Denied</AppText>
        <AppText className="color-white mt-2">Super admin privileges required</AppText>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: '#581c87',
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
          title: 'Super Admin Dashboard',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="admin-management"
        options={{
          title: 'Admin Management',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="system-config"
        options={{
          title: 'System Configuration',
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="audit-trails"
        options={{
          title: 'Complete Audit Trails',
          headerShown: true,
        }}
      />
    </Stack>
  );
}
