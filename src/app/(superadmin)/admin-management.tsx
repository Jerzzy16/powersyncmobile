import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StatusBar, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';
import { UserProfile, UserRole } from '../../types/UserProfile.d';

type TabType = 'admins' | 'users';

export default function AdminManagement() {
  const { getAllUsers, updateUserRole, deleteUser, userProfile, loading: profileLoading } = useAdminAuth();
  const [admins, setAdmins] = useState<UserProfile[]>([]);
  const [regularUsers, setRegularUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState<TabType>('admins');
  const [searchQuery, setSearchQuery] = useState('');

  const loadUsers = async () => {
    try {
      if (__DEV__) {
        console.log('[ADMIN MANAGEMENT] Loading users');
      }
      
      // Wait for profile to load
      if (!userProfile) {
        if (__DEV__) {
          console.log('[ADMIN MANAGEMENT] Waiting for user profile to load...');
        }
        return;
      }
      
      const allUsers = await getAllUsers();
      const adminUsers = allUsers.filter(u => u.role === 'admin' || u.role === 'superadmin');
      const normalUsers = allUsers.filter(u => u.role === 'user');
      setAdmins(adminUsers);
      setRegularUsers(normalUsers);
    } catch (error) {
      if (__DEV__) {
        console.error('[ADMIN MANAGEMENT] Error loading users:', error);
      }
      Alert.alert('Error', 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Only load users once profile is loaded
    if (!profileLoading && userProfile) {
      loadUsers();
    }
  }, [profileLoading, userProfile]);

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const handlePromoteDemote = (user: UserProfile) => {
    const newRole: UserRole = user.role === 'superadmin' ? 'admin' : 'superadmin';
    const action = user.role === 'superadmin' ? 'Demote' : 'Promote';

    Alert.alert(
      `${action} Administrator`,
      `${action} ${user.displayName} ${newRole === 'superadmin' ? 'to Super Admin' : 'to Admin'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: newRole === 'admin' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await updateUserRole(user.uid, newRole);
              await loadUsers();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          },
        },
      ]
    );
  };

  const handlePromoteToAdmin = (user: UserProfile) => {
    Alert.alert(
      'Promote to Admin',
      `Grant administrator privileges to ${user.displayName}?\n\nThis will allow them to:\n• Manage users\n• View analytics\n• Access admin panel\n• View audit logs`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Promote',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateUserRole(user.uid, 'admin');
              await loadUsers();
              Alert.alert('Success', `${user.displayName} is now an administrator`);
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAdmin = (admin: UserProfile) => {
    Alert.alert(
      'Delete Administrator',
      `Are you sure you want to permanently delete ${admin.displayName}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteUser(admin.uid, 'Deleted by super admin');
              await loadUsers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete admin');
            }
          },
        },
      ]
    );
  };

  const handleDeleteUser = (user: UserProfile) => {
    Alert.alert(
      'Delete User',
      `Are you sure you want to permanently delete ${user.displayName}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteUser(user.uid, 'Deleted by super admin');
              await loadUsers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete user');
            }
          },
        },
      ]
    );
  };

  // Filter users based on search
  const filteredAdmins = admins.filter(admin =>
    admin.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    admin.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredRegularUsers = regularUsers.filter(user =>
    user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const AdminCard = ({ admin }: { admin: UserProfile }) => (
    <View className="bg-neutral-800 rounded-xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-1">
          <AppText className="color-white font-bold text-base">{admin.displayName}</AppText>
          <AppText className="color-gray-400 text-sm">{admin.email}</AppText>
        </View>
        <View
          className="px-3 py-1 rounded-full"
          style={{ backgroundColor: admin.role === 'superadmin' ? '#8b5cf630' : '#3b82f630' }}
        >
          <AppText className={admin.role === 'superadmin' ? 'color-purple-500 text-xs font-bold' : 'color-blue-500 text-xs font-bold'}>
            {admin.role === 'superadmin' ? 'SUPER ADMIN' : 'ADMIN'}
          </AppText>
        </View>
      </View>

      <View className="border-t border-neutral-700 pt-3 mt-2">
        <View className="flex-row justify-between items-center mb-2">
          <AppText className="color-gray-400 text-xs">User ID:</AppText>
          <AppText className="color-gray-300 text-xs font-mono">{admin.uid.substring(0, 12)}...</AppText>
        </View>
        <View className="flex-row justify-between items-center mb-2">
          <AppText className="color-gray-400 text-xs">Created:</AppText>
          <AppText className="color-gray-300 text-xs">
            {admin.createdAt ? new Date(admin.createdAt).toLocaleDateString() : 'N/A'}
          </AppText>
        </View>
        {admin.security?.lastLogin && (
          <View className="flex-row justify-between items-center">
            <AppText className="color-gray-400 text-xs">Last Login:</AppText>
            <AppText className="color-gray-300 text-xs">
              {new Date(admin.security.lastLogin).toLocaleDateString()}
            </AppText>
          </View>
        )}
      </View>

      <View className="flex-row mt-3 pt-3 border-t border-neutral-700">
        <TouchableOpacity
          className={`flex-1 rounded-lg p-3 ${admin.role === 'superadmin' ? 'bg-orange-500' : 'bg-purple-500'}`}
          onPress={() => handlePromoteDemote(admin)}
        >
          <AppText className="color-white font-bold text-center text-sm">
            {admin.role === 'superadmin' ? 'Demote to Admin' : 'Promote to Super Admin'}
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-red-700 rounded-lg p-3 ml-2"
          onPress={() => handleDeleteAdmin(admin)}
        >
          <AppText className="color-white font-bold text-center text-sm">Delete</AppText>
        </TouchableOpacity>
      </View>
    </View>
  );

  const UserCard = ({ user }: { user: UserProfile }) => (
    <View className="bg-neutral-800 rounded-xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-1">
          <AppText className="color-white font-bold text-base">{user.displayName}</AppText>
          <AppText className="color-gray-400 text-sm">{user.email}</AppText>
        </View>
        <View className="px-3 py-1 rounded-full bg-gray-600">
          <AppText className="color-gray-300 text-xs font-bold">USER</AppText>
        </View>
      </View>

      <View className="border-t border-neutral-700 pt-3 mt-2">
        <View className="flex-row justify-between items-center mb-2">
          <AppText className="color-gray-400 text-xs">User ID:</AppText>
          <AppText className="color-gray-300 text-xs font-mono">{user.uid.substring(0, 12)}...</AppText>
        </View>
        <View className="flex-row justify-between items-center mb-2">
          <AppText className="color-gray-400 text-xs">Joined:</AppText>
          <AppText className="color-gray-300 text-xs">
            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
          </AppText>
        </View>
        {user.security?.lastLogin && (
          <View className="flex-row justify-between items-center">
            <AppText className="color-gray-400 text-xs">Last Active:</AppText>
            <AppText className="color-gray-300 text-xs">
              {new Date(user.security.lastLogin).toLocaleDateString()}
            </AppText>
          </View>
        )}
      </View>

      <View className="flex-row mt-3 pt-3 border-t border-neutral-700">
        <TouchableOpacity
          className="flex-1 rounded-lg p-3 bg-green-600"
          onPress={() => handlePromoteToAdmin(user)}
        >
          <View className="flex-row items-center justify-center">
            <MaterialCommunityIcons name="arrow-up-bold" size={16} color="#fff" />
            <AppText className="color-white font-bold text-sm ml-2">Promote to Admin</AppText>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-red-700 rounded-lg p-3 ml-2"
          onPress={() => handleDeleteUser(user)}
        >
          <AppText className="color-white font-bold text-center text-sm">Delete</AppText>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <View className="bg-purple-900 p-4 border-b border-purple-700">
        <View className="flex-row items-center">
          <MaterialCommunityIcons name="shield-crown" size={24} color="#a78bfa" />
          <View className="ml-3 flex-1">
            <AppText className="color-white font-bold">Administrator Management</AppText>
            <AppText className="color-purple-200 text-xs">
              {selectedTab === 'admins' 
                ? `${admins.length} administrator${admins.length !== 1 ? 's' : ''}` 
                : `${regularUsers.length} regular user${regularUsers.length !== 1 ? 's' : ''}`}
            </AppText>
          </View>
        </View>
      </View>

      {/* Tab Selector */}
      <View className="flex-row bg-neutral-800 border-b border-neutral-700">
        <TouchableOpacity
          className={`flex-1 p-4 border-b-2 ${selectedTab === 'admins' ? 'border-purple-500' : 'border-transparent'}`}
          onPress={() => setSelectedTab('admins')}
        >
          <AppText className={`text-center font-bold ${selectedTab === 'admins' ? 'color-purple-500' : 'color-gray-400'}`}>
            Admins ({admins.length})
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 p-4 border-b-2 ${selectedTab === 'users' ? 'border-green-500' : 'border-transparent'}`}
          onPress={() => setSelectedTab('users')}
        >
          <AppText className={`text-center font-bold ${selectedTab === 'users' ? 'color-green-500' : 'color-gray-400'}`}>
            Users ({regularUsers.length})
          </AppText>
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8b5cf6" />}
      >
        {loading ? (
          <AppText className="color-white text-center mt-8">Loading {selectedTab}...</AppText>
        ) : selectedTab === 'admins' ? (
          filteredAdmins.length === 0 ? (
            <View className="items-center mt-8">
              <MaterialCommunityIcons name="shield-off" size={64} color="#6b7280" />
              <AppText className="color-gray-400 text-center mt-4">No administrators found</AppText>
            </View>
          ) : (
            filteredAdmins.map(admin => <AdminCard key={admin.uid} admin={admin} />)
          )
        ) : (
          filteredRegularUsers.length === 0 ? (
            <View className="items-center mt-8">
              <MaterialCommunityIcons name="account-group" size={64} color="#6b7280" />
              <AppText className="color-gray-400 text-center mt-4">No regular users found</AppText>
            </View>
          ) : (
            filteredRegularUsers.map(user => <UserCard key={user.uid} user={user} />)
          )
        )}
      </ScrollView>
    </View>
  );
}
