# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# @generated begin expo-build-properties - expo prebuild (DO NOT MODIFY)
-keep public class com.horcrux.svg.** { *; }
-keep class com.mrousavy.camera.** { *; }
-keep class com.mrousavy.camera.frameprocessor.** { *; }
-keep class com.margelo.nitro.** { *; }
-keep class com.margelo.worklets.** { *; }
-keep class org.tensorflow.lite.** { *; }
-keep class org.tensorflow.lite.gpu.** { *; }
-keep class org.tensorflow.lite.gpu.GpuDelegate { *; }
-keep class org.tensorflow.lite.gpu.GpuDelegateFactory { *; }
-keep class org.tensorflow.lite.gpu.GpuDelegateFactory$Options { *; }
-keep class org.tensorflow.lite.gpu.GpuDelegateFactory$Options$GpuBackend { *; }
-keep class org.tensorflow.lite.Interpreter { *; }
-keep class org.tensorflow.lite.Interpreter$Options { *; }
-keep class org.tensorflow.lite.Tensor { *; }
-keep class org.tensorflow.lite.NativeInterpreterWrapper { *; }
-keep class org.tensorflow.lite.NativeInterpreterWrapperExperimental { *; }
-keep @org.tensorflow.lite.annotations.UsedByReflection class * { *; }
-keepclassmembers class * {
  @org.tensorflow.lite.annotations.UsedByReflection *;
}
-dontwarn org.tensorflow.lite.**
-dontnote org.tensorflow.lite.**
-dontwarn com.mrousavy.camera.**
-dontwarn com.margelo.worklets.**
-keep class com.swmansion.** { *; }
# @generated end expo-build-properties