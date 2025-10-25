// hooks/ProfileHooks.ts
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { useState } from "react";
import { Alert } from "react-native";

export interface UpdateProfileData {
  displayName: string;
  age: string;
  height: string;
  weight: string;
  profileImage?: string; // base64 or local URI
}

export const useProfileUpdate = () => {
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Cloudinary configuration - Replace with your actual values
  const CLOUDINARY_CLOUD_NAME = 'drf4qnjow'; // Replace with your cloud name
  const CLOUDINARY_UPLOAD_PRESET = 'profile_images'; // Replace with your upload preset

  const uploadToCloudinary = async (imageUri: string): Promise<string> => {
    try {
      setUploadProgress(25);
      
      // Create FormData for upload
      const formData = new FormData();
      formData.append('file', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'profile-image.jpg',
      } as any);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      formData.append('cloud_name', CLOUDINARY_CLOUD_NAME);
      
      setUploadProgress(50);

      // Upload to Cloudinary
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      setUploadProgress(75);

      const data = await response.json();
      
      if (response.ok) {
        return data.secure_url; // This is the URL to store in your database
      } else {
        throw new Error(data.error?.message || 'Upload failed');
      }
    } catch (error) {
      if (__DEV__) {
        console.error("Error uploading to Cloudinary:", error);
      }
      throw new Error("Failed to upload profile image");
    }
  };

  const updateUserProfile = async (data: UpdateProfileData, profileImageUri?: string) => {
    setLoading(true);
    setUploadProgress(0);

    try {
      const user = auth().currentUser;
      if (!user) {
        if (__DEV__) {
          console.error("[useProfileUpdate] No authenticated user for profile update");
        }
        throw new Error("No authenticated user found");
      }

      if (__DEV__) {
        console.log("[useProfileUpdate] Starting profile update for user:", user.uid);
      }

      let profileImageUrl: string | undefined;

      // Handle profile image upload to Cloudinary
      if (profileImageUri) {
        if (__DEV__) {
          console.log("[useProfileUpdate] Uploading profile image to Cloudinary");
        }
        profileImageUrl = await uploadToCloudinary(profileImageUri);
      }

      setUploadProgress(85);

      // Update Firebase Auth profile
      await user.updateProfile({
        displayName: data.displayName,
        ...(profileImageUrl && { photoURL: profileImageUrl })
      });

      if (__DEV__) {
        console.log("[useProfileUpdate] Firebase Auth profile updated");
      }

      setUploadProgress(95);

      // Update Firestore document
      const userDocRef = firestore().collection('users').doc(user.uid);
      const updateData: any = {
        displayName: data.displayName,
        age: parseInt(data.age),
        height: parseFloat(data.height),
        weight: parseFloat(data.weight),
        updatedAt: new Date(),
      };

      if (profileImageUrl) {
        updateData.profileImageUrl = profileImageUrl;
      }

      await userDocRef.update(updateData);
      
      setUploadProgress(100);
      
      if (__DEV__) {
        console.log("[useProfileUpdate] Profile updated successfully");
      }
      
      Alert.alert("Success", "Profile updated successfully!");
      
    } catch (error: any) {
      if (__DEV__) {
        console.error("[useProfileUpdate] Profile update error:", error);
      }
      Alert.alert("Error", error.message || "Failed to update profile");
      throw error;
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const pickImage = async (): Promise<string | null> => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (permissionResult.granted === false) {
        Alert.alert("Permission Required", "Permission to access camera roll is required!");
        return null;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio for profile pictures
        quality: 0.8, // Good quality for Cloudinary
        base64: false, // We don't need base64 for Cloudinary
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        return result.assets[0].uri;
      }

      return null;
    } catch (error) {
      if (__DEV__) {
        console.error("Error picking image:", error);
      }
      Alert.alert("Error", "Failed to pick image");
      return null;
    }
  };

  const takePhoto = async (): Promise<string | null> => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (permissionResult.granted === false) {
        Alert.alert("Permission Required", "Permission to access camera is required!");
        return null;
      }

      // Launch camera
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        return result.assets[0].uri;
      }

      return null;
    } catch (error) {
      if (__DEV__) {
        console.error("Error taking photo:", error);
      }
      Alert.alert("Error", "Failed to take photo");
      return null;
    }
  };

  return {
    updateUserProfile,
    pickImage,
    takePhoto,
    loading,
    uploadProgress,
  };
};

// Default export for easier importing
export default useProfileUpdate;