import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Canvas, Circle, Line, Text as SkiaText, useFont } from '@shopify/react-native-skia';
import * as MediaLibrary from 'expo-media-library';
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StatusBar, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { Camera, useCameraDevice, useCameraFormat, useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { CPU_THREADS, delegate, INPUT_HEIGHT, INPUT_WIDTH } from '../../core/constants';
import { useMediaUpload } from '../../hooks/MediaHooks';
import { useUserProfile } from '../../hooks/UserHooks';

const SKELETON_CONNECTIONS = [
    [5, 7], [7, 9],
    [6, 8], [8, 10],
    [5, 6],
    [5, 11], [6, 12],
    [11, 12],
    [11, 13], [13, 15],
    [12, 14], [14, 16],
];

const DETECTION_THRESHOLD = 0.3;
const VISUALIZATION_THRESHOLD = 0.1;
const CONNECTION_THRESHOLD = 0.1;
const HIGH_CONFIDENCE = 0.7;
const MIN_CONFIDENCE = DETECTION_THRESHOLD;
const CAMERA_FPS = 30;
const FRAME_SKIP_INTERVAL = 2;
const MIN_CUTOFF = 0.15;
const BETA = 0.007;
const DERIVATE_CUTOFF = 1.0;
const CROP_KEYPOINT_SCORE_THRESHOLD = 0.2;
const TORSO_EXPANSION_RATIO = 1.9;
const BODY_EXPANSION_RATIO = 1.2;
const OKS_KEYPOINT_THRESHOLD = 0.3;
const OKS_KEYPOINT_FALLOFF = [
    0.026, 0.025, 0.025, 0.035, 0.035, 0.079, 0.079, 0.072, 0.072, 0.062,
    0.062, 0.107, 0.107, 0.087, 0.087, 0.089, 0.089
];
const OKS_MIN_KEYPOINTS = 4;
const TRACKING_MIN_SIMILARITY = 0.15;
const TRACKING_MAX_AGE = 1000;
const TRACKING_MAX_PERSONS = 18;

interface TrackedPerson {
    id: number;
    lastSeen: number;
    keypoints: Array<{ x: number; y: number; score: number }>;
}


function oneEuroFilter(
    value: number,
    lastValue: number,
    lastDValue: number,
    alpha: number,
    dAlpha: number
): { filtered: number; dValue: number } {
    'worklet';
    
    const dValue = (value - lastValue);
    const smoothedDValue = dAlpha * dValue + (1 - dAlpha) * lastDValue;
    
    const filtered = alpha * value + (1 - alpha) * lastValue;
    
    return { filtered, dValue: smoothedDValue };
}

function smoothingFactor(cutoff: number, fps: number): number {
    'worklet';
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / fps;
    return 1.0 / (1.0 + tau / te);
}

function smoothKeypoints(
    keypoints: Int8Array | Uint8Array | Float32Array | Float64Array,
    lastKeypoints: { [key: string]: { 
        x: number; 
        y: number; 
        score: number;
        dx: number; // velocity in x
        dy: number; // velocity in y
    } },
    screenWidth: number,
    screenHeight: number
): Float32Array {
    'worklet';
    
    if (!keypoints || keypoints.length < 51) {
        return new Float32Array(51);
    }
    
    if (typeof screenWidth !== 'number' || typeof screenHeight !== 'number') {
        return new Float32Array(keypoints);
    }
    
    if (screenWidth <= 0 || screenHeight <= 0) {
        return new Float32Array(keypoints);
    }
    
    const smoothedKeypoints = new Float32Array(keypoints.length);
    const fps = CAMERA_FPS / FRAME_SKIP_INTERVAL;
    
    const MOVEMENT_THRESHOLD = screenWidth * 0.01;

    for (let i = 0; i < 17; i++) {
        const baseIndex = i * 3;
        
        if (baseIndex + 2 >= keypoints.length) {
            continue;
        }
        
        const key = `kp_${i}`;
        const rawX = keypoints[baseIndex + 1] * screenWidth;
        const rawY = keypoints[baseIndex] * screenHeight;
        const rawScore = keypoints[baseIndex + 2];

        let smoothedX = rawX;
        let smoothedY = rawY;
        let smoothedScore = rawScore;
        let dx = 0;
        let dy = 0;

        const last = lastKeypoints[key];
        if (last && rawScore > DETECTION_THRESHOLD) {
            const deltaX = Math.abs(rawX - last.x);
            const deltaY = Math.abs(rawY - last.y);
            
            if (deltaX < MOVEMENT_THRESHOLD && deltaY < MOVEMENT_THRESHOLD) {
                // Use cached values - no filtering needed
                smoothedX = last.x;
                smoothedY = last.y;
                smoothedScore = last.score;
                dx = last.dx;
                dy = last.dy;
            } else {
                // Calculate velocity magnitude for adaptive smoothing
                const vx = rawX - last.x;
                const vy = rawY - last.y;
                const speed = Math.sqrt(vx * vx + vy * vy);
                
                // Adaptive cutoff: higher cutoff (less smoothing) for fast movements
                const adaptiveCutoff = MIN_CUTOFF + BETA * speed;
                
                // Calculate alpha for position and derivative
                const alpha = smoothingFactor(adaptiveCutoff, fps);
                const dAlpha = smoothingFactor(DERIVATE_CUTOFF, fps);
                
                // Apply One Euro Filter to X coordinate
                const resultX = oneEuroFilter(rawX, last.x, last.dx, alpha, dAlpha);
                smoothedX = resultX.filtered;
                dx = resultX.dValue;
                
                // Apply One Euro Filter to Y coordinate
                const resultY = oneEuroFilter(rawY, last.y, last.dy, alpha, dAlpha);
                smoothedY = resultY.filtered;
                dy = resultY.dValue;
                
                // Smooth confidence score with EMA (simpler approach for scores)
                smoothedScore = 0.7 * rawScore + 0.3 * last.score;
            }
        }

        // Store smoothed values and velocities for next frame
        lastKeypoints[key] = { 
            x: smoothedX, 
            y: smoothedY, 
            score: smoothedScore,
            dx,
            dy
        };

        // Convert back to normalized coordinates with bounds checking
        if (baseIndex + 2 < smoothedKeypoints.length) {
            smoothedKeypoints[baseIndex] = smoothedY / screenHeight;
            smoothedKeypoints[baseIndex + 1] = smoothedX / screenWidth;
            smoothedKeypoints[baseIndex + 2] = smoothedScore;
        }
    }

    return smoothedKeypoints;
}

function analyzeLiftForm(
    keypoints: Int8Array | Uint8Array | Float32Array | Float64Array, 
    liftType: string | string[] | undefined,
    screenWidth: number,
    screenHeight: number,
    userHeight?: number,
    userWeight?: number
) {
    'worklet';
    
    const feedback: string[] = [];
    let formScore = 100;

    if (!liftType || Array.isArray(liftType)) {
        console.log('[VisionOnDevice] Form analysis: No lift type selected');
        return { feedback: ['⚠️ Select a lift type'], formScore: 0, liftType: 'unknown' };
    }

    console.log('[VisionOnDevice] Form analysis started for: ' + liftType);

    const getPoint = (index: number) => ({
        x: keypoints[index * 3 + 1] * screenWidth,  
        y: keypoints[index * 3] * screenHeight,     
        score: keypoints[index * 3 + 2]
    });

    const calculateAngle = (
        p1: {x: number, y: number}, 
        p2: {x: number, y: number}, 
        p3: {x: number, y: number}
    ): number | null => {
        'worklet';

        if (isNaN(p1.x) || isNaN(p1.y) || isNaN(p2.x) || isNaN(p2.y) || isNaN(p3.x) || isNaN(p3.y)) {
            if (__DEV__) {
                console.warn('[VisionOnDevice] Invalid angle calculation - NaN detected');
            }
            return null;
        }

        const dist12 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        const dist23 = Math.sqrt((p3.x - p2.x) ** 2 + (p3.y - p2.y) ** 2);
        
        if (dist12 < 1 || dist23 < 1) { 
            if (__DEV__) {
                console.warn('[VisionOnDevice] Points too close for angle calculation');
            }
            return null;
        }
        
        const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
        let angle = Math.abs(radians * 180 / Math.PI);
        if (angle > 180) angle = 360 - angle;
        return angle;
    };

    const calculateDistance = (p1: {x: number, y: number}, p2: {x: number, y: number}): number | null => {
        'worklet';
        
        if (isNaN(p1.x) || isNaN(p1.y) || isNaN(p2.x) || isNaN(p2.y)) {
            if (__DEV__) {
                console.warn('[VisionOnDevice] Invalid distance calculation - NaN detected');
            }
            return null;
        }
        
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    };

    const getBilateralPoint = (
        leftPoint: {x: number, y: number, score: number},
        rightPoint: {x: number, y: number, score: number}
    ): {x: number, y: number, score: number, side: 'left'|'right'|'avg'|'none'} => {
        'worklet';
        
        // Use DETECTION_THRESHOLD for bilateral point selection
        const leftOk = leftPoint.score > DETECTION_THRESHOLD;
        const rightOk = rightPoint.score > DETECTION_THRESHOLD;
        
        if (leftOk && rightOk) {
            
            const totalScore = leftPoint.score + rightPoint.score;
            return {
                x: (leftPoint.x * leftPoint.score + rightPoint.x * rightPoint.score) / totalScore,
                y: (leftPoint.y * leftPoint.score + rightPoint.y * rightPoint.score) / totalScore,
                score: Math.max(leftPoint.score, rightPoint.score),
                side: 'avg'
            };
        } else if (leftOk) {
            return { ...leftPoint, side: 'left' };
        } else if (rightOk) {
            return { ...rightPoint, side: 'right' };
        } else {
            return { x: 0, y: 0, score: 0, side: 'none' };
        }
    };
    
    const nose = getPoint(0);
    const leftShoulder = getPoint(5);
    const rightShoulder = getPoint(6);
    const leftElbow = getPoint(7);
    const rightElbow = getPoint(8);
    const leftWrist = getPoint(9);
    const rightWrist = getPoint(10);
    const leftHip = getPoint(11);
    const rightHip = getPoint(12);
    const leftKnee = getPoint(13);
    const rightKnee = getPoint(14);
    const leftAnkle = getPoint(15);
    const rightAnkle = getPoint(16);

    const shoulder = getBilateralPoint(leftShoulder, rightShoulder);
    const hip = getBilateralPoint(leftHip, rightHip);
    const knee = getBilateralPoint(leftKnee, rightKnee);
    const ankle = getBilateralPoint(leftAnkle, rightAnkle);

    if (liftType.toLowerCase() === 'squat') {
        console.log('[VisionOnDevice] SQUAT analysis: hip.side=' + hip.side + ', knee.side=' + knee.side + ', ankle.side=' + ankle.side + ', shoulder.side=' + shoulder.side);
        
        if (hip.side !== 'none' && knee.side !== 'none' && 
            ankle.side !== 'none' && shoulder.side !== 'none') {

            const hipToKneeDistance = calculateDistance(hip, knee);
            const shoulderToHipDistance = calculateDistance(shoulder, hip);
            
            if (hipToKneeDistance !== null && shoulderToHipDistance !== null) {
                
                const depthRatio = hip.y - knee.y; 
                const torsoLength = Math.abs(shoulder.y - hip.y);

                const heightAdjustment = userHeight && userHeight > 0 ? (userHeight / 170) : 1.0;
                const depthThreshold = torsoLength * 0.1 * heightAdjustment;

                console.log('[VisionOnDevice] SQUAT depth: depthRatio=' + depthRatio + ', threshold=' + depthThreshold + ', torsoLength=' + torsoLength);

                if (depthRatio < -depthThreshold) { 
                    feedback.push(userHeight ? '✅ Excellent depth (' + userHeight + 'cm calibrated)' : '✅ Excellent depth - below parallel');
                    formScore += 0;
                } else if (depthRatio < depthThreshold * 0.5) {
                    feedback.push('⚠️ At parallel - try slightly deeper');
                    formScore -= 5;
                } else {
                    feedback.push('❌ Too shallow - squat deeper');
                    formScore -= 20;
                }
            }

            if (leftKnee.score > DETECTION_THRESHOLD && rightKnee.score > DETECTION_THRESHOLD &&
                leftAnkle.score > DETECTION_THRESHOLD && rightAnkle.score > DETECTION_THRESHOLD) {
                
                const kneeWidth = Math.abs(leftKnee.x - rightKnee.x);
                const ankleWidth = Math.abs(leftAnkle.x - rightAnkle.x);
                
                console.log('[VisionOnDevice] SQUAT knees: kneeWidth=' + kneeWidth + ', ankleWidth=' + ankleWidth);
                
                if (kneeWidth < ankleWidth * 0.75) {
                    feedback.push('❌ Knees caving in - push knees out');
                    formScore -= 15;
                } else if (kneeWidth < ankleWidth * 0.9) {
                    feedback.push('⚠️ Watch knee tracking');
                    formScore -= 5;
                } else {
                    feedback.push('✅ Good knee tracking');
                }
            }

            const hipAngle = calculateAngle(shoulder, hip, knee);
            console.log('[VisionOnDevice] SQUAT hipAngle=' + hipAngle);
            if (hipAngle !== null) {
                if (hipAngle < 50) {
                    feedback.push('❌ Chest up! Torso too horizontal');
                    formScore -= 15;
                } else if (hipAngle < 70) {
                    feedback.push('⚠️ Keep chest more upright');
                    formScore -= 5;
                } else {
                    feedback.push('✅ Good torso position');
                }
            }

            const kneeAngle = calculateAngle(hip, knee, ankle);
            console.log('[VisionOnDevice] SQUAT kneeAngle=' + kneeAngle);
            if (kneeAngle !== null) {
                if (kneeAngle < 60) {
                    feedback.push('⚠️ Very deep squat - check mobility');
                } else if (kneeAngle < 90) {
                    feedback.push('✅ Good squat depth');
                } else {
                    feedback.push('⚠️ Squat deeper for full ROM');
                    formScore -= 10;
                }
            }
            
        } else {
            console.log('[VisionOnDevice] SQUAT missing body parts');
            feedback.push('⚠️ Position yourself to show full body');
            formScore -= 30;
        }
    }

    else if (liftType.toLowerCase() === 'bench') {
        const elbow = getBilateralPoint(leftElbow, rightElbow);
        const wrist = getBilateralPoint(leftWrist, rightWrist);
        
        console.log('[VisionOnDevice] BENCH analysis: shoulder.side=' + shoulder.side + ', elbow=' + elbow.side + ', wrist=' + wrist.side);
        
        if (shoulder.side !== 'none' && elbow.side !== 'none' && wrist.side !== 'none') {

            const elbowAngle = calculateAngle(shoulder, elbow, wrist);
            console.log('[VisionOnDevice] BENCH elbowAngle=' + elbowAngle);
            if (elbowAngle !== null) {
                if (elbowAngle < 60) {
                    feedback.push('❌ Elbows too flared - tuck them');
                    formScore -= 15;
                } else if (elbowAngle > 95) {
                    feedback.push('⚠️ Elbows could tuck more (75-90°)');
                    formScore -= 5;
                } else {
                    feedback.push('✅ Good elbow angle');
                }
            }

            const barPathDeviation = calculateDistance({x: wrist.x, y: 0}, {x: shoulder.x, y: 0});
            
            if (barPathDeviation !== null) {
                
                const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
                const deviationRatio = barPathDeviation / Math.max(shoulderWidth, 1);
                
                console.log('[VisionOnDevice] BENCH barPath: deviation=' + barPathDeviation + ', ratio=' + deviationRatio);
                
                if (deviationRatio > 0.3) {
                    feedback.push('❌ Bar path not vertical');
                    formScore -= 15;
                } else if (deviationRatio > 0.15) {
                    feedback.push('⚠️ Keep bar path straight');
                    formScore -= 5;
                } else {
                    feedback.push('✅ Excellent bar path');
                }
            }

            const wristElbowDistance = calculateDistance(wrist, elbow);
            if (wristElbowDistance !== null) {
                const forearmLength = wristElbowDistance;
                const elbowShoulderDistance = calculateDistance(elbow, shoulder);
                
                if (elbowShoulderDistance !== null) {
                    const wristBendRatio = wristElbowDistance / elbowShoulderDistance;
                    console.log('[VisionOnDevice] BENCH wristBend=' + wristBendRatio);
                    if (wristBendRatio < 0.3) {
                        feedback.push('⚠️ Wrists bent - keep neutral');
                        formScore -= 10;
                    }
                }
            }

            if (leftElbow.score > MIN_CONFIDENCE && rightElbow.score > MIN_CONFIDENCE &&
                leftWrist.score > MIN_CONFIDENCE && rightWrist.score > MIN_CONFIDENCE) {
                
                const leftArmAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
                const rightArmAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);
                
                if (leftArmAngle !== null && rightArmAngle !== null) {
                    const asymmetry = Math.abs(leftArmAngle - rightArmAngle);
                    console.log('[VisionOnDevice] BENCH asymmetry=' + asymmetry);
                    if (asymmetry > 15) {
                        feedback.push('⚠️ Uneven arms - check form');
                        formScore -= 10;
                    } else {
                        feedback.push('✅ Symmetric arm movement');
                    }
                }
            }
            
        } else {
            console.log('[VisionOnDevice] BENCH missing body parts');
            feedback.push('⚠️ Position camera to show upper body');
            formScore -= 30;
        }
    }

    else if (liftType.toLowerCase() === 'deadlift') {
        console.log('[VisionOnDevice] DEADLIFT analysis: hip.side=' + hip.side + ', shoulder.side=' + shoulder.side + ', knee.side=' + knee.side + ', ankle.side=' + ankle.side);
        
        if (hip.side !== 'none' && shoulder.side !== 'none' && 
            knee.side !== 'none' && ankle.side !== 'none') {

            const hipKneeDistance = calculateDistance(hip, knee);
            const shoulderHipDistance = calculateDistance(shoulder, hip);
            
            if (hipKneeDistance !== null && shoulderHipDistance !== null) {
                const hipKneeRatio = hip.y - knee.y; 
                const torsoLength = Math.abs(shoulder.y - hip.y);

                console.log('[VisionOnDevice] DEADLIFT hipKnee: ratio=' + hipKneeRatio + ', torsoLength=' + torsoLength);

                if (hipKneeRatio < -torsoLength * 0.1) {
                    feedback.push('❌ Hips too low - not a squat!');
                    formScore -= 20;
                } else if (hipKneeRatio > torsoLength * 0.3) {
                    feedback.push('⚠️ Hips might be too high');
                    formScore -= 5;
                } else {
                    feedback.push('✅ Good hip position');
                }
            }

            const hipShoulderVertical = Math.abs(shoulder.y - hip.y);
            const hipShoulderHorizontal = Math.abs(shoulder.x - hip.x);
            
            if (hipShoulderVertical > 0 && hipShoulderHorizontal >= 0) {
                const backAngleDegrees = Math.atan2(hipShoulderVertical, hipShoulderHorizontal) * 180 / Math.PI;
                
                console.log('[VisionOnDevice] DEADLIFT backAngle=' + backAngleDegrees);
                
                if (backAngleDegrees < 30) {
                    feedback.push('❌ Back too horizontal - DANGEROUS');
                    formScore -= 25;
                } else if (backAngleDegrees < 40) {
                    feedback.push('⚠️ Lift chest slightly');
                    formScore -= 10;
                } else if (backAngleDegrees > 75) {
                    feedback.push('⚠️ Too vertical - engage hips more');
                    formScore -= 10;
                } else {
                    feedback.push('✅ Good back angle');
                }
            }

            const lockoutAlignment = Math.abs(hip.x - shoulder.x);
            const torsoLength = Math.abs(shoulder.y - hip.y);
            
            console.log('[VisionOnDevice] DEADLIFT lockout: alignment=' + lockoutAlignment + ', torsoLength=' + torsoLength);
            
            if (lockoutAlignment < torsoLength * 0.15 && torsoLength > screenHeight * 0.2) {
                feedback.push('✅ Full lockout achieved!');
            }

            const shoulderKneeX = shoulder.x - knee.x;
            const kneeWidth = Math.abs(leftKnee.x - rightKnee.x);
            
            if (shoulderKneeX < -kneeWidth * 0.5) {
                feedback.push('⚠️ Shoulders behind bar - shift forward');
                formScore -= 10;
            } else {
                feedback.push('✅ Good shoulder position');
            }
            
        } else {
            console.log('[VisionOnDevice] DEADLIFT missing body parts');
            feedback.push('⚠️ Position to show full body from side');
            formScore -= 30;
        }
    }

    formScore = Math.max(0, formScore);
    
    return {
        feedback: feedback.slice(0, 4), 
        formScore,
        liftType
    };
}

/**
 * Compute bounding box area for keypoints (for OKS normalization)
 */
function computeKeypointArea(keypoints: Array<{ x: number; y: number; score: number }>): number {
    'worklet';
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let validCount = 0;

    for (let i = 0; i < keypoints.length; i++) {
        if (keypoints[i].score > OKS_KEYPOINT_THRESHOLD) {
            validCount++;
            minX = Math.min(minX, keypoints[i].x);
            maxX = Math.max(maxX, keypoints[i].x);
            minY = Math.min(minY, keypoints[i].y);
            maxY = Math.max(maxY, keypoints[i].y);
        }
    }

    if (validCount === 0) return 1e-6;

    const width = Math.max(maxX - minX, 1e-6);
    const height = Math.max(maxY - minY, 1e-6);
    return width * height;
}

/**
 * Compute Object Keypoint Similarity (OKS) between two poses
 * Based on COCO evaluation metric: https://cocodataset.org/#keypoints-eval
 */
function computeOKSSimilarity(
    person1Keypoints: Array<{ x: number; y: number; score: number }>,
    person2Keypoints: Array<{ x: number; y: number; score: number }>
): number {
    'worklet';

    if (person1Keypoints.length !== person2Keypoints.length) {
        return 0;
    }

    const area = computeKeypointArea(person2Keypoints) + 1e-6;
    let oksSum = 0;
    let validKeypointCount = 0;

    for (let i = 0; i < person1Keypoints.length; i++) {
        const kp1 = person1Keypoints[i];
        const kp2 = person2Keypoints[i];
        const threshold = OKS_KEYPOINT_THRESHOLD;

        if (kp1.score < threshold || kp2.score < threshold) {
            continue;
        }

        validKeypointCount++;
        const dx = kp1.x - kp2.x;
        const dy = kp1.y - kp2.y;
        const dSquared = dx * dx + dy * dy;
        const sigma = OKS_KEYPOINT_FALLOFF[i] || 0.089;
        const x = 2 * sigma;

        // Gaussian kernel: exp(-d²/(2*a*σ²))
        const similarity = Math.exp(-dSquared / (2 * area * x * x));
        oksSum += similarity;
    }

    if (validKeypointCount < OKS_MIN_KEYPOINTS) {
        return 0;
    }

    return oksSum / validKeypointCount;
}

function computeKeypointAreaJS(keypoints: Array<{ x: number; y: number; score: number }>): number {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < keypoints.length; i++) {
        const kp = keypoints[i];
        if (kp.score >= OKS_KEYPOINT_THRESHOLD) {
            if (kp.x < minX) minX = kp.x;
            if (kp.x > maxX) maxX = kp.x;
            if (kp.y < minY) minY = kp.y;
            if (kp.y > maxY) maxY = kp.y;
        }
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
        return 1;
    }

    const width = maxX - minX;
    const height = maxY - minY;
    return width * height;
}

function computeOKSSimilarityJS(
    person1Keypoints: Array<{ x: number; y: number; score: number }>,
    person2Keypoints: Array<{ x: number; y: number; score: number }>
): number {
    if (person1Keypoints.length !== person2Keypoints.length) {
        return 0;
    }

    const area = computeKeypointAreaJS(person2Keypoints) + 1e-6;
    let oksSum = 0;
    let validKeypointCount = 0;

    for (let i = 0; i < person1Keypoints.length; i++) {
        const kp1 = person1Keypoints[i];
        const kp2 = person2Keypoints[i];
        const threshold = OKS_KEYPOINT_THRESHOLD;

        if (kp1.score < threshold || kp2.score < threshold) {
            continue;
        }

        validKeypointCount++;
        const dx = kp1.x - kp2.x;
        const dy = kp1.y - kp2.y;
        const dSquared = dx * dx + dy * dy;
        const sigma = OKS_KEYPOINT_FALLOFF[i] || 0.089;
        const x = 2 * sigma;

        const similarity = Math.exp(-dSquared / (2 * area * x * x));
        oksSum += similarity;
    }

    if (validKeypointCount < OKS_MIN_KEYPOINTS) {
        return 0;
    }

    return oksSum / validKeypointCount;
}
function calculateBoundingBox(
    keypoints: number[][],
    minScoreThreshold: number
): { xMin: number; xMax: number; yMin: number; yMax: number; width: number; height: number } {
    'worklet';

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let hasValidKeypoints = false;

    for (let i = 0; i < keypoints.length; i++) {
        const score = keypoints[i][2];
        if (score >= minScoreThreshold) {
            hasValidKeypoints = true;
            const x = keypoints[i][0];
            const y = keypoints[i][1];
            xMin = Math.min(xMin, x);
            xMax = Math.max(xMax, x);
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
        }
    }

    if (!hasValidKeypoints) {
        return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, width: 0, height: 0 };
    }

    const width = xMax - xMin;
    const height = yMax - yMin;
    return { xMin, xMax, yMin, yMax, width, height };
}

/**
 * Get torso bounding box for cropping (using shoulders and hips)
 */
function getTorsoBBox(
    keypoints: number[][]
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
    'worklet';

    // Keypoint indices: 5=left shoulder, 6=right shoulder, 11=left hip, 12=right hip
    const leftShoulder = keypoints[5];
    const rightShoulder = keypoints[6];
    const leftHip = keypoints[11];
    const rightHip = keypoints[12];

    const shoulderScore = Math.min(leftShoulder[2], rightShoulder[2]);
    const hipScore = Math.min(leftHip[2], rightHip[2]);

    if (shoulderScore < CROP_KEYPOINT_SCORE_THRESHOLD || hipScore < CROP_KEYPOINT_SCORE_THRESHOLD) {
        return null;
    }

    const torsoXs = [
        leftShoulder[0],
        rightShoulder[0],
        leftHip[0],
        rightHip[0]
    ];
    const torsoYs = [
        leftShoulder[1],
        rightShoulder[1],
        leftHip[1],
        rightHip[1]
    ];

    let xMin = torsoXs[0];
    let xMax = torsoXs[0];
    let yMin = torsoYs[0];
    let yMax = torsoYs[0];

    for (let i = 1; i < torsoXs.length; i++) {
        xMin = Math.min(xMin, torsoXs[i]);
        xMax = Math.max(xMax, torsoXs[i]);
        yMin = Math.min(yMin, torsoYs[i]);
        yMax = Math.max(yMax, torsoYs[i]);
    }

    return { xMin, xMax, yMin, yMax };
}

/**
 * Determine crop region based on keypoints (like TF Lite example)
 */
function determineCropRegion(
    keypoints: number[][],
    frameWidth: number,
    frameHeight: number
): { cropX: number; cropY: number; cropSize: number } {
    'worklet';

    // First try torso-based crop
    const torsoBBox = getTorsoBBox(keypoints);
    
    let cropRegion: { xMin: number; xMax: number; yMin: number; yMax: number };
    
    if (torsoBBox !== null) {
        // Expand torso bounding box
        const width = torsoBBox.xMax - torsoBBox.xMin;
        const height = torsoBBox.yMax - torsoBBox.yMin;
        const expansion = TORSO_EXPANSION_RATIO * Math.max(width, height) / 2;

        cropRegion = {
            xMin: Math.max(0, torsoBBox.xMin - expansion),
            xMax: Math.min(1, torsoBBox.xMax + expansion),
            yMin: Math.max(0, torsoBBox.yMin - expansion),
            yMax: Math.min(1, torsoBBox.yMax + expansion),
        };
    } else {
        // Fallback: use all keypoints
        const bbox = calculateBoundingBox(keypoints, CROP_KEYPOINT_SCORE_THRESHOLD);
        if (bbox.width === 0 || bbox.height === 0) {
            // No valid keypoints - return full frame
            return { cropX: 0, cropY: 0, cropSize: Math.max(frameWidth, frameHeight) };
        }
        const expansion = BODY_EXPANSION_RATIO * Math.max(bbox.width, bbox.height) / 2;
        cropRegion = {
            xMin: Math.max(0, bbox.xMin - expansion),
            xMax: Math.min(1, bbox.xMax + expansion),
            yMin: Math.max(0, bbox.yMin - expansion),
            yMax: Math.min(1, bbox.yMax + expansion),
        };
    }

    const width = cropRegion.xMax - cropRegion.xMin;
    const height = cropRegion.yMax - cropRegion.yMin;
    const cropSize = Math.max(width, height) * Math.max(frameWidth, frameHeight);

    return {
        cropX: cropRegion.xMin,
        cropY: cropRegion.yMin,
        cropSize: cropSize,
    };
}

function transformKeypointToScreen(
    normalizedX: number,
    normalizedY: number,
    frameWidth: number,
    frameHeight: number,
    screenWidth: number,
    screenHeight: number,
    orientation: string,
    cameraPosition: 'front' | 'back',
    cropX: number,
    cropY: number,
    cropSize: number
): { x: number; y: number } {
    'worklet';

    if (frameWidth <= 0 || frameHeight <= 0 || screenWidth <= 0 || screenHeight <= 0) {
        return { x: 0, y: 0 };
    }

    if (isNaN(normalizedX) || isNaN(normalizedY)) {
        return { x: 0, y: 0 };
    }

    let x = normalizedX;
    let y = normalizedY;

    if (x < 0 || x > 1 || y < 0 || y > 1) {
        return { x: 0, y: 0 };
    }

    x = Math.max(0, Math.min(x, 1));
    y = Math.max(0, Math.min(y, 1));

    let frameX = x * frameWidth;
    let frameY = y * frameHeight;

    const cropSizeClamped = Math.max(frameWidth, frameHeight, 1);
    const cropScaleX = frameWidth / cropSizeClamped;
    const cropScaleY = frameHeight / cropSizeClamped;

    frameX = cropX * frameWidth + (frameX - cropX * frameWidth) * cropScaleX;
    frameY = cropY * frameHeight + (frameY - cropY * frameHeight) * cropScaleY;

    frameX = Math.max(0, Math.min(frameX, frameWidth));
    frameY = Math.max(0, Math.min(frameY, frameHeight));

    if (cameraPosition === 'front') {
        frameX = frameWidth - frameX;
    }

    let screenX = frameX;
    let screenY = frameY;
    let transformedWidth = frameWidth;
    let transformedHeight = frameHeight;

    switch (orientation) {
        case 'portrait':
            screenX = frameHeight - frameY;
            screenY = frameX;
            transformedWidth = frameHeight;
            transformedHeight = frameWidth;
            break;
        case 'portraitUpsideDown':
            screenX = frameY;
            screenY = frameWidth - frameX;
            transformedWidth = frameHeight;
            transformedHeight = frameWidth;
            break;
        case 'landscapeLeft':
            screenX = frameX;
            screenY = frameY;
            transformedWidth = frameWidth;
            transformedHeight = frameHeight;
            break;
        case 'landscapeRight':
            screenX = frameHeight - frameY;
            screenY = frameWidth - frameX;
            transformedWidth = frameHeight;
            transformedHeight = frameWidth;
            break;
        default:
            screenX = frameHeight - frameY;
            screenY = frameX;
            transformedWidth = frameHeight;
            transformedHeight = frameWidth;
    }

    const scaleX = screenWidth / transformedWidth;
    const scaleY = screenHeight / transformedHeight;
    const scale = Math.min(scaleX, scaleY);
    
    if (!isFinite(scale) || scale <= 0) {
        return { x: 0, y: 0 };
    }

    const scaledWidth = transformedWidth * scale;
    const scaledHeight = transformedHeight * scale;
    const offsetX = (screenWidth - scaledWidth) / 2;
    const offsetY = (screenHeight - scaledHeight) / 2;

    const finalX = screenX * scale + offsetX;
    const finalY = screenY * scale + offsetY;

    if (isNaN(finalX) || isNaN(finalY)) {
        return { x: 0, y: 0 };
    }

    return {
        x: Math.max(0, Math.min(finalX, screenWidth)),
        y: Math.max(0, Math.min(finalY, screenHeight))
    };
}

export default function VisionOnDeviceScreen() {
    const { lift } = useLocalSearchParams();
    const { userProfile, loadingProfile } = useUserProfile();
    const { uploadVideo } = useMediaUpload();
    const router = useRouter();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    
    const [hasPermission, setHasPermission] = useState(false);
    const [shouldBeActive, setShouldBeActive] = useState(false); 
    const [isFocused, setIsFocused] = useState(true); 
    const [appState, setAppState] = useState(AppState.currentState);
    const [retryCount, setRetryCount] = useState(0);
    const [feedback, setFeedback] = useState<any>(null);
    const [uiRotation, setUiRotation] = useState(0);
    const [skeletonData, setSkeletonData] = useState<{
        keypoints: Array<{ x: number; y: number; score: number; index: number }>;
        connections: Array<{ x1: number; y1: number; x2: number; y2: number }>;
        orientation: string;
        personId?: number;
    } | null>(null);
    
    // Recording state
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');
    
    const frameCountRef = useRef(0);
    const lastKeypointsRef = useRef<{ [key: string]: { x: number; y: number; score: number; dx: number; dy: number } }>({});
    const cameraRef = useRef<Camera>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    
    // Multi-person tracking with OKS
    const trackedPersonsRef = useRef<Map<number, TrackedPerson>>(new Map());
    const nextPersonIdRef = useRef(0);
    const lastFrameTimestampRef = useRef(Date.now());
    
    const MAX_RETRIES = 3;

    const userHeight = userProfile?.height;
    const userWeight = userProfile?.weight;
    const liftType = typeof lift === 'string' ? lift : undefined;

    const screenWidthValue = screenWidth;
    const screenHeightValue = screenHeight;

    const setFeedbackJS = Worklets.createRunOnJS(setFeedback);
    const setSkeletonDataJS = Worklets.createRunOnJS(setSkeletonData);

    const isActive = isFocused && appState === 'active' && shouldBeActive;

    useFocusEffect(
        useCallback(() => {
            setIsFocused(true);
            console.log('[VisionOnDevice] 🎯 Screen focused - isFocused = true');
            
            return () => {
                setIsFocused(false);
                console.log('[VisionOnDevice] 🎯 Screen unfocused - isFocused = false');
            };
        }, [])
    );

    useEffect(() => {
        console.log('[VisionOnDevice] 📊 SKELETON DATA STATE CHANGED:', {
            hasSkeletonData: !!skeletonData,
            keypointsCount: skeletonData?.keypoints?.length ?? 0,
            connectionsCount: skeletonData?.connections?.length ?? 0,
            isActive,
            isFocused,
            appState,
            shouldBeActive,
            canRender: isActive && skeletonData
        });
    }, [skeletonData]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            console.log('[VisionOnDevice] 📱 App state changed:', appState, '->', nextAppState);
            setAppState(nextAppState);
        });
        
        return () => {
            subscription.remove();
        };
    }, [appState]);

    useEffect(() => {
        console.log('[VisionOnDevice] Screen initialized with lift:', lift);
        console.log('[VisionOnDevice] User profile loading:', loadingProfile);
        if (userProfile) {
            console.log('[VisionOnDevice] User metrics:', {
                height: userProfile.height,
                weight: userProfile.weight
            });
        }
    }, [lift, userProfile, loadingProfile]);

    const device = useCameraDevice(cameraPosition, {
        physicalDevices: ['wide-angle-camera']  
    });

    const format = useCameraFormat(device, [
        { fps: CAMERA_FPS }, 
        { videoResolution: { width: 640, height: 480 } }
    ]);

    useEffect(() => {
        console.log('[VisionOnDevice] 📱 Camera device info:', {
            device: device ? {
                id: device.id,
                position: device.position,
                name: device.name,
                hasFlash: device.hasFlash,
            } : 'NO DEVICE FOUND'
        });
        console.log('[VisionOnDevice] 📹 Camera format info:', {
            format: format ? {
                videoWidth: format.videoWidth,
                videoHeight: format.videoHeight,
                maxFps: format.maxFps,
                minFps: format.minFps,
            } : 'NO FORMAT FOUND'
        });
        console.log('[VisionOnDevice] Has permission:', hasPermission);
        console.log('[VisionOnDevice] Is active:', isActive);
    }, [device, format, hasPermission, isActive]);

    const model = useTensorflowModel(
        require('../assets/movenet_lightning.tflite'),
        delegate as any
    );

    useEffect(() => {
        if (!model) return;

        try {
            console.log('[VisionOnDevice] Model state:', model.state);
            if (model.state === 'loaded') {
                console.log('[VisionOnDevice] ✅ MoveNet Lightning model loaded successfully');
                console.log(`[VisionOnDevice] CPU Configuration: ${CPU_THREADS} threads`);
                console.log('[VisionOnDevice] 🎯 Delegate: CPU');
                console.log('[VisionOnDevice] 📊 Target latency: <50ms per frame');
                setRetryCount(0); 
            } else if (model.state === 'loading') {
                console.log('[VisionOnDevice] ⏳ Loading MoveNet Lightning model...');
                console.log(`[VisionOnDevice] Configuration: Delegate=${delegate}, CPU_THREADS=${CPU_THREADS}`);
            } else if (model.state === 'error') {
                console.error('[VisionOnDevice] ❌ Model loading failed:', model.error);
                if (retryCount < MAX_RETRIES) {
                    const retryDelay = Math.pow(2, retryCount) * 1000; 
                    console.log(`[VisionOnDevice] Retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                    
                    const timeoutId = setTimeout(() => {
                        setRetryCount(prev => prev + 1);
                    }, retryDelay);
                    
                    return () => clearTimeout(timeoutId);
                } else {
                    console.error('[VisionOnDevice] Max retries reached. Model loading failed permanently.');
                }
            }
        } catch (error) {
            console.error('[VisionOnDevice] Error in model state handler:', error);
        }
    }, [model, model.state, retryCount, MAX_RETRIES]);

    useEffect(() => {
        if (model.state !== 'loaded' || !model.model) {
            setFeedback(null);
            setSkeletonData(null);
            return;
        }

        if (typeof model.model.runSync !== 'function') {
            console.error('[VisionOnDevice] ❌ Model does not have runSync method');
            setFeedback(null);
            setSkeletonData(null);
            return;
        }

        console.log('[VisionOnDevice] ✅ Model validated and ready for inference');
    }, [model, model.state, model.model]);

    const emojiFont = useFont(require('../assets/NotoEmoji-Medium.ttf'), 30);
    
    useEffect(() => {
        
        const checkPermission = async () => {
            try {
                
                const status = Camera.getCameraPermissionStatus();
                
            if (__DEV__) {
                    console.log('[VisionOnDevice] Current camera permission status:', status);
                }
                
                if (status === 'granted') {
                    setHasPermission(true);
                } else if (status === 'not-determined') {
                    
            if (__DEV__) {
                        console.log('[VisionOnDevice] Requesting camera permission...');
                    }
                    const newStatus = await Camera.requestCameraPermission();
                    const granted = newStatus === 'granted';
                    setHasPermission(granted);
                    if (__DEV__) {
                        console.log('[VisionOnDevice] Camera permission after request:', newStatus, 'granted:', granted);
                    }
                } else {
            setHasPermission(false);
                    if (__DEV__) {
                        console.warn('[VisionOnDevice] Camera permission denied or restricted:', status);
                    }
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('[VisionOnDevice] Error checking camera permission:', error);
                }
                setHasPermission(false);
            }
        };
        
        checkPermission();
    }, []);

    useEffect(() => {
        // Initialize the lastKeypoints object if needed
        if (Object.keys(lastKeypointsRef.current).length === 0) {
            lastKeypointsRef.current = {};
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            console.log('[VisionOnDevice] Camera deactivated, cleaning up resources');
            
            setSkeletonData(null);
            setFeedback(null);
            
            frameCountRef.current = 0;
            lastKeypointsRef.current = {};
        }
    }, [isActive]);

    useEffect(() => {
        return () => {
            console.log('[VisionOnDevice] Component unmounting, releasing camera');
            setShouldBeActive(false);
            setFeedback(null);
            setSkeletonData(null);
        };
    }, []); 

    useEffect(() => {
        console.log('[VisionOnDevice] 🎥 Render state:', {
            hasPermission,
            hasDevice: !!device,
            hasFormat: !!format,
            isFocused,
            appState,
            shouldBeActive,
            isActive, 
            modelState: model.state
        });
    }, [hasPermission, device, format, isFocused, appState, shouldBeActive, isActive, model.state]);

    useEffect(() => {
        console.log('[VisionOnDevice] 📊 Skeleton Data State:', {
            hasSkeletonData: !!skeletonData,
            keypointsCount: skeletonData?.keypoints?.length || 0,
            connectionsCount: skeletonData?.connections?.length || 0,
            canRender: isActive && skeletonData
        });
    }, [isActive, skeletonData]);    function analyzePose(keypoints: Int8Array | Uint8Array | Float32Array | Float64Array, userHeight?: number, userWeight?: number) {
        'worklet';
        if (!keypoints || keypoints.length < 51) {
            return {
                qualityScore: 0,
                status: 'poor',
                color: '#FF0000',
                messages: ['⚠️ Invalid keypoints'],
                visibleKeypoints: 0,
                visibilityRatio: 0,
                confidenceRatio: 0,
            };
        }
        
        const visibleKeypoints = [];
        const scores = [];

        for (let i = 0; i < 17; i++) {
            const baseIndex = i * 3;
            
            if (baseIndex + 2 >= keypoints.length) {
                continue;
            }
            
            const y = keypoints[baseIndex];
            const x = keypoints[baseIndex + 1];
            const score = keypoints[baseIndex + 2];
            
            scores.push(score);
            // Use DETECTION_THRESHOLD for analyzing all detected keypoints
            if (score > DETECTION_THRESHOLD) {
                visibleKeypoints.push({ x, y, score, index: i });
            }
        }
        
        const visibilityRatio = visibleKeypoints.length / 17;
        const highConfidenceCount = scores.filter(s => s > HIGH_CONFIDENCE).length;
        const confidenceRatio = highConfidenceCount / 17;

        let qualityScore = 0;
        const messages: string[] = [];
        
        if (visibilityRatio >= 0.8) {
            qualityScore += 40;
            messages.push('✅ Excellent body visibility');
        } else if (visibilityRatio >= 0.6) {
            qualityScore += 20;
            messages.push('📏 Good visibility');
        } else {
            messages.push('⚠️ Move to show full body');
        }
        
        if (confidenceRatio >= 0.7) {
            qualityScore += 30;
            messages.push('🎯 Excellent detection');
        } else if (confidenceRatio >= 0.4) {
            qualityScore += 20;
            messages.push('💡 Good detection');
        } else {
            messages.push('🔍 Improve lighting');
        }

        const checkBodyPart = (name: string, indices: number[]) => {
            // Use DETECTION_THRESHOLD for body part visibility checks
            const visible = indices.filter(i => scores[i] > DETECTION_THRESHOLD).length;
            const ratio = visible / indices.length;
            
            if (ratio >= 0.5) {
                qualityScore += 10;
            } else {
                if (name === 'shoulders') messages.push('👔 Show shoulders');
                if (name === 'hips') messages.push('🦵 Show hips');
                if (name === 'knees') messages.push('🦵 Show knees');
                if (name === 'ankles') messages.push('👟 Show ankles');
            }
        };
        
        checkBodyPart('shoulders', [5, 6]);
        checkBodyPart('hips', [11, 12]);
        checkBodyPart('knees', [13, 14]);
        checkBodyPart('ankles', [15, 16]);

        if (userHeight && userHeight > 0) {
            
            const leftShoulder = { x: keypoints[5 * 3 + 1], y: keypoints[5 * 3] };
            const rightShoulder = { x: keypoints[6 * 3 + 1], y: keypoints[6 * 3] };
            const leftHip = { x: keypoints[11 * 3 + 1], y: keypoints[11 * 3] };
            const leftAnkle = { x: keypoints[15 * 3 + 1], y: keypoints[15 * 3] };
            
            const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
            const torsoLength = Math.abs(leftShoulder.y - leftHip.y);
            const legLength = Math.abs(leftHip.y - leftAnkle.y);

            const heightFactor = userHeight / 170; 
            qualityScore += 5;
            messages.push(`📐 Metrics: ${userHeight}cm`);
        }

        let status = 'poor';
        let color = '#FF0000';
        if (qualityScore >= 80) {
            status = 'excellent';
            color = '#00FF00';
        } else if (qualityScore >= 60) {
            status = 'good';
            color = '#FFFF00';
        } else if (qualityScore >= 40) {
            status = 'fair';
            color = '#FFA500';
        }
        
        return {
            qualityScore,
            status,
            color,
            messages: messages.slice(0, 3), 
            visibleKeypoints: visibleKeypoints.length,
            visibilityRatio,
            confidenceRatio,
        };
    }

    const frameProcessor = useFrameProcessor((frame) => {
        'worklet';

        try {
            if (!frame || typeof frame.width !== 'number' || typeof frame.height !== 'number') {
                return;
            }

            if (frame.width <= 0 || frame.height <= 0) {
                return;
            }

            if (!model || model.state !== 'loaded' || !model.model || typeof model.model.runSync !== 'function') {
                return;
            }

            frameCountRef.current++;
            const shouldProcess = frameCountRef.current % FRAME_SKIP_INTERVAL === 0;
            
            if (!shouldProcess) {
                return; 
            }
            
            console.log('[VisionOnDevice] ✅ Frame processor: processing frame #' + frameCountRef.current);

            // CRITICAL: Process synchronously to prevent frame from being freed
            // runAsync causes race condition where frame is freed before callback executes
            let frameBuffer;
            try {
                frameBuffer = frame.toArrayBuffer();
            } catch (e) {
                console.error('[VisionOnDevice] ❌ Frame.toArrayBuffer() failed:', e);
                return;
            }

            if (!frameBuffer || frameBuffer.byteLength === 0) {
                console.error('[VisionOnDevice] ❌ frameBuffer invalid - null or empty:', frameBuffer?.byteLength);
                return;
            }

            console.log('[VisionOnDevice] ✅ frameBuffer acquired, size:', frameBuffer.byteLength);

                    const yuv = new Uint8Array(frameBuffer);
                    const inputWidth = frame.width ?? 0;
                    const inputHeight = frame.height ?? 0;
                    
                    console.log('[VisionOnDevice] Frame dimensions: width=' + inputWidth + ', height=' + inputHeight);
                    
                    if (inputWidth <= 0 || inputHeight <= 0) {
                        console.error('[VisionOnDevice] ❌ Invalid frame dimensions:', {inputWidth, inputHeight});
                        return;
                    }

                    const yPlaneSize = inputWidth * inputHeight;
                    const expectedFullNV21 = (inputWidth * inputHeight * 3) / 2;
                    const isGrayscaleOnly = yuv.length === yPlaneSize;
                    const isFullNV21 = yuv.length >= expectedFullNV21 * 0.9;

                    console.log('[VisionOnDevice] Buffer format: size=' + yuv.length + ', yPlane=' + yPlaneSize + ', isGrayscale=' + isGrayscaleOnly + ', isNV21=' + isFullNV21);

                    if (!isGrayscaleOnly && !isFullNV21) {
                        console.error('[VisionOnDevice] ❌ Unsupported format - size=' + yuv.length);
                        return;
                    }
                    
                    const rgbBufferSize = INPUT_WIDTH * INPUT_HEIGHT * 3;
                    const rgb = new Uint8Array(rgbBufferSize);
                    console.log('[VisionOnDevice] RGB buffer allocated: size=' + rgb.byteLength);
                    
                    // Validate buffer was allocated and is correct size
                    if (!rgb || rgb.byteLength !== rgbBufferSize || rgb.length !== rgbBufferSize) {
                        console.error('[VisionOnDevice] ❌ RGB allocation failed:', {byteLength: rgb?.byteLength, length: rgb?.length, expected: rgbBufferSize});
                        return;
                    }
                    
                    const scaleX = inputWidth / INPUT_WIDTH;
                    const scaleY = inputHeight / INPUT_HEIGHT;
                    
                    console.log('[VisionOnDevice] Scale factors: scaleX=' + scaleX + ', scaleY=' + scaleY);
                    
                    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
                        console.error('[VisionOnDevice] ❌ Invalid scale factors:', {scaleX, scaleY, isFiniteX: isFinite(scaleX), isFiniteY: isFinite(scaleY)});
                        return;
                    }
                    
                    console.log('[VisionOnDevice] ✅ All buffer validations passed, starting YUV-to-RGB conversion');
                    
                    for (let y = 0; y < INPUT_HEIGHT; y++) {
                        for (let x = 0; x < INPUT_WIDTH; x++) {
                            const srcX = Math.floor(x * scaleX);
                            const srcY = Math.floor(y * scaleY);
                            const yIndex = srcY * inputWidth + srcX;

                            if (yIndex >= yuv.length) continue;

                            const yValue = yuv[yIndex];
                            let r, g, b;

                            if (isGrayscaleOnly) {
                                r = yValue;
                                g = yValue;
                                b = yValue;
                            } else {
                                const uvX = Math.floor(srcX / 2);
                                const uvY = Math.floor(srcY / 2);
                                const uvIndex = yPlaneSize + (uvY * (inputWidth / 2) + uvX) * 2;

                                const uValue = uvIndex + 1 < yuv.length ? yuv[uvIndex] : 128;
                                const vValue = uvIndex + 1 < yuv.length ? yuv[uvIndex + 1] : 128;

                                r = Math.max(0, Math.min(255, yValue + 1.402 * (vValue - 128)));
                                g = Math.max(0, Math.min(255, yValue - 0.344136 * (uValue - 128) - 0.714136 * (vValue - 128)));
                                b = Math.max(0, Math.min(255, yValue + 1.772 * (uValue - 128)));
                            }

                            const dstIndex = (y * INPUT_WIDTH + x) * 3;
                            if (dstIndex + 2 < rgb.length) {
                                rgb[dstIndex] = Math.round(r);
                                rgb[dstIndex + 1] = Math.round(g);
                                rgb[dstIndex + 2] = Math.round(b);
                            }
                        }
                    }
                    
                    console.log('[VisionOnDevice] ✅ YUV conversion complete - format=' + (isGrayscaleOnly ? 'grayscale' : 'NV21'));

                    let outputs;
                    try {
                        outputs = model.model.runSync([rgb]);
                        console.log('[VisionOnDevice] Model inference completed - outputs type:', typeof outputs, 'is array:', Array.isArray(outputs), 'length:', outputs?.length);
                        
                        if (!outputs || !Array.isArray(outputs) || outputs.length === 0 || !outputs[0]) {
                            console.error('[VisionOnDevice] ❌ Invalid outputs structure - outputs:', outputs, 'isArray:', Array.isArray(outputs));
                            return;
                        }
                        console.log('[VisionOnDevice] outputs[0] type:', typeof outputs[0], 'length:', outputs[0]?.length);
                        
                        if (typeof outputs[0].length !== 'number' || outputs[0].length !== 51) {
                            console.error('[VisionOnDevice] ❌ Output length mismatch - expected 51, got:', outputs[0]?.length);
                            return;
                        }
                    } catch (inferenceError) {
                        console.error('[VisionOnDevice] ❌ Inference error:', inferenceError);
                        return;
                    }
                    
                    const rawKeypoints = outputs[0] as Float32Array;
                    console.log('[VisionOnDevice] rawKeypoints type:', typeof rawKeypoints, 'length:', rawKeypoints?.length);
                    
                    if (!rawKeypoints || rawKeypoints.length < 51) {
                        console.error('[VisionOnDevice] ❌ Keypoints validation failed - length:', rawKeypoints?.length);
                        return;
                    }
                    
                    const scores = [];
                    for (let i = 0; i < 17; i++) {
                        scores.push(Number(rawKeypoints[i * 3 + 2]).toFixed(2));
                    }
                    console.log('[VisionOnDevice] 🧠 Inference keypoint scores (frame #' + frameCountRef.current + '):', scores.join(', '));
                    
                    const keypoints = smoothKeypoints(rawKeypoints, lastKeypointsRef.current, screenWidthValue, screenHeightValue);
                    console.log('[VisionOnDevice] After smoothing - keypoints length:', keypoints?.length, 'type:', typeof keypoints);
                    
                    if (!keypoints || keypoints.length < 51) {
                        console.error('[VisionOnDevice] ❌ Smoothing failed - keypoints length:', keypoints?.length);
                        return;
                    }

                    const frameOrientation = frame.orientation || 'portrait';
                    const frameWidth = frame.width ?? 0;
                    const frameHeight = frame.height ?? 0;
                    
                    if (frameWidth <= 0 || frameHeight <= 0) {
                        return;
                    }
                    
                    const keypointsArray: number[][] = [];
                    for (let i = 0; i < 17; i++) {
                        const baseIndex = i * 3;
                        if (baseIndex + 2 < keypoints.length) {
                            const normalizedX = Number(keypoints[baseIndex + 1]);
                            const normalizedY = Number(keypoints[baseIndex]);
                            const score = Number(keypoints[baseIndex + 2]);
                            if (isFinite(normalizedX) && isFinite(normalizedY) && isFinite(score)) {
                                keypointsArray.push([normalizedX, normalizedY, score]);
                            }
                        }
                    }
                    
                    console.log('[VisionOnDevice] keypointsArray length:', keypointsArray.length, 'first 3:', keypointsArray.slice(0, 3));
                    
                    if (keypointsArray.length === 0) {
                        console.error('[VisionOnDevice] ❌ No keypoints extracted from smoothed keypoints');
                        return;
                    }

                    const cropRegion = determineCropRegion(keypointsArray, frameWidth, frameHeight);
                    if (!cropRegion || !isFinite(cropRegion.cropX) || !isFinite(cropRegion.cropY) || !isFinite(cropRegion.cropSize)) {
                        return;
                    }
                    
                    const keypointPositions: Array<{ x: number; y: number; score: number; index: number }> = [];
                    
                    for (let i = 0; i < 17; i++) {
                        const baseIndex = i * 3;
                        if (baseIndex + 2 >= keypoints.length) continue;
                        
                        const normalizedX = Number(keypoints[baseIndex + 1]); 
                        const normalizedY = Number(keypoints[baseIndex]); 
                        const score = Number(keypoints[baseIndex + 2]);

                        if (!isFinite(normalizedX) || !isFinite(normalizedY) || !isFinite(score)) {
                            console.log('[VisionOnDevice] Skipping keypoint ' + i + ' - not finite:', {normalizedX, normalizedY, score});
                            continue;
                        }
                        if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
                            console.log('[VisionOnDevice] Skipping keypoint ' + i + ' - out of bounds:', {normalizedX, normalizedY});
                            continue;
                        }
                        if (score < DETECTION_THRESHOLD) {
                            console.log('[VisionOnDevice] Skipping keypoint ' + i + ' - low score:', score, 'threshold:', DETECTION_THRESHOLD);
                            continue;
                        }

                        const transformed = transformKeypointToScreen(normalizedX, normalizedY, frameWidth, frameHeight, screenWidthValue, screenHeightValue, frameOrientation, cameraPosition, cropRegion.cropX, cropRegion.cropY, cropRegion.cropSize);

                        if (!isFinite(transformed.x) || !isFinite(transformed.y)) {
                            console.log('[VisionOnDevice] Skipping keypoint ' + i + ' - transform failed:', transformed);
                            continue;
                        }

                        keypointPositions.push({ x: transformed.x, y: transformed.y, score: score, index: i });
                    }

                    console.log('[VisionOnDevice] Final keypointPositions count:', keypointPositions.length, 'positions:', keypointPositions.slice(0, 3));

                    if (keypointPositions.length === 0) {
                        console.error('[VisionOnDevice] ❌ No valid keypoints after transformation');
                        return;
                    }

                    if (__DEV__ && frameCountRef.current % 30 === 0) {
                        console.log('[VisionOnDevice] ✅ Valid keypoints:', {
                            count: keypointPositions.length,
                            firstKp: keypointPositions[0],
                            scores: keypointPositions.map(kp => kp.score.toFixed(2)).join(',')
                        });
                    }

                    const keypointMap = new Map();
                    for (let i = 0; i < keypointPositions.length; i++) {
                        const kp = keypointPositions[i];
                        if (kp && typeof kp.index === 'number') {
                            keypointMap.set(kp.index, kp);
                        }
                    }

                    const connections = [];
                    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
                        const conn = SKELETON_CONNECTIONS[i];
                        if (!conn || conn.length < 2) continue;
                        
                        const [fromIdx, toIdx] = conn;
                        const from = keypointMap.get(fromIdx);
                        const to = keypointMap.get(toIdx);
                        
                        if (from && to && from.score > CONNECTION_THRESHOLD && to.score > CONNECTION_THRESHOLD) {
                            connections.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
                        }
                    }

                    const skeletonDataToSet = { keypoints: keypointPositions, connections: connections, orientation: frameOrientation };

                    console.log('[VisionOnDevice] 🎬 SKELETON DATA SET - keypoints:', keypointPositions.length, 'connections:', connections.length, 'orientation:', frameOrientation);
                    console.log('[VisionOnDevice] Calling setSkeletonDataJS with:', {hasKeypoints: !!skeletonDataToSet.keypoints, kpLength: skeletonDataToSet.keypoints.length});
                    
                    setSkeletonDataJS(skeletonDataToSet);
                    
                    console.log('[VisionOnDevice] setSkeletonDataJS called successfully');
        } catch (error) {
            return;
        }
    }, [model, model.state, model.model, userHeight, userWeight, liftType, cameraPosition, screenWidthValue, screenHeightValue, setSkeletonDataJS]);
    
    // Recording timer effect
    useEffect(() => {
        if (isRecording && !isPaused) {
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000) as any;
        } else {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
        }
        
        return () => {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
            }
        };
    }, [isRecording, isPaused]);
    
    // Multi-person tracking effect - processes skeleton data from worklet
    useEffect(() => {
        if (!skeletonData || skeletonData.keypoints.length === 0) {
            return;
        }

        try {
            // Convert sparse keypoints to full 17-length array (OKS requirement)
            const full17Keypoints = new Array(17).fill(null).map(() => ({
                x: 0,
                y: 0,
                score: 0
            }));

            for (let i = 0; i < skeletonData.keypoints.length; i++) {
                const kp = skeletonData.keypoints[i];
                // skeletonData keypoints are already indexed (0-16 correspond to body parts)
                if (typeof kp.index === 'number' && kp.index >= 0 && kp.index < 17) {
                    full17Keypoints[kp.index] = {
                        x: kp.x,
                        y: kp.y,
                        score: kp.score
                    };
                }
            }

            const currentTime = Date.now();
            const activeTracks = Array.from(trackedPersonsRef.current.values()).filter(
                track => (currentTime - track.lastSeen) < TRACKING_MAX_AGE
            );

            let bestTrackId = -1;
            let bestSimilarity = TRACKING_MIN_SIMILARITY;

            for (let i = 0; i < activeTracks.length; i++) {
                const similarity = computeOKSSimilarityJS(
                    full17Keypoints,
                    activeTracks[i].keypoints
                );

                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestTrackId = activeTracks[i].id;
                }
            }

            if (bestTrackId >= 0) {
                const track = trackedPersonsRef.current.get(bestTrackId);
                if (track) {
                    track.keypoints = full17Keypoints;
                    track.lastSeen = currentTime;

                    if (__DEV__) {
                        console.log(`[VisionOnDevice] 👤 Tracked person #${bestTrackId} (OKS: ${(bestSimilarity * 100).toFixed(1)}%)`);
                    }
                }
            } else if (activeTracks.length < TRACKING_MAX_PERSONS) {
                const newId = nextPersonIdRef.current++;
                trackedPersonsRef.current.set(newId, {
                    id: newId,
                    lastSeen: currentTime,
                    keypoints: full17Keypoints
                });

                if (__DEV__) {
                    console.log(`[VisionOnDevice] 👤 New person #${newId} tracked`);
                }
            }

            for (const [id, track] of trackedPersonsRef.current.entries()) {
                if ((currentTime - track.lastSeen) >= TRACKING_MAX_AGE) {
                    trackedPersonsRef.current.delete(id);

                    if (__DEV__) {
                        console.log(`[VisionOnDevice] 👤 Person #${id} tracking lost`);
                    }
                }
            }
        } catch (error) {
            if (__DEV__) {
                console.error('[VisionOnDevice] Tracking error:', error);
            }
        }
    }, [skeletonData]);

    // Cleanup tracked persons on unmount
    useEffect(() => {
        return () => {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
            if (trackedPersonsRef.current) {
                trackedPersonsRef.current.clear();
            }
            lastKeypointsRef.current = {};
        };
    }, []);
    
    // Debug skeleton data logging
    useEffect(() => {
        if (skeletonData && __DEV__) {
            console.log('[VisionOnDevice] 🎨 Skeleton data updated:', {
                keypoints: skeletonData.keypoints.length,
                connections: skeletonData.connections.length,
                orientation: skeletonData.orientation,
                personId: skeletonData.personId,
            });
        }
    }, [skeletonData]);
    
    useEffect(() => {
        if (!skeletonData || skeletonData.keypoints.length === 0) {
            return;
        }

        try {
            const keypointsForAnalysis = new Float32Array(51);
            for (let i = 0; i < skeletonData.keypoints.length; i++) {
                const kp = skeletonData.keypoints[i];
                const idx = kp.index;
                if (idx >= 0 && idx < 17) {
                    keypointsForAnalysis[idx * 3] = kp.y / screenHeightValue;
                    keypointsForAnalysis[idx * 3 + 1] = kp.x / screenWidthValue;
                    keypointsForAnalysis[idx * 3 + 2] = kp.score;
                }
            }

            const analysis = analyzePose(keypointsForAnalysis, userHeight, userWeight);
            const liftAnalysis = analyzeLiftForm(keypointsForAnalysis, liftType, screenWidthValue, screenHeightValue, userHeight, userWeight);
            
            console.log('[VisionOnDevice] Form analysis:', {
                liftType: liftAnalysis.liftType,
                formScore: liftAnalysis.formScore,
                feedbackCount: liftAnalysis.feedback.length,
                feedback: liftAnalysis.feedback
            });
            
            setFeedback({
                qualityScore: analysis.qualityScore,
                liftFeedback: liftAnalysis.feedback,
                liftScore: liftAnalysis.formScore,
                liftType: liftAnalysis.liftType,
                status: 'analyzing'
            });
        } catch (error) {
            return;
        }
    }, [skeletonData, userHeight, userWeight, liftType, screenWidthValue, screenHeightValue]);
    
    // Start video recording
    const startRecording = async () => {
        if (!cameraRef.current || isRecording) return;
        
        try {
            console.log('[VisionOnDevice] Starting video recording');
            
            setIsRecording(true);
            setRecordingDuration(0);
            
            cameraRef.current.startRecording({
                onRecordingFinished: async (video) => {
                    console.log('[VisionOnDevice] Recording finished:', video.path);
                    
                    setIsRecording(false);
                    setIsPaused(false);
                    setRecordingDuration(0);
                    
                    // Process and upload video
                    await handleVideoUpload(video.path, video.duration);
                },
                onRecordingError: (error) => {
                    console.error('[VisionOnDevice] Recording error:', error);
                    
                    setIsRecording(false);
                    setIsPaused(false);
                    setRecordingDuration(0);
                    
                    Alert.alert('Recording Error', error.message || 'Failed to record video');
                },
            });
        } catch (error) {
            console.error('[VisionOnDevice] Error starting recording:', error);
            
            setIsRecording(false);
            Alert.alert('Error', 'Failed to start recording');
        }
    };
    
    // Pause video recording
    const pauseRecording = async () => {
        if (!cameraRef.current || !isRecording || isPaused) return;
        
        try {
            await cameraRef.current.pauseRecording();
            setIsPaused(true);
            
            console.log('[VisionOnDevice] Recording paused');
        } catch (error) {
            console.error('[VisionOnDevice] Error pausing recording:', error);
        }
    };
    
    // Resume video recording
    const resumeRecording = async () => {
        if (!cameraRef.current || !isRecording || !isPaused) return;
        
        try {
            await cameraRef.current.resumeRecording();
            setIsPaused(false);
            
            console.log('[VisionOnDevice] Recording resumed');
        } catch (error) {
            console.error('[VisionOnDevice] Error resuming recording:', error);
        }
    };
    
    // Stop video recording
    const stopRecording = async () => {
        if (!cameraRef.current || !isRecording) return;
        
        try {
            console.log('[VisionOnDevice] Stopping recording');
            
            await cameraRef.current.stopRecording();
        } catch (error) {
            console.error('[VisionOnDevice] Error stopping recording:', error);
            
            setIsRecording(false);
            setIsPaused(false);
            setRecordingDuration(0);
        }
    };
    
    // Handle video save to device after recording
    const handleVideoUpload = async (videoPath: string, duration: number) => {
        try {
            console.log('[VisionOnDevice] ========================================');
            console.log('[VisionOnDevice] VIDEO RECORDING COMPLETED');
            console.log('[VisionOnDevice] Video path (temp cache):', videoPath);
            console.log('[VisionOnDevice] Duration:', duration, 'seconds');
            console.log('[VisionOnDevice] Now requesting permission to save to GALLERY...');
            console.log('[VisionOnDevice] ========================================');
            
            // Check current permission status first
            const { status: currentStatus } = await MediaLibrary.getPermissionsAsync();
            
            console.log('[VisionOnDevice] Current media library permission status:', currentStatus);
            
            // Request media library permissions if not already granted
            let finalStatus = currentStatus;
            if (currentStatus !== 'granted') {
                console.log('[VisionOnDevice] Permission not granted, requesting now...');
                
                const { status: requestedStatus } = await MediaLibrary.requestPermissionsAsync();
                finalStatus = requestedStatus;
                
                if (__DEV__) {
                    console.log('[VisionOnDevice] Permission request result:', requestedStatus);
                }
            }
            
            // CRITICAL: Check if permission was denied
            if (finalStatus !== 'granted') {
                console.log('[VisionOnDevice] ========================================');
                console.log('[VisionOnDevice] ❌ PERMISSION DENIED - VIDEO NOT SAVED TO GALLERY');
                console.log('[VisionOnDevice] Final status:', finalStatus);
                console.log('[VisionOnDevice] Video remains in temp cache only:', videoPath);
                console.log('[VisionOnDevice] Temp cache will be cleared by system automatically');
                console.log('[VisionOnDevice] ========================================');
                
                Alert.alert(
                    'Video Not Saved to Gallery',
                    `Permission was denied. Your ${Math.floor(duration)}s workout video was NOT saved to your gallery.\n\nNote: The video exists temporarily in app cache but will be deleted automatically.\n\nTo save videos in the future, please grant media library permission in your device settings.`,
                    [
                        {
                            text: 'OK',
                            style: 'default',
                            onPress: () => {
                                console.log('[VisionOnDevice] User acknowledged permission denial');
                            }
                        }
                    ]
                );
                
                // Explicitly return - DO NOT save to gallery
                return;
            }
            
            console.log('[VisionOnDevice] Permission GRANTED. Proceeding to save video...');
            
            // Save video to gallery using expo-media-library
            const asset = await MediaLibrary.createAssetAsync(videoPath);
            
            console.log('[VisionOnDevice] ✓ Video saved to gallery:', asset.uri);
            
            // Optionally create an album and add the video to it
            try {
                const album = await MediaLibrary.getAlbumAsync('Workout Videos');
                if (album) {
                    await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
                    if (__DEV__) {
                        console.log('[VisionOnDevice] ✓ Video added to existing "Workout Videos" album');
                    }
                } else {
                    await MediaLibrary.createAlbumAsync('Workout Videos', asset, false);
                    console.log('[VisionOnDevice] ✓ Created "Workout Videos" album and added video');
                }
            } catch (albumError) {
                console.warn('[VisionOnDevice] Could not create/add to album:', albumError);
                // Don't fail if album creation fails - video is still saved
            }
            
            // Show success message
            Alert.alert(
                'Video Saved! 🎉',
                `Your ${Math.floor(duration)}s workout video has been saved to your gallery.\n\n✓ Saved to Gallery\n✓ Added to "Workout Videos" album`,
                [
                    {
                        text: 'OK',
                        style: 'default',
                        onPress: () => {
                            console.log('[VisionOnDevice] User acknowledged video save success');
                        }
                    },
                    {
                        text: 'View in Gallery',
                        onPress: () => {
                            console.log('[VisionOnDevice] User wants to view in gallery');
                        },
                    },
                ]
            );
        } catch (error) {
            console.error('[VisionOnDevice] Error saving video to gallery:', error);
            
            Alert.alert(
                'Error Saving Video',
                error instanceof Error ? error.message : 'An error occurred while saving your video to the gallery.'
            );
        }
    };
    
    // Format recording duration for display
    const formatRecordingTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    const getFeedbackColor = () => {
        if (!feedback) return 'bg-gray-500';
        if (feedback.qualityScore >= 80) return 'bg-green-500';
        if (feedback.qualityScore >= 60) return 'bg-yellow-500';
        if (feedback.qualityScore >= 40) return 'bg-orange-500';
        return 'bg-red-500';
    };
    
    if (!hasPermission) {
        if (__DEV__) {
            console.warn('[VisionOnDevice] Camera permission not granted');
        }
        return (
            <View style={styles.container}>
                <Text style={styles.permissionText}>Camera permission required</Text>
                <Text style={styles.permissionText} className="text-sm mt-2 text-gray-400">
                    This app needs camera access to provide real-time workout feedback
                </Text>
                <TouchableOpacity 
                    onPress={async () => {
                        console.log('[VisionOnDevice] Requesting camera permission again');
                        try {
                            const newStatus = await Camera.requestCameraPermission();
                            const granted = newStatus === 'granted';
                            setHasPermission(granted);
                            console.log('[VisionOnDevice] Permission request result:', newStatus);
                        } catch (error) {
                            if (__DEV__) {
                                console.error('[VisionOnDevice] Error requesting permission:', error);
                            }
                        }
                    }}
                    className="bg-lime-500 px-6 py-3 rounded-full mt-4"
                >
                    <Text className="text-white font-bold">Grant Camera Permission</Text>
                </TouchableOpacity>
            </View>
        );
    }
    
    if (!device) {
        console.error('[VisionOnDevice] ❌ No camera device found');
        return (
            <View style={styles.container}>
                <Text style={styles.permissionText}>No camera device found</Text>
                <Text style={styles.permissionText} className="text-sm mt-2">
                    Please check your device settings
                </Text>
            </View>
        );
    }

    if (!format) {
        console.error('[VisionOnDevice] ❌ No compatible camera format found');
        return (
            <View style={styles.container}>
                <Text style={styles.permissionText}>No compatible camera format</Text>
                <Text style={styles.permissionText} className="text-sm mt-2">
                    Your device may not support the required video format
                </Text>
            </View>
        );
    }
    
    if (model.state === 'error') {
        console.error('[VisionOnDevice] Model failed to load:', model.error);
        return (
            <View style={styles.container}>
                <Text style={styles.permissionText}>Failed to load AI model</Text>
                <Text style={styles.permissionText} className="text-sm mt-2">
                    {model.error?.message || 'Unknown error'}
                </Text>
                <TouchableOpacity 
                    onPress={() => router.replace('/workout')}
                    className="bg-red-500 px-6 py-3 rounded-full mt-4"
                >
                    <Text className="text-white font-bold">Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }
    
    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#000000" />
            {device && hasPermission && format && (
            <Camera
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                device={device}
                format={format} 
                isActive={isActive}
                video={true}
                audio={true}
                fps={CAMERA_FPS}
                pixelFormat="yuv"
                enableBufferCompression={true}
                videoHdr={false}
                enableFpsGraph={__DEV__}
                frameProcessor={frameProcessor}
                outputOrientation="device"
                onUIRotationChanged={setUiRotation}
            />
            )}
            
            {(() => {
                const shouldRender = isActive && skeletonData;
                if (shouldRender) {
                    console.log('[VisionOnDevice] ✅ RENDERING CANVAS - isActive:', isActive, 'skeletonData:', !!skeletonData, 'keypoints:', skeletonData?.keypoints?.length ?? 0);
                }
                return shouldRender;
            })() && (
                <Canvas
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        width: screenWidthValue,
                        height: screenHeightValue,
                        top: 0,
                        left: 0,
                    }}
                >
                    {__DEV__ && skeletonData.keypoints.length === 0 && (
                        <SkiaText
                            x={screenWidthValue / 2 - 100}
                            y={screenHeightValue / 2}
                            text="No keypoints"
                            font={emojiFont}
                            color="#FF0000"
                        />
                    )}

                    {skeletonData.connections.length > 0 && skeletonData.connections.map((conn, idx) => (
                        <Line
                            key={`line-${idx}`}
                            p1={{ x: conn.x1, y: conn.y1 }}
                            p2={{ x: conn.x2, y: conn.y2 }}
                            color="#00FF00"
                            strokeWidth={3}
                        />
                    ))}

                    {skeletonData.keypoints.length > 0 && skeletonData.keypoints.map((kp, idx) => (
                        <Circle
                            key={`circle-${idx}`}
                            cx={kp.x}
                            cy={kp.y}
                            r={kp.score > HIGH_CONFIDENCE ? 6 : 4}
                            color={kp.score > HIGH_CONFIDENCE ? "#00FF00" : "#FFFF00"}
                        />
                    ))}

                    {skeletonData.keypoints.find(kp => kp.index === 0) && emojiFont && (
                        <SkiaText
                            x={skeletonData.keypoints.find(kp => kp.index === 0)!.x - 15}
                            y={skeletonData.keypoints.find(kp => kp.index === 0)!.y + 9}
                            text="😄"
                            font={emojiFont}
                            color="#FFFFFF"
                        />
                    )}
                </Canvas>
            )}
            
            <View className="absolute top-14 left-4 right-4 z-20">
                <View className="bg-blue-500 p-3 rounded-lg">
                    <Text className="text-white font-bold text-center">
                        On-Device Pose Detection
                    </Text>
                    {typeof lift === 'string' && lift && (
                        <Text className="text-white/80 text-center mt-1">
                            Lift: {lift.charAt(0).toUpperCase() + lift.slice(1)}
                        </Text>
                    )}
                    <Text className="text-white/80 text-xs text-center mt-1">
                        {model.state === 'loaded' ? '✅ Model Ready' : '⏳ Loading...'}
                    </Text>
                </View>
            </View>
            
            {isActive && feedback && (
                <View className="absolute top-32 left-4 right-4 z-20">
                    {feedback.liftFeedback && feedback.liftFeedback.length > 0 && (
                        <View className={`${feedback.liftScore >= 80 ? 'bg-green-500' : feedback.liftScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'} p-4 rounded-lg mb-2`}>
                            <View className="flex-row justify-between items-center mb-2">
                                <Text className="text-white font-bold text-lg">
                                    {feedback.liftType ? feedback.liftType.toUpperCase() : 'LIFT'} Form: {feedback.liftScore}/100
                                </Text>
                            </View>
                            
                            {feedback.liftFeedback.map((msg: string, idx: number) => (
                                <Text key={`lift-${idx}`} className="text-white text-sm mt-1 font-semibold">
                                    {msg}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>
            )}
            
            {isRecording && (
                <View style={{ transform: [{ rotate: `${uiRotation}deg` }] }} className="absolute top-14 right-4 z-30 flex-row items-center bg-red-600 px-3 py-2 rounded-full">
                    <View className="w-3 h-3 bg-white rounded-full mr-2 animate-pulse" />
                    <Text className="text-white font-bold">{formatRecordingTime(recordingDuration)}</Text>
                </View>
            )}
            
            {shouldBeActive && !isRecording && (
                <TouchableOpacity
                    onPress={() => {
                        setCameraPosition(prev => prev === 'front' ? 'back' : 'front');
                        lastKeypointsRef.current = {};
                    }}
                    style={{ transform: [{ rotate: `${uiRotation}deg` }] }}
                    className="absolute top-14 right-4 z-30 bg-black/50 p-3 rounded-full"
                >
                    <MaterialCommunityIcons 
                        name="camera-flip" 
                        size={24} 
                        color="white" 
                    />
                </TouchableOpacity>
            )}

            
            <View className="absolute bottom-10 left-4 right-4 z-20">
                {!shouldBeActive ? (
                    <>
                        {model.state === 'loading' && (
                            <View className="mb-3 bg-blue-500 py-3 rounded-full">
                                <Text className="text-white text-center font-bold">
                                    Loading pose model...
                                </Text>
                            </View>
                        )}
                        <TouchableOpacity
                            onPress={() => {
                                console.log('[VisionOnDevice] BUTTON PRESSED - checking conditions');
                                console.log('[VisionOnDevice] model.state:', model.state);
                                console.log('[VisionOnDevice] hasPermission:', hasPermission);
                                
                                if (model.state !== 'loaded') {
                                    console.warn('[VisionOnDevice] ⚠️ Model not ready. State:', model.state);
                                    return;
                                }
                                if (!hasPermission) {
                                    console.warn('[VisionOnDevice] ⚠️ Camera permission not granted');
                                    return;
                                }
                                
                                console.log('[VisionOnDevice] 🚀 All checks passed - SETTING shouldBeActive = true');
                                setShouldBeActive(true);
                                console.log('[VisionOnDevice] ✅ shouldBeActive state updated');
                            }}
                            disabled={model.state !== 'loaded' || !hasPermission}
                            className={`py-4 rounded-full ${
                                model.state === 'loaded' && hasPermission
                                    ? 'bg-lime-500'
                                    : 'bg-gray-400'
                            }`}
                        >
                            <Text className="text-white text-center font-bold text-lg">
                                Start Workout
                            </Text>
                        </TouchableOpacity>
                    </>
                ) : (
                    <>
                        {/* Recording controls */}
                        {!isRecording ? (
                            <View className="flex-row gap-2">
                                <TouchableOpacity
                                    onPress={startRecording}
                                    className="flex-1 bg-red-600 py-4 rounded-full flex-row items-center justify-center"
                                >
                                    <Text className="text-white text-center font-bold text-lg mr-2">●</Text>
                                    <Text className="text-white text-center font-bold text-lg">
                                        Record
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => {
                                        if (__DEV__) {
                                            console.log('[VisionOnDevice] 🛑 Ending workout - user deactivated camera');
                                        }
                                        setShouldBeActive(false);
                                        router.replace('/workout');
                                    }}
                                    className="flex-1 bg-gray-600 py-4 rounded-full"
                                >
                                    <Text className="text-white text-center font-bold text-lg">
                                        End Workout
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View className="flex-row gap-2">
                                {!isPaused ? (
                                    <TouchableOpacity
                                        onPress={pauseRecording}
                                        className="flex-1 bg-yellow-500 py-4 rounded-full flex-row items-center justify-center"
                                    >
                                        <Text className="text-white text-center font-bold text-lg mr-2">⏸</Text>
                                        <Text className="text-white text-center font-bold text-lg">
                                            Pause
                                        </Text>
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity
                                        onPress={resumeRecording}
                                        className="flex-1 bg-green-500 py-4 rounded-full flex-row items-center justify-center"
                                    >
                                        <Text className="text-white text-center font-bold text-lg mr-2">▶</Text>
                                        <Text className="text-white text-center font-bold text-lg">
                                            Resume
                                        </Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    onPress={stopRecording}
                                    className="flex-1 bg-red-600 py-4 rounded-full flex-row items-center justify-center"
                                >
                                    <Text className="text-white text-center font-bold text-lg mr-2">■</Text>
                                    <Text className="text-white text-center font-bold text-lg">
                                        Stop
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    permissionText: {
        color: '#fff',
        fontSize: 18,
        textAlign: 'center',
        marginTop: 100,
    },
});

