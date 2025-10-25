import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StatusBar, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';
import { UserProfile, UserRole } from '../../types/UserProfile.d';

export default function UserManagement() {
  const { userProfile, getAllUsers, suspendUser, reactivateUser, updateUserRole, deleteUser, hasSuperAdminAccess, loading: profileLoading } = useAdminAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'suspended'>('all');

  const loadUsers = async () => {
    try {
      if (__DEV__) {
        console.log('[USER MANAGEMENT] Loading users');
      }
      const userList = await getAllUsers();
      
      // Admins should not see superadmins - only see users and other admins
      let filteredList = userList;
      if (!hasSuperAdminAccess && userProfile?.role === 'admin') {
        filteredList = userList.filter(u => u.role !== 'superadmin');
        if (__DEV__) {
          console.log('[USER MANAGEMENT] Admin view - filtered out superadmins');
        }
      }
      
      setUsers(filteredList);
      filterUsersList(filteredList, searchQuery, filterStatus);
    } catch (error) {
      if (__DEV__) {
        console.error('[USER MANAGEMENT] Error loading users:', error);
      }
      Alert.alert('Error', 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Only load users once profile is loaded
  useEffect(() => {
    if (!profileLoading) {
      loadUsers();
    }
  }, [profileLoading]);

  useEffect(() => {
    filterUsersList(users, searchQuery, filterStatus);
  }, [searchQuery, filterStatus]);

  const filterUsersList = (userList: UserProfile[], query: string, status: string) => {
    let filtered = userList;

    // Filter by status
    if (status !== 'all') {
      filtered = filtered.filter(u => u.accountStatus === status);
    }

    // Filter by search query
    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(
        u =>
          u.displayName.toLowerCase().includes(lowerQuery) ||
          u.email.toLowerCase().includes(lowerQuery) ||
          u.uid.toLowerCase().includes(lowerQuery)
      );
    }

    setFilteredUsers(filtered);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const handleSuspendUser = (user: UserProfile) => {
    Alert.alert(
      'Suspend User',
      `Are you sure you want to suspend ${user.displayName}? They will not be able to access the app.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: async () => {
            try {
              await suspendUser(user.uid, 'Suspended by admin');
              await loadUsers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to suspend user');
            }
          },
        },
      ]
    );
  };

  const handleReactivateUser = (user: UserProfile) => {
    Alert.alert(
      'Reactivate User',
      `Reactivate ${user.displayName}'s account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reactivate',
          onPress: async () => {
            try {
              await reactivateUser(user.uid);
              await loadUsers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to reactivate user');
            }
          },
        },
      ]
    );
  };

  const handleChangeRole = (user: UserProfile) => {
    if (!hasSuperAdminAccess) {
      Alert.alert('Permission Denied', 'Only super administrators can change user roles');
      return;
    }

    const roles: UserRole[] = ['user', 'admin', 'superadmin'];
    const roleLabels = ['User', 'Administrator', 'Super Administrator'];

    const buttons = roles.map((role, index) => ({
      text: roleLabels[index] + (role === user.role ? ' (current)' : ''),
      onPress: async () => {
        if (role === user.role) return;
        try {
          await updateUserRole(user.uid, role);
          await loadUsers();
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to update role');
        }
      },
    }));

    buttons.push({ text: 'Cancel', onPress: async () => { return; } });

    Alert.alert(
      'Change User Role',
      `Select new role for ${user.displayName}`,
      buttons
    );
  };

  const handleDeleteUser = (user: UserProfile) => {
    // Check if admin is trying to delete a superadmin
    if (userProfile?.role === 'admin' && user.role === 'superadmin') {
      Alert.alert('Permission Denied', 'Admins cannot delete Super Admin accounts');
      return;
    }

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
              await deleteUser(user.uid, 'Deleted by admin');
              await loadUsers();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete user');
            }
          },
        },
      ]
    );
  };

  const UserCard = ({ user }: { user: UserProfile }) => {
    const getRoleColor = (role: UserRole) => {
      switch (role) {
        case 'superadmin':
          return '#8b5cf6';
        case 'admin':
          return '#3b82f6';
        default:
          return '#6b7280';
      }
    };

    const getStatusColor = () => {
      switch (user.accountStatus) {
        case 'active':
          return '#10b981';
        case 'suspended':
          return '#ef4444';
        case 'locked':
          return '#f59e0b';
        default:
          return '#6b7280';
      }
    };

    return (
      <View className="bg-neutral-800 rounded-xl p-4 mb-3">
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-1">
            <AppText className="color-white font-bold text-base">{user.displayName}</AppText>
            <AppText className="color-gray-400 text-sm">{user.email}</AppText>
          </View>
          <View className="flex-row items-center">
            <View
              className="px-3 py-1 rounded-full mr-2"
              style={{ backgroundColor: getRoleColor(user.role) + '30' }}
            >
              <AppText className="text-xs font-bold color-purple-500">
                {user.role.toUpperCase()}
              </AppText>
            </View>
            <View
              className="px-3 py-1 rounded-full"
              style={{ backgroundColor: getStatusColor() + '30' }}
            >
              <AppText className="text-xs font-bold color-green-500">
                {user.accountStatus.toUpperCase()}
              </AppText>
            </View>
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
            <View className="flex-row justify-between items-center mb-2">
              <AppText className="color-gray-400 text-xs">Last Login:</AppText>
              <AppText className="color-gray-300 text-xs">
                {new Date(user.security.lastLogin).toLocaleDateString()}
              </AppText>
            </View>
          )}
          {user.security?.failedLoginAttempts > 0 && (
            <View className="flex-row justify-between items-center">
              <AppText className="color-gray-400 text-xs">Failed Attempts:</AppText>
              <AppText className="color-red-400 text-xs font-bold">
                {user.security.failedLoginAttempts}
              </AppText>
            </View>
          )}
        </View>

        <View className="flex-row mt-3 pt-3 border-t border-neutral-700">
          {user.accountStatus === 'active' ? (
            <TouchableOpacity
              className="flex-1 bg-red-500 rounded-lg p-3 mr-2"
              onPress={() => handleSuspendUser(user)}
            >
              <AppText className="color-white font-bold text-center text-sm">Suspend</AppText>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              className="flex-1 bg-green-500 rounded-lg p-3 mr-2"
              onPress={() => handleReactivateUser(user)}
            >
              <AppText className="color-white font-bold text-center text-sm">Reactivate</AppText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="flex-1 bg-blue-500 rounded-lg p-3 mr-2"
            onPress={() => handleChangeRole(user)}
            disabled={!hasSuperAdminAccess}
            style={{ opacity: hasSuperAdminAccess ? 1 : 0.5 }}
          >
            <AppText className="color-white font-bold text-center text-sm">Change Role</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-red-700 rounded-lg p-3"
            onPress={() => handleDeleteUser(user)}
          >
            <AppText className="color-white font-bold text-center text-sm">Delete</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      {/* Search and Filter */}
      <View className="bg-neutral-800 p-4 border-b border-neutral-700">
        <View className="flex-row items-center bg-neutral-700 rounded-lg px-3 py-2 mb-3">
          <MaterialCommunityIcons name="magnify" size={20} color="#9ca3af" />
          <TextInput
            className="flex-1 ml-2 color-white"
            placeholder="Search users..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <View className="flex-row">
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg mr-2 ${filterStatus === 'all' ? 'bg-blue-500' : 'bg-neutral-700'}`}
            onPress={() => setFilterStatus('all')}
          >
            <AppText className="color-white text-center text-sm font-bold">All ({users.length})</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg mr-2 ${filterStatus === 'active' ? 'bg-green-500' : 'bg-neutral-700'}`}
            onPress={() => setFilterStatus('active')}
          >
            <AppText className="color-white text-center text-sm font-bold">
              Active ({users.filter(u => u.accountStatus === 'active').length})
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg ${filterStatus === 'suspended' ? 'bg-red-500' : 'bg-neutral-700'}`}
            onPress={() => setFilterStatus('suspended')}
          >
            <AppText className="color-white text-center text-sm font-bold">
              Suspended ({users.filter(u => u.accountStatus === 'suspended').length})
            </AppText>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
      >
        {loading ? (
          <AppText className="color-white text-center mt-8">Loading users...</AppText>
        ) : filteredUsers.length === 0 ? (
          <View className="items-center mt-8">
            <MaterialCommunityIcons name="account-off" size={64} color="#6b7280" />
            <AppText className="color-gray-400 text-center mt-4">No users found</AppText>
          </View>
        ) : (
          filteredUsers.map(user => <UserCard key={user.uid} user={user} />)
        )}
      </ScrollView>
    </View>
  );
}
