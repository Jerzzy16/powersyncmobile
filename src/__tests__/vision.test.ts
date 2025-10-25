// OKS (Object Keypoint Similarity) Tests
// Based on COCO evaluation metric: https://cocodataset.org/#keypoints-eval

// Constants from vision-ondevice.tsx
const OKS_KEYPOINT_THRESHOLD = 0.3;
const OKS_KEYPOINT_FALLOFF = [
    0.026, 0.025, 0.025, 0.035, 0.035, 0.079, 0.079, 0.072, 0.072, 0.062,
    0.062, 0.107, 0.107, 0.087, 0.087, 0.089, 0.089
];
const OKS_MIN_KEYPOINTS = 4;
const TRACKING_MIN_SIMILARITY = 0.15;

// Helper functions (copied from vision-ondevice.tsx, JS-only versions)
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

// Helper to create 17-keypoint arrays for testing
function createMoveNetKeypoints(
    positions: Array<{ x: number; y: number; score: number }>
): Array<{ x: number; y: number; score: number }> {
    const full17 = new Array(17).fill(null).map(() => ({
        x: 0,
        y: 0,
        score: 0
    }));
    
    for (let i = 0; i < positions.length && i < 17; i++) {
        full17[i] = positions[i];
    }
    
    return full17;
}

describe('OKS Keypoint Similarity', () => {
    test('identical keypoints should have similarity close to 1.0', () => {
        const keypoints = createMoveNetKeypoints([
            { x: 100, y: 100, score: 0.9 }, // nose
            { x: 101, y: 99, score: 0.8 },  // left_eye
            { x: 99, y: 99, score: 0.85 },  // right_eye
            { x: 102, y: 98, score: 0.7 },  // left_ear
            { x: 98, y: 98, score: 0.75 },  // right_ear
            { x: 150, y: 150, score: 0.6 }, // left_shoulder
            { x: 50, y: 150, score: 0.6 },  // right_shoulder
            { x: 155, y: 200, score: 0.5 }, // left_elbow
            { x: 45, y: 200, score: 0.5 },  // right_elbow
            { x: 160, y: 250, score: 0.4 }, // left_wrist
            { x: 40, y: 250, score: 0.4 },  // right_wrist
            { x: 150, y: 300, score: 0.7 }, // left_hip
            { x: 50, y: 300, score: 0.7 },  // right_hip
            { x: 155, y: 400, score: 0.6 }, // left_knee
            { x: 45, y: 400, score: 0.6 },  // right_knee
            { x: 160, y: 500, score: 0.5 }, // left_ankle
            { x: 40, y: 500, score: 0.5 },  // right_ankle
        ]);
        
        const similarity = computeOKSSimilarityJS(keypoints, keypoints);
        expect(similarity).toBeCloseTo(1.0, 1);
    });

    test('zero confidence keypoints should be ignored', () => {
        const keypoints1 = createMoveNetKeypoints([
            { x: 100, y: 100, score: 0.9 },
            { x: 101, y: 99, score: 0.8 },
            { x: 99, y: 99, score: 0.0 }, // zero confidence - should be ignored
            { x: 102, y: 98, score: 0.7 },
            { x: 98, y: 98, score: 0.75 },
            { x: 150, y: 150, score: 0.6 },
            { x: 50, y: 150, score: 0.6 },
            { x: 155, y: 200, score: 0.5 },
            { x: 45, y: 200, score: 0.5 },
            { x: 160, y: 250, score: 0.4 },
            { x: 40, y: 250, score: 0.4 },
            { x: 150, y: 300, score: 0.7 },
            { x: 50, y: 300, score: 0.7 },
            { x: 155, y: 400, score: 0.6 },
            { x: 45, y: 400, score: 0.6 },
            { x: 160, y: 500, score: 0.5 },
            { x: 40, y: 500, score: 0.5 },
        ]);

        const keypoints2 = createMoveNetKeypoints([
            { x: 100, y: 100, score: 0.9 },
            { x: 101, y: 99, score: 0.8 },
            { x: 200, y: 200, score: 0.9 }, // different position but ignored due to threshold
            { x: 102, y: 98, score: 0.7 },
            { x: 98, y: 98, score: 0.75 },
            { x: 150, y: 150, score: 0.6 },
            { x: 50, y: 150, score: 0.6 },
            { x: 155, y: 200, score: 0.5 },
            { x: 45, y: 200, score: 0.5 },
            { x: 160, y: 250, score: 0.4 },
            { x: 40, y: 250, score: 0.4 },
            { x: 150, y: 300, score: 0.7 },
            { x: 50, y: 300, score: 0.7 },
            { x: 155, y: 400, score: 0.6 },
            { x: 45, y: 400, score: 0.6 },
            { x: 160, y: 500, score: 0.5 },
            { x: 40, y: 500, score: 0.5 },
        ]);

        const similarity = computeOKSSimilarityJS(keypoints1, keypoints2);
        expect(similarity).toBeCloseTo(1.0, 1);
    });

    test('mismatched pose should have lower similarity', () => {
        const keypoints1 = createMoveNetKeypoints([
            { x: 100, y: 100, score: 0.9 },
            { x: 101, y: 99, score: 0.8 },
            { x: 99, y: 99, score: 0.85 },
            { x: 102, y: 98, score: 0.7 },
            { x: 98, y: 98, score: 0.75 },
            { x: 150, y: 150, score: 0.6 },
            { x: 50, y: 150, score: 0.6 },
            { x: 155, y: 200, score: 0.5 },
            { x: 45, y: 200, score: 0.5 },
            { x: 160, y: 250, score: 0.4 },
            { x: 40, y: 250, score: 0.4 },
            { x: 150, y: 300, score: 0.7 },
            { x: 50, y: 300, score: 0.7 },
            { x: 155, y: 400, score: 0.6 },
            { x: 45, y: 400, score: 0.6 },
            { x: 160, y: 500, score: 0.5 },
            { x: 40, y: 500, score: 0.5 },
        ]);

        const keypoints2 = createMoveNetKeypoints([
            { x: 200, y: 200, score: 0.9 }, // offset pose
            { x: 201, y: 199, score: 0.8 },
            { x: 199, y: 199, score: 0.85 },
            { x: 202, y: 198, score: 0.7 },
            { x: 198, y: 198, score: 0.75 },
            { x: 250, y: 250, score: 0.6 },
            { x: 150, y: 250, score: 0.6 },
            { x: 255, y: 300, score: 0.5 },
            { x: 145, y: 300, score: 0.5 },
            { x: 260, y: 350, score: 0.4 },
            { x: 140, y: 350, score: 0.4 },
            { x: 250, y: 400, score: 0.7 },
            { x: 150, y: 400, score: 0.7 },
            { x: 255, y: 500, score: 0.6 },
            { x: 145, y: 500, score: 0.6 },
            { x: 260, y: 600, score: 0.5 },
            { x: 140, y: 600, score: 0.5 },
        ]);

        const similarity = computeOKSSimilarityJS(keypoints1, keypoints2);
        expect(similarity).toBeLessThan(1.0);
        expect(similarity).toBeGreaterThan(0);
    });

    test('insufficient keypoints should return 0', () => {
        const keypoints1 = createMoveNetKeypoints([
            { x: 100, y: 100, score: 0.9 },
            { x: 101, y: 99, score: 0.0 }, // below threshold
            { x: 99, y: 99, score: 0.0 },  // below threshold
            { x: 102, y: 98, score: 0.0 }, // below threshold
            ...new Array(13).fill(null).map(() => ({ x: 0, y: 0, score: 0.0 }))
        ]);

        const keypoints2 = createMoveNetKeypoints([
            { x: 100, y: 100, score: 0.9 },
            { x: 101, y: 99, score: 0.0 },
            { x: 99, y: 99, score: 0.0 },
            { x: 102, y: 98, score: 0.0 },
            ...new Array(13).fill(null).map(() => ({ x: 0, y: 0, score: 0.0 }))
        ]);

        const similarity = computeOKSSimilarityJS(keypoints1, keypoints2);
        expect(similarity).toBe(0);
    });

    test('should not match above tracking threshold with sufficiently different poses', () => {
        const keypoints1 = createMoveNetKeypoints([
            { x: 0, y: 0, score: 0.9 },
            { x: 1, y: 1, score: 0.8 },
            { x: 2, y: 2, score: 0.85 },
            { x: 3, y: 3, score: 0.7 },
            { x: 4, y: 4, score: 0.75 },
            ...new Array(12).fill(null).map(() => ({ x: 0, y: 0, score: 0.6 }))
        ]);

        const keypoints2 = createMoveNetKeypoints([
            { x: 500, y: 500, score: 0.9 }, // very far away
            { x: 501, y: 501, score: 0.8 },
            { x: 502, y: 502, score: 0.85 },
            { x: 503, y: 503, score: 0.7 },
            { x: 504, y: 504, score: 0.75 },
            ...new Array(12).fill(null).map(() => ({ x: 500, y: 500, score: 0.6 }))
        ]);

        const similarity = computeOKSSimilarityJS(keypoints1, keypoints2);
        expect(similarity).toBeLessThan(TRACKING_MIN_SIMILARITY);
    });

    test('should handle all 17 keypoints correctly', () => {
        // Create a complete 17-keypoint skeleton (MoveNet output format)
        const keypoints = createMoveNetKeypoints(
            Array.from({ length: 17 }, (_, i) => ({
                x: Math.cos(i * 0.4) * 100 + 200,
                y: Math.sin(i * 0.4) * 100 + 200,
                score: 0.7 + Math.random() * 0.2
            }))
        );

        const similarity = computeOKSSimilarityJS(keypoints, keypoints);
        expect(similarity).toBeCloseTo(1.0, 1);
        expect(similarity).toBeGreaterThanOrEqual(0);
        expect(similarity).toBeLessThanOrEqual(1);
    });
});

describe('Keypoint Area Calculation', () => {
    test('should calculate area as width * height of bounding box', () => {
        const keypoints = createMoveNetKeypoints([
            { x: 0, y: 0, score: 0.9 },    // top-left
            { x: 100, y: 100, score: 0.9 }, // bottom-right
            ...new Array(15).fill(null).map(() => ({ x: 50, y: 50, score: 0.0 }))
        ]);

        const area = computeKeypointAreaJS(keypoints);
        expect(area).toBeCloseTo(100 * 100, 0); // (100-0) * (100-0) = 10000
    });

    test('should ignore low-confidence keypoints', () => {
        const keypoints = createMoveNetKeypoints([
            { x: 0, y: 0, score: 0.1 },    // below threshold (0.3)
            { x: 100, y: 100, score: 0.1 }, // below threshold
            { x: 50, y: 50, score: 0.9 },  // high confidence
            { x: 60, y: 60, score: 0.9 },  // high confidence
            ...new Array(13).fill(null).map(() => ({ x: 0, y: 0, score: 0.0 }))
        ]);

        const area = computeKeypointAreaJS(keypoints);
        expect(area).toBeCloseTo(10 * 10, 0); // (60-50) * (60-50) = 100
    });

    test('should return 1 when no valid keypoints', () => {
        const keypoints = createMoveNetKeypoints(
            Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0.0 }))
        );

        const area = computeKeypointAreaJS(keypoints);
        expect(area).toBe(1);
    });

    test('should handle keypoints with same x or y coordinates', () => {
        const keypoints = createMoveNetKeypoints([
            { x: 100, y: 50, score: 0.9 },
            { x: 100, y: 60, score: 0.9 }, // same x, different y
            ...new Array(15).fill(null).map(() => ({ x: 0, y: 0, score: 0.0 }))
        ]);

        const area = computeKeypointAreaJS(keypoints);
        expect(area).toBeCloseTo(0 * 10, 0); // width=0, height=10
    });
});

describe('Integration Tests', () => {
    test('should correctly identify similar poses as candidates for tracking', () => {
        // Person 1: standing pose
        const person1 = createMoveNetKeypoints([
            { x: 100, y: 50, score: 0.95 },   // nose
            { x: 85, y: 35, score: 0.90 },    // left_eye
            { x: 115, y: 35, score: 0.90 },   // right_eye
            { x: 70, y: 30, score: 0.85 },    // left_ear
            { x: 130, y: 30, score: 0.85 },   // right_ear
            { x: 75, y: 90, score: 0.85 },    // left_shoulder
            { x: 125, y: 90, score: 0.85 },   // right_shoulder
            { x: 65, y: 150, score: 0.80 },   // left_elbow
            { x: 135, y: 150, score: 0.80 },  // right_elbow
            { x: 55, y: 200, score: 0.75 },   // left_wrist
            { x: 145, y: 200, score: 0.75 },  // right_wrist
            { x: 80, y: 180, score: 0.85 },   // left_hip
            { x: 120, y: 180, score: 0.85 },  // right_hip
            { x: 75, y: 280, score: 0.80 },   // left_knee
            { x: 125, y: 280, score: 0.80 },  // right_knee
            { x: 70, y: 350, score: 0.75 },   // left_ankle
            { x: 130, y: 350, score: 0.75 },  // right_ankle
        ]);

        // Person 2: slightly different pose (10% translation)
        const person2 = createMoveNetKeypoints([
            { x: 110, y: 55, score: 0.95 },
            { x: 95, y: 38, score: 0.90 },
            { x: 125, y: 38, score: 0.90 },
            { x: 80, y: 33, score: 0.85 },
            { x: 140, y: 33, score: 0.85 },
            { x: 85, y: 99, score: 0.85 },
            { x: 135, y: 99, score: 0.85 },
            { x: 75, y: 165, score: 0.80 },
            { x: 145, y: 165, score: 0.80 },
            { x: 65, y: 220, score: 0.75 },
            { x: 155, y: 220, score: 0.75 },
            { x: 90, y: 198, score: 0.85 },
            { x: 130, y: 198, score: 0.85 },
            { x: 85, y: 308, score: 0.80 },
            { x: 135, y: 308, score: 0.80 },
            { x: 80, y: 385, score: 0.75 },
            { x: 140, y: 385, score: 0.75 },
        ]);

        const similarity = computeOKSSimilarityJS(person1, person2);
        expect(similarity).toBeGreaterThan(TRACKING_MIN_SIMILARITY);
        expect(similarity).toBeCloseTo(1.0, 0); // should be quite similar
    });

    test('should correctly reject unrelated poses', () => {
        // Person 1: standing pose
        const standing = createMoveNetKeypoints([
            { x: 100, y: 50, score: 0.95 },
            ...new Array(16).fill(null).map((_, i) => ({
                x: 100 + (i - 8) * 20,
                y: 50 + i * 20,
                score: 0.8
            }))
        ]);

        // Person 2: completely different pose (upside down, far away)
        const different = createMoveNetKeypoints([
            { x: 300, y: 400, score: 0.95 },
            ...new Array(16).fill(null).map((_, i) => ({
                x: 300 - (i - 8) * 20,
                y: 400 - i * 20,
                score: 0.8
            }))
        ]);

        const similarity = computeOKSSimilarityJS(standing, different);
        expect(similarity).toBeLessThan(TRACKING_MIN_SIMILARITY);
    });
});
