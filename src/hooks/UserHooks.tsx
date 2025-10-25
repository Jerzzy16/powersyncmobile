// hooks/UserHooks.ts
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { useEffect, useRef, useState } from "react";
import type { UserProfile } from "../types/UserProfile";

export const useUserProfile = () => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    
    const fetchUserProfile = async () => {
      try {
        setLoadingProfile(true);
        setError(null);
        
        const user = auth().currentUser;
        if (!user) {
          if (__DEV__) {
            console.log("[useUserProfile] No user is signed in");
          }
          setLoadingProfile(false);
          return;
        }

        if (__DEV__) {
          console.log("[useUserProfile] Fetching profile for user:", user.uid);
        }

        const userDocRef = firestore().collection('users').doc(user.uid);
        
        unsubscribeRef.current = userDocRef.onSnapshot(
          (docSnapshot) => {
            if (!mountedRef.current) return;
            
            if (docSnapshot.exists) {
              const profileData = docSnapshot.data() as UserProfile;
              setUserProfile(profileData);
              
              if (__DEV__) {
                console.log("[useUserProfile] Profile loaded:", {
                  uid: profileData.uid,
                  height: profileData.height,
                  weight: profileData.weight
                });
              }
            } else {
              if (__DEV__) {
                console.warn("[useUserProfile] User profile document does not exist");
              }
              setError("User profile not found");
            }
            setLoadingProfile(false);
          },
          (err) => {
            if (!mountedRef.current) return;
            
            if (__DEV__) {
              console.error("[useUserProfile] Error fetching user profile:", err);
            }
            setError(err.message || "Failed to fetch user profile");
            setLoadingProfile(false);
          }
        );
        
      } catch (error: any) {
        if (!mountedRef.current) return;
        
        if (__DEV__) {
          console.error("[useUserProfile] Unexpected error:", error);
        }
        setError(error.message || "An unexpected error occurred");
        setLoadingProfile(false);
      }
    };
    
    fetchUserProfile();
    
    // Cleanup function
    return () => {
      mountedRef.current = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        if (__DEV__) {
          console.log("[useUserProfile] Unsubscribed from profile updates");
        }
      }
    };
  }, []);
  
  return { userProfile, loadingProfile, error };
};

// Default export for easier importing
export default useUserProfile;
