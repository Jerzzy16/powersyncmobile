// hooks/MediaHooks.ts
import auth from '@react-native-firebase/auth';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { useState } from "react";
import { useNotification } from '../contexts/NotificationContext';

export interface VideoUpload {
  id?: string;
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  userId: string;
  createdAt: FirebaseFirestoreTypes.Timestamp | Date; // Support both Timestamp and Date
  updatedAt?: FirebaseFirestoreTypes.Timestamp | Date;
}

export const useMediaUpload = () => {
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [userVideos, setUserVideos] = useState<VideoUpload[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const { showNotification } = useNotification();

  const CLOUDINARY_CLOUD_NAME = 'drf4qnjow';
  const CLOUDINARY_UPLOAD_PRESET = 'workout';

  const uploadVideoToCloudinary = async (videoUri: string, title: string): Promise<{ videoUrl: string; thumbnailUrl: string; duration: number }> => {
    try {
      if (__DEV__) {
        console.log('[MediaHooks] Starting Cloudinary upload:', videoUri);
      }
      setUploadProgress(10);

      const formData = new FormData();
      formData.append('file', {
        uri: videoUri,
        type: 'video/mp4',
        name: `${title.replace(/\s+/g, '_')}_${Date.now()}.mp4`,
      } as any);
      
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      formData.append('folder', 'workout_videos');

      if (__DEV__) {
        console.log('[MediaHooks] Uploading to Cloudinary unsigned preset:', CLOUDINARY_UPLOAD_PRESET);
      }

      setUploadProgress(30);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
        {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      setUploadProgress(80);

      const responseText = await response.text();
      
      if (__DEV__) {
        console.log('[MediaHooks] Response status:', response.status);
        console.log('[MediaHooks] Response text:', responseText.substring(0, 200));
      }

      if (!response.ok) {
        let errorMessage = `Upload failed with status ${response.status}`;
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error?.message || errorMessage;
        } catch (e) {
          if (responseText.includes('<')) {
            errorMessage = 'Upload preset not found or not configured as unsigned. Please check your Cloudinary console.';
          }
        }
        throw new Error(errorMessage);
      }

      const data = JSON.parse(responseText);
      
      if (data.secure_url) {
        const thumbnailUrl = data.secure_url.replace(
          '/video/upload/',
          '/video/upload/so_0,w_400,h_300,c_fill,q_auto:good/'
        );
        
        setUploadProgress(100);

        if (__DEV__) {
          console.log('[MediaHooks] ✅ Video upload complete!');
          console.log('[MediaHooks] Video URL:', data.secure_url);
        }
        
        return {
          videoUrl: data.secure_url,
          thumbnailUrl: thumbnailUrl,
          duration: data.duration || 0
        };
      } else {
        throw new Error('Video upload failed - no URL returned');
      }
    } catch (error: any) {
      if (__DEV__) {
        console.error("[MediaHooks] Error uploading video:", error);
      }
      throw new Error(error.message || 'Failed to upload video');
    }
  };

  const recordVideo = async (): Promise<string | null> => {
    try {
      // Request camera permissions (microphone is bundled with camera permission in expo-image-picker)
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      
      if (cameraPermission.granted === false) {
        if (__DEV__) {
          console.warn('[MediaHooks] Camera permission denied');
        }
        showNotification("Camera permission is required to record videos", "error");
        return null;
      }

      // Launch camera for video recording
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 0.8, // Good quality for uploads
        videoMaxDuration: 300, // 5 minutes max
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        return result.assets[0].uri;
      }

      return null;
    } catch (error) {
      if (__DEV__) {
        console.error("Error recording video:", error);
      }
      showNotification("Failed to record video", "error");
      return null;
    }
  };

  const pickVideo = async (): Promise<string | null> => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (permissionResult.granted === false) {
        showNotification("Permission to access media library is required", "error");
        return null;
      }

      // Launch video picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 300, // 5 minutes max
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        return result.assets[0].uri;
      }

      return null;
    } catch (error) {
      if (__DEV__) {
        console.error("Error picking video:", error);
      }
      showNotification("Failed to pick video", "error");
      return null;
    }
  };

  const uploadVideo = async (videoUri: string, title: string, description?: string) => {
    setLoading(true);
    setUploadProgress(0);

    try {
      const user = auth().currentUser;
      if (!user) {
        if (__DEV__) {
          console.error("[useMediaUpload] No authenticated user for video upload");
        }
        throw new Error("No authenticated user found");
      }

      if (__DEV__) {
        console.log("[useMediaUpload] Starting video upload:", { title, userId: user.uid });
      }

      // Upload video to Cloudinary
      const { videoUrl, thumbnailUrl, duration } = await uploadVideoToCloudinary(videoUri, title);
      
      setUploadProgress(85);

      // Save video metadata to Firestore
      // CRITICAL FIX: Use serverTimestamp() instead of new Date() for proper Firestore serialization
      // JavaScript Date objects don't serialize correctly and break orderBy queries
      const videoData = {
        title: title.trim(),
        description: description?.trim() || '',
        videoUrl,
        thumbnailUrl,
        duration,
        userId: user.uid,
        createdAt: firestore.FieldValue.serverTimestamp(), // Server-side timestamp
      };

      const docRef = await firestore().collection('videos').add(videoData);
      
      setUploadProgress(100);
      
      if (__DEV__) {
        console.log("[useMediaUpload] ✅ Video uploaded successfully!");
        console.log("[useMediaUpload] Document ID:", docRef.id);
        console.log("[useMediaUpload] Video URL:", videoUrl);
        console.log("[useMediaUpload] User ID:", user.uid);
      }
      
      showNotification("Video uploaded successfully!", "success");
      
    } catch (error: any) {
      if (__DEV__) {
        console.error("[useMediaUpload] Video upload error:", error);
      }
      showNotification(error.message || "Failed to upload video", "error");
      throw error;
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const loadUserVideos = () => {
    const user = auth().currentUser;
    if (!user) {
      if (__DEV__) {
        console.warn("[useMediaUpload] No authenticated user, cannot load videos");
      }
      return;
    }

    setLoadingVideos(true);

    if (__DEV__) {
      console.log("[useMediaUpload] Loading videos for user:", user.uid);
    }

    // FIRESTORE INDEX REQUIRED:
    // If you get "The query requires an index" error, Firebase will provide a link
    // Click the link or manually create composite index: Collection: videos, Fields: userId (Ascending), createdAt (Descending)
    // 
    // Implement rate limiting: limit to 10 most recent videos to avoid excessive reads
    const videosQuery = firestore().collection('videos')
      .where('userId', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(10); // Rate limiting: only fetch 10 most recent

    // MEMORY LEAK FIX: Properly return unsubscribe function
    const unsubscribe = videosQuery.onSnapshot((snapshot: any) => {
      const videos: VideoUpload[] = [];
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        videos.push({
          id: doc.id,
          ...data,
          // Convert Firestore Timestamp to Date for display if needed
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        } as VideoUpload);
      });
      
      if (__DEV__) {
        console.log("[useMediaUpload] Loaded videos:", videos.length);
        if (videos.length > 0) {
          console.log("[useMediaUpload] First video:", {
            id: videos[0].id,
            title: videos[0].title,
            createdAt: videos[0].createdAt
          });
        }
      }
      
      setUserVideos(videos);
      setLoadingVideos(false);
    }, (error: any) => {
      if (__DEV__) {
        console.error("[useMediaUpload] Error loading videos:", error);
        console.error("[useMediaUpload] Error code:", error.code);
        console.error("[useMediaUpload] Error message:", error.message);
      }
      
      // Check for index error
      if (error.code === 'failed-precondition' || error.message?.includes('index')) {
        showNotification("Database setup required - check console for index link", "error", 5000);
      } else {
        showNotification("Failed to load videos. Please try again.", "error");
      }
      
      setLoadingVideos(false);
    });

    return unsubscribe;
  };

  const deleteVideo = async (videoId: string) => {
    try {
      const user = auth().currentUser;
      if (!user) {
        if (__DEV__) {
          console.error('[MediaHooks] No authenticated user for video deletion');
        }
        throw new Error("No authenticated user found");
      }

      if (__DEV__) {
        console.log('[MediaHooks] Deleting video:', videoId);
      }

      await firestore().collection('videos').doc(videoId).delete();
      showNotification("Video deleted successfully!", "success");
      
      if (__DEV__) {
        console.log('[MediaHooks] Video deleted successfully');
      }
    } catch (error: any) {
      if (__DEV__) {
        console.error('[MediaHooks] Error deleting video:', error);
      }
      showNotification(error.message || "Failed to delete video", "error");
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    // Upload functions
    uploadVideo,
    recordVideo,
    pickVideo,
    
    // State
    loading,
    uploadProgress,
    
    // Video management
    userVideos,
    loadingVideos,
    loadUserVideos,
    deleteVideo,
    
    // Utilities
    formatDuration,
  };
};

// Default export for easier importing
export default useMediaUpload;