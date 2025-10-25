import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, TextInput, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';
import type { AuditLog } from '../../types/UserProfile.d';

type SeverityFilter = 'all' | 'critical' | 'warning' | 'error' | 'info';
type CategoryFilter = 'all' | 'auth' | 'user_management' | 'system' | 'security' | 'data_access';

export default function AuditTrails() {
  const { getAuditLogs, userProfile, loading: profileLoading } = useAdminAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    // Only load logs once profile is loaded
    if (!profileLoading && userProfile) {
      loadLogs();
    }
  }, [profileLoading, userProfile]);

  useEffect(() => {
    applyFilters();
  }, [logs, severityFilter, categoryFilter, searchQuery]);

  const loadLogs = async () => {
    try {
      if (__DEV__) {
        console.log('[AUDIT TRAILS] Loading comprehensive audit logs');
      }
      
      // Wait for profile to load
      if (!userProfile) {
        if (__DEV__) {
          console.log('[AUDIT TRAILS] Waiting for user profile to load...');
        }
        return;
      }
      
      const auditLogs = await getAuditLogs(500); // Load more logs for super admin
      setLogs(auditLogs);
    } catch (error) {
      if (__DEV__) {
        console.error('[AUDIT TRAILS] Error loading logs:', error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...logs];

    // Apply severity filter
    if (severityFilter !== 'all') {
      filtered = filtered.filter(log => log.severity === severityFilter);
    }

    // Apply category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(log => log.category === categoryFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log =>
        log.userEmail.toLowerCase().includes(query) ||
        log.action.toLowerCase().includes(query) ||
        log.userId.toLowerCase().includes(query) ||
        JSON.stringify(log.details).toLowerCase().includes(query)
      );
    }

    setFilteredLogs(filtered);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadLogs();
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'alert-octagon';
      case 'error':
        return 'alert-circle';
      case 'warning':
        return 'alert';
      default:
        return 'information';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '#dc2626';
      case 'error':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      default:
        return '#3b82f6';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'auth':
        return 'login';
      case 'user_management':
        return 'account-group';
      case 'system':
        return 'cog';
      case 'security':
        return 'shield-alert';
      case 'data_access':
        return 'database';
      default:
        return 'file-document';
    }
  };

  const FilterButton = ({
    active,
    label,
    onPress,
    color = '#6b7280',
  }: {
    active: boolean;
    label: string;
    onPress: () => void;
    color?: string;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      className={`px-4 py-2 rounded-full mr-2 mb-2 ${active ? 'bg-opacity-100' : 'bg-opacity-20'}`}
      style={{ backgroundColor: active ? color : color + '33' }}
    >
      <AppText className={`text-xs font-bold ${active ? 'color-white' : 'color-gray-400'}`}>
        {label}
      </AppText>
    </TouchableOpacity>
  );

  const LogCard = ({ log }: { log: AuditLog }) => {
    const isExpanded = expandedLogId === log.id;
    const severityColor = getSeverityColor(log.severity);
    
    // Map severity to Tailwind color classes
    const getSeverityTextClass = (severity: string) => {
      switch (severity) {
        case 'critical':
          return 'color-red-600';
        case 'error':
          return 'color-red-500';
        case 'warning':
          return 'color-orange-500';
        default:
          return 'color-blue-500';
      }
    };

    return (
      <TouchableOpacity
        className="bg-neutral-800 rounded-xl p-4 mb-3"
        style={{ borderLeftWidth: 4, borderLeftColor: severityColor }}
        onPress={() => setExpandedLogId(isExpanded ? null : log.id)}
      >
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-row items-center flex-1">
            <MaterialCommunityIcons
              name={getSeverityIcon(log.severity) as any}
              size={20}
              color={severityColor}
            />
            <View className="ml-2 flex-1">
              <AppText className="color-white font-bold text-sm">{log.action.replace(/_/g, ' ')}</AppText>
              <AppText className="color-gray-400 text-xs mt-1">{log.userEmail}</AppText>
            </View>
          </View>
          <View className="items-end">
            <View
              className="px-2 py-1 rounded"
              style={{ backgroundColor: severityColor + '30' }}
            >
              <AppText className={`text-xs font-bold ${getSeverityTextClass(log.severity)}`}>
                {log.severity.toUpperCase()}
              </AppText>
            </View>
            <AppText className="color-gray-500 text-xs mt-1">
              {new Date(log.timestamp).toLocaleTimeString()}
            </AppText>
          </View>
        </View>

        <View className="flex-row items-center mt-2">
          <MaterialCommunityIcons
            name={getCategoryIcon(log.category) as any}
            size={14}
            color="#9ca3af"
          />
          <AppText className="color-gray-400 text-xs ml-1">{log.category}</AppText>
          <AppText className="color-gray-600 mx-2">•</AppText>
          <AppText className="color-gray-400 text-xs">{log.userRole}</AppText>
        </View>

        {isExpanded && (
          <View className="mt-3 pt-3 border-t border-neutral-700">
            <AppText className="color-gray-400 text-xs mb-2">User ID: {log.userId}</AppText>
            <AppText className="color-gray-400 text-xs mb-2">
              Timestamp: {new Date(log.timestamp).toLocaleString()}
            </AppText>
            {log.resourceId && (
              <AppText className="color-gray-400 text-xs mb-2">
                Resource: {log.resourceType} - {log.resourceId}
              </AppText>
            )}
            <AppText className="color-gray-400 text-xs mb-2">
              Status: {log.success ? '✓ Success' : '✗ Failed'}
            </AppText>
            {log.errorMessage && (
              <View className="bg-red-500 bg-opacity-10 rounded p-2 mb-2">
                <AppText className="color-red-400 text-xs">Error: {log.errorMessage}</AppText>
              </View>
            )}
            {log.ipAddress && (
              <AppText className="color-gray-400 text-xs mb-2">IP: {log.ipAddress}</AppText>
            )}
            <AppText className="color-gray-400 text-xs mb-1">Details:</AppText>
            <View className="bg-neutral-900 rounded p-2">
              <AppText className="color-gray-300 text-xs font-mono">
                {JSON.stringify(log.details, null, 2)}
              </AppText>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      {/* Header Stats */}
      <View className="bg-gradient-to-r from-green-600 to-green-900 p-4">
        <AppText className="color-white font-bold text-lg mb-2">Complete Audit Trail</AppText>
        <View className="flex-row justify-between">
          <View>
            <AppText className="color-green-200 text-xs">Total Logs</AppText>
            <AppText className="color-white font-bold text-xl">{logs.length}</AppText>
          </View>
          <View>
            <AppText className="color-green-200 text-xs">Filtered</AppText>
            <AppText className="color-white font-bold text-xl">{filteredLogs.length}</AppText>
          </View>
          <View>
            <AppText className="color-green-200 text-xs">Critical</AppText>
            <AppText className="color-white font-bold text-xl">
              {logs.filter(l => l.severity === 'critical').length}
            </AppText>
          </View>
        </View>
      </View>

      {/* Search Bar */}
      <View className="bg-neutral-800 p-4">
        <View className="flex-row items-center bg-neutral-700 rounded-lg px-3">
          <MaterialCommunityIcons name="magnify" size={20} color="#9ca3af" />
          <TextInput
            className="flex-1 color-white p-3"
            placeholder="Search logs..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialCommunityIcons name="close-circle" size={20} color="#6b7280" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Severity Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="bg-neutral-800 border-b border-neutral-700"
        contentContainerStyle={{ padding: 12 }}
      >
        <FilterButton
          active={severityFilter === 'all'}
          label="All"
          onPress={() => setSeverityFilter('all')}
        />
        <FilterButton
          active={severityFilter === 'critical'}
          label="Critical"
          onPress={() => setSeverityFilter('critical')}
          color="#dc2626"
        />
        <FilterButton
          active={severityFilter === 'error'}
          label="Error"
          onPress={() => setSeverityFilter('error')}
          color="#ef4444"
        />
        <FilterButton
          active={severityFilter === 'warning'}
          label="Warning"
          onPress={() => setSeverityFilter('warning')}
          color="#f59e0b"
        />
        <FilterButton
          active={severityFilter === 'info'}
          label="Info"
          onPress={() => setSeverityFilter('info')}
          color="#3b82f6"
        />
      </ScrollView>

      {/* Category Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="bg-neutral-800 border-b border-neutral-700"
        contentContainerStyle={{ padding: 12 }}
      >
        <FilterButton
          active={categoryFilter === 'all'}
          label="All Categories"
          onPress={() => setCategoryFilter('all')}
        />
        <FilterButton
          active={categoryFilter === 'auth'}
          label="Auth"
          onPress={() => setCategoryFilter('auth')}
          color="#8b5cf6"
        />
        <FilterButton
          active={categoryFilter === 'security'}
          label="Security"
          onPress={() => setCategoryFilter('security')}
          color="#dc2626"
        />
        <FilterButton
          active={categoryFilter === 'user_management'}
          label="User Mgmt"
          onPress={() => setCategoryFilter('user_management')}
          color="#3b82f6"
        />
        <FilterButton
          active={categoryFilter === 'system'}
          label="System"
          onPress={() => setCategoryFilter('system')}
          color="#10b981"
        />
        <FilterButton
          active={categoryFilter === 'data_access'}
          label="Data Access"
          onPress={() => setCategoryFilter('data_access')}
          color="#f59e0b"
        />
      </ScrollView>

      {/* Logs List */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
      >
        {loading ? (
          <AppText className="color-white text-center mt-8">Loading audit logs...</AppText>
        ) : filteredLogs.length === 0 ? (
          <View className="items-center mt-8">
            <MaterialCommunityIcons name="clipboard-text-off" size={64} color="#6b7280" />
            <AppText className="color-gray-400 text-center mt-4">No logs found</AppText>
          </View>
        ) : (
          filteredLogs.map(log => <LogCard key={log.id} log={log} />)
        )}
      </ScrollView>
    </View>
  );
}
