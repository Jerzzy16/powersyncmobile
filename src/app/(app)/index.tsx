// app/(app)/index.tsx
import { AppText } from "@/components/AppText";
import { SkeletonLoader } from "@/components/SkeletonLoader";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Image, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { useMediaUpload } from "../../hooks/MediaHooks";
import { useUserProfile } from "../../hooks/UserHooks";

export default function IndexScreen() {
  const { userProfile, loadingProfile } = useUserProfile();
  const { userVideos, loadingVideos, loadUserVideos } = useMediaUpload();
  const router = useRouter();
  const [recentVideos, setRecentVideos] = useState<any[]>([]);

  // Load user videos when component mounts
  useEffect(() => {
    if (__DEV__) {
      console.log('[INDEX] Loading user videos for dashboard');
    }
    const unsubscribe = loadUserVideos();
    return () => unsubscribe && unsubscribe();
  }, []);

  // Get recent 3 videos for dashboard preview
  useEffect(() => {
    if (userVideos.length > 0) {
      setRecentVideos(userVideos.slice(0, 3));
    }
  }, [userVideos]);

  // QuickLink Component
  const QuickLink = ({
    icon,
    title,
    subtitle,
    color,
    onPress,
  }: {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    title: string;
    subtitle: string;
    color: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      className="bg-neutral-800 rounded-xl p-4 mb-3 flex-row items-center"
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <View
        className="w-12 h-12 rounded-full items-center justify-center mr-4"
        style={{ backgroundColor: color + '20' }}
      >
        <MaterialCommunityIcons name={icon} size={24} color={color} />
      </View>
      <View className="flex-1">
        <AppText className="color-white font-bold text-base">{title}</AppText>
        <AppText className="color-gray-400 text-xs mt-1">{subtitle}</AppText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={24} color="#6b7280" />
    </TouchableOpacity>
  );

  // Video Card Component for Dashboard
  const VideoCard = ({ video }: { video: any }) => (
    <TouchableOpacity
      onPress={() => {
        if (__DEV__) {
          console.log('[INDEX] Navigate to create screen');
        }
        router.push('/(app)/create');
      }}
      className="bg-neutral-800 rounded-xl mr-3 w-48"
    >
      <View className="w-48 h-32 bg-neutral-700 rounded-t-xl items-center justify-center overflow-hidden">
        {video.thumbnailUrl ? (
          <Image
            source={{ uri: video.thumbnailUrl }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <MaterialCommunityIcons name="play-circle" size={48} color="#C6F806" />
        )}
      </View>
      <View className="p-3">
        <AppText className="color-white font-semibold text-sm">
          {video.title}
        </AppText>
        <AppText className="color-gray-400 text-xs mt-1">
          {Math.floor((video.duration || 0) / 60)}:{Math.floor((video.duration || 0) % 60).toString().padStart(2, '0')}
        </AppText>
      </View>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-neutral-900">
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="p-6 pt-16">
          {/* Header */}
          <View className="flex-row justify-between items-center mb-6">
            <View className="flex-1">
              <AppText className="text-2xl text-white">
                {(() => {
                  const hour = new Date().getHours();
                  if (hour < 12) {
                    return "Good Morning 🔥";
                  } else if (hour < 18) {
                    return "Good Afternoon ☀️";
                  } else {
                    return "Good Evening 🌙";
                  }
                })()}
              </AppText>

              {loadingProfile ? (
                <SkeletonLoader width={160} height={30} />
              ) : (
                <AppText className="text-2xl font-bold text-white">
                  {userProfile?.displayName || "User"}
                </AppText>
              )}
            </View>

            {loadingProfile ? (
              <SkeletonLoader width={60} height={60} />
            ) : userProfile?.profileImageUrl ? (
              <TouchableOpacity onPress={() => router.push("/(app)/settings")}>
                <Image
                  source={{ uri: userProfile.profileImageUrl }}
                  className="w-16 h-16 rounded-md"
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => router.push("/(app)/settings")}>
                <MaterialCommunityIcons name="account-circle" size={56} color="#C6F806" />
              </TouchableOpacity>
            )}
          </View>

          {/* Quick Actions */}
          <View className="mb-6">
            <AppText className="text-xl color-white font-bold mb-3">Quick Actions</AppText>
            
            <QuickLink
              icon="video-plus"
              title="Upload Video"
              subtitle="Record or upload a workout video"
              color="#C6F806"
              onPress={() => router.push('/(app)/create')}
            />
            
            <QuickLink
              icon="dumbbell"
              title="Start Workout"
              subtitle="Track your fitness progress"
              color="#3b82f6"
              onPress={() => router.push('/(app)/workout')}
            />
            
            <QuickLink
              icon="eye"
              title="Vision Analysis"
              subtitle="AI-powered pose detection"
              color="#8b5cf6"
              onPress={() => router.push('/(app)/vision-ondevice')}
            />
            
            <QuickLink
              icon="cog"
              title="Settings"
              subtitle="Manage your profile and preferences"
              color="#6b7280"
              onPress={() => router.push('/(app)/settings')}
            />
          </View>

          {/* Recent Videos Section */}
          <View className="mb-6">
            <View className="flex-row justify-between items-center mb-3">
              <AppText className="text-xl color-white font-bold">Your Videos</AppText>
              {userVideos.length > 0 && (
                <TouchableOpacity onPress={() => router.push('/(app)/create')}>
                  <AppText className="color-lime-500 text-sm">View All</AppText>
                </TouchableOpacity>
              )}
            </View>

            {loadingVideos ? (
              <View className="flex-row">
                <View className="mr-3">
                  <SkeletonLoader width={192} height={200} />
                </View>
                <View className="mr-3">
                  <SkeletonLoader width={192} height={200} />
                </View>
              </View>
            ) : recentVideos.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 24 }}
              >
                {recentVideos.map((video, index) => (
                  <VideoCard key={video.id || index} video={video} />
                ))}
              </ScrollView>
            ) : (
              <TouchableOpacity
                onPress={() => router.push('/(app)/create')}
                className="bg-neutral-800 rounded-xl p-6 items-center border-2 border-dashed border-neutral-700"
              >
                <MaterialCommunityIcons name="video-off" size={48} color="#6b7280" />
                <AppText className="color-gray-400 text-center mt-3">
                  No videos yet
                </AppText>
                <AppText className="color-lime-500 text-sm mt-2">
                  Tap to upload your first video
                </AppText>
              </TouchableOpacity>
            )}
          </View>

          {/* Stats Card
          {userProfile && !loadingProfile && (
            <View className="bg-gradient-to-r from-lime-500 to-lime-600 rounded-xl p-6 mb-6">
              <AppText className="text-black font-bold text-lg mb-4">Your Stats</AppText>
              <View className="flex-row justify-around">
                <View className="items-center">
                  <AppText className="text-black text-2xl font-bold">{userVideos.length}</AppText>
                  <AppText className="text-black text-xs">Videos</AppText>
                </View>
                <View className="items-center">
                  <AppText className="text-black text-2xl font-bold">{userProfile.height}</AppText>
                  <AppText className="text-black text-xs">Height (cm)</AppText>
                </View>
                <View className="items-center">
                  <AppText className="text-black text-2xl font-bold">{userProfile.weight}</AppText>
                  <AppText className="text-black text-xs">Weight (kg)</AppText>
                </View>
              </View>
            </View>
          )} */}
        </View>
      </ScrollView>
    </View>
  );
}
