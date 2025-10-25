import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, TouchableOpacity, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { useAdminAuth } from '../../hooks/AdminAuthHooks';
import { AuditLog } from '../../types/UserProfile.d';

export default function SecurityLogs() {
  const { getAuditLogs, loading: profileLoading } = useAdminAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'error'>('all');

  const loadLogs = async () => {
    try {
      if (__DEV__) {
        console.log('[SECURITY LOGS] Loading audit logs');
      }
      const auditLogs = await getAuditLogs(200);
      setLogs(auditLogs);
    } catch (error) {
      if (__DEV__) {
        console.error('[SECURITY LOGS] Error loading logs:', error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Only load logs once profile is loaded
  useEffect(() => {
    if (!profileLoading) {
      loadLogs();
    }
  }, [profileLoading]);

  const onRefresh = () => {
    setRefreshing(true);
    loadLogs();
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

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    return log.severity === filter;
  });

  const LogCard = ({ log }: { log: AuditLog }) => (
    <View className="bg-neutral-800 rounded-xl p-4 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center flex-1">
          <MaterialCommunityIcons
            name={getSeverityIcon(log.severity) as any}
            size={20}
            color={getSeverityColor(log.severity)}
          />
          <AppText className="color-white font-bold text-sm ml-2 flex-1">{log.action}</AppText>
        </View>
        <View className="px-2 py-1 rounded" style={{ backgroundColor: getSeverityColor(log.severity) + '30' }}>
          <AppText className="text-xs font-bold color-white">{log.severity.toUpperCase()}</AppText>
        </View>
      </View>

      <AppText className="color-gray-400 text-xs mb-2">
        {log.userEmail} ({log.userRole})
      </AppText>

      <AppText className="color-gray-300 text-xs mb-2">
        {new Date(log.timestamp).toLocaleString()}
      </AppText>

      {log.details && (
        <View className="bg-neutral-700 rounded p-2 mt-2">
          <AppText className="color-gray-300 text-xs font-mono">
            {JSON.stringify(log.details, null, 2)}
          </AppText>
        </View>
      )}

      {!log.success && log.errorMessage && (
        <View className="bg-red-500 bg-opacity-20 rounded p-2 mt-2">
          <AppText className="color-red-400 text-xs">{log.errorMessage}</AppText>
        </View>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <View className="bg-neutral-800 p-4 border-b border-neutral-700">
        <View className="flex-row">
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg mr-2 ${filter === 'all' ? 'bg-blue-500' : 'bg-neutral-700'}`}
            onPress={() => setFilter('all')}
          >
            <AppText className="color-white text-center text-xs font-bold">All</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg mr-2 ${filter === 'critical' ? 'bg-red-600' : 'bg-neutral-700'}`}
            onPress={() => setFilter('critical')}
          >
            <AppText className="color-white text-center text-xs font-bold">Critical</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg mr-2 ${filter === 'warning' ? 'bg-orange-500' : 'bg-neutral-700'}`}
            onPress={() => setFilter('warning')}
          >
            <AppText className="color-white text-center text-xs font-bold">Warning</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 p-2 rounded-lg ${filter === 'error' ? 'bg-red-500' : 'bg-neutral-700'}`}
            onPress={() => setFilter('error')}
          >
            <AppText className="color-white text-center text-xs font-bold">Error</AppText>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
      >
        {loading ? (
          <AppText className="color-white text-center mt-8">Loading security logs...</AppText>
        ) : filteredLogs.length === 0 ? (
          <View className="items-center mt-8">
            <MaterialCommunityIcons name="shield-check" size={64} color="#10b981" />
            <AppText className="color-gray-400 text-center mt-4">No security events found</AppText>
          </View>
        ) : (
          filteredLogs.map(log => <LogCard key={log.id} log={log} />)
        )}
      </ScrollView>
    </View>
  );
}
