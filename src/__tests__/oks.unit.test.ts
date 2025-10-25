/**
 * @fileoverview Unit tests for OKS (Object Keypoint Similarity) algorithm
 * Tests core similarity computation and area calculation
 * 
 * Following Google's Testing Best Practices:
 * - Single responsibility per test
 * - Descriptive test names (test_scenario_expectedResult)
 * - Isolated state with setup/teardown
 * - Clear arrange-act-assert pattern
 */

const OKS_KEYPOINT_THRESHOLD = 0.3;
const OKS_KEYPOINT_FALLOFF = [
    0.026, 0.025, 0.025, 0.035, 0.035, 0.079, 0.079, 0.072, 0.072, 0.062,
    0.062, 0.107, 0.107, 0.087, 0.087, 0.089, 0.089
];
const OKS_MIN_KEYPOINTS = 4;

// Implementation under test
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

    return (maxX - minX) * (maxY - minY);
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

describe('OKS.Unit.KeypointArea', () => {
    describe('computeKeypointAreaJS_basicCalculation', () => {
        test('should_computeArea_whenValidKeypoints', () => {
            // Arrange: keypoints forming a 100x100 box
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
            keypoints[0] = { x: 0, y: 0, score: 0.9 };      // top-left
            keypoints[1] = { x: 100, y: 100, score: 0.9 };  // bottom-right

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert
            expect(area).toBeCloseTo(10000, 0);
        });

        test('should_ignoreKeypoints_whenBelowThreshold', () => {
            // Arrange: two low-confidence points (below 0.3) and two high-confidence
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
            keypoints[0] = { x: 0, y: 0, score: 0.1 };      // ignored
            keypoints[1] = { x: 100, y: 100, score: 0.1 };  // ignored
            keypoints[2] = { x: 50, y: 50, score: 0.9 };    // valid
            keypoints[3] = { x: 60, y: 60, score: 0.9 };    // valid

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: (60-50) * (60-50) = 100
            expect(area).toBeCloseTo(100, 0);
        });

        test('should_returnOne_whenNoValidKeypoints', () => {
            // Arrange: all zero-confidence keypoints
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: fallback value
            expect(area).toBe(1);
        });

        test('should_handleZeroArea_whenKeypointsAligned', () => {
            // Arrange: all keypoints on same line (zero width or height)
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
            keypoints[0] = { x: 100, y: 50, score: 0.9 };
            keypoints[1] = { x: 100, y: 60, score: 0.9 };  // same x-coordinate

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: width = 0, height = 10, area = 0
            expect(area).toBe(0);
        });

        test('should_handleLargeCoordinates_withoutOverflow', () => {
            // Arrange: very large coordinate values
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
            keypoints[0] = { x: 1000000, y: 1000000, score: 0.9 };
            keypoints[1] = { x: 2000000, y: 2000000, score: 0.9 };

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: 1000000 * 1000000 = 1e12
            expect(area).toBeCloseTo(1e12, -8);
        });
    });

    describe('computeKeypointAreaJS_edgeCases', () => {
        test('should_handleNegativeCoordinates', () => {
            // Arrange: negative and positive coordinates
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
            keypoints[0] = { x: -50, y: -50, score: 0.9 };
            keypoints[1] = { x: 50, y: 50, score: 0.9 };

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: (50 - (-50)) * (50 - (-50)) = 100 * 100 = 10000
            expect(area).toBeCloseTo(10000, 0);
        });

        test('should_handleFloatingPointCoordinates', () => {
            // Arrange: floating point coordinates
            const keypoints = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
            keypoints[0] = { x: 10.5, y: 20.3, score: 0.9 };
            keypoints[1] = { x: 40.7, y: 80.9, score: 0.9 };

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: (40.7 - 10.5) * (80.9 - 20.3) = 30.2 * 60.6 ≈ 1832.12
            expect(area).toBeCloseTo(30.2 * 60.6, 1);
        });

        test('should_handleAllKeypointsAtSameLocation', () => {
            // Arrange: all keypoints at same position
            const keypoints = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));

            // Act
            const area = computeKeypointAreaJS(keypoints);

            // Assert: zero area when all points overlap
            expect(area).toBe(0);
        });
    });
});

describe('OKS.Unit.Similarity', () => {
    describe('computeOKSSimilarityJS_identicalPoses', () => {
        test('should_return1_whenKeypointsIdentical', () => {
            // Arrange: identical 17-keypoint arrays
            const kp1 = Array(17).fill(null).map((_, i) => ({
                x: 100 + i * 10,
                y: 100 + i * 10,
                score: 0.8 + Math.random() * 0.2
            }));
            const kp2 = kp1.map(k => ({ ...k }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert
            expect(similarity).toBeCloseTo(1.0, 1);
        });

        test('should_handleExactZero_withoutNaN', () => {
            // Arrange: identical zero-coordinate keypoints
            const kp1 = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should be 1.0, not NaN
            expect(similarity).toBeCloseTo(1.0, 1);
            expect(isNaN(similarity)).toBe(false);
        });
    });

    describe('computeOKSSimilarityJS_differentPoses', () => {
        test('should_returnLower_whenPoseDifferent', () => {
            // Arrange: pose with translation
            const kp1 = Array(17).fill(null).map((_, i) => ({
                x: 100 + i * 10,
                y: 100 + i * 10,
                score: 0.8
            }));
            const kp2 = Array(17).fill(null).map((_, i) => ({
                x: 150 + i * 10,  // 50px offset
                y: 150 + i * 10,
                score: 0.8
            }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should be less than 1.0 but greater than 0
            expect(similarity).toBeLessThan(1.0);
            expect(similarity).toBeGreaterThan(0);
        });

        test('should_returnZero_whenKeypointsTooFarApart', () => {
            // Arrange: poses with extreme separation
            const kp1 = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 1000, y: 1000, score: 0.9 }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should be close to 0
            expect(similarity).toBeLessThan(0.01);
        });
    });

    describe('computeOKSSimilarityJS_confidenceThreshold', () => {
        test('should_ignoreKeypoints_belowThreshold', () => {
            // Arrange: keypoints where some are below detection threshold
            const kp1 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
            kp1[0] = { x: 100, y: 100, score: 0.1 };  // below threshold
            kp2[0] = { x: 200, y: 200, score: 0.1 };  // below threshold, very different

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should still be 1.0 because low-confidence kp ignored
            expect(similarity).toBeCloseTo(1.0, 1);
        });

        test('should_returnZero_whenInsufficientValidKeypoints', () => {
            // Arrange: only 3 valid keypoints (minimum is 4)
            const kp1 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.1 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.1 }));
            kp1[0] = { x: 100, y: 100, score: 0.9 };
            kp1[1] = { x: 101, y: 101, score: 0.9 };
            kp1[2] = { x: 102, y: 102, score: 0.9 };
            kp2[0] = { x: 100, y: 100, score: 0.9 };
            kp2[1] = { x: 101, y: 101, score: 0.9 };
            kp2[2] = { x: 102, y: 102, score: 0.9 };

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: insufficient keypoints
            expect(similarity).toBe(0);
        });

        test('should_passWith_exactlyMinKeypoints', () => {
            // Arrange: exactly 4 valid keypoints (minimum threshold)
            const kp1 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.1 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.1 }));
            for (let i = 0; i < 4; i++) {
                kp1[i] = { x: 100 + i, y: 100 + i, score: 0.9 };
                kp2[i] = { x: 100 + i, y: 100 + i, score: 0.9 };
            }

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should be valid (not 0)
            expect(similarity).toBeGreaterThan(0);
            expect(similarity).toBeLessThanOrEqual(1.0);
        });
    });

    describe('computeOKSSimilarityJS_arrayValidation', () => {
        test('should_returnZero_whenArrayLengthMismatch', () => {
            // Arrange: arrays of different lengths
            const kp1 = Array(17).fill({ x: 100, y: 100, score: 0.9 });
            const kp2 = Array(10).fill({ x: 100, y: 100, score: 0.9 });

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert
            expect(similarity).toBe(0);
        });

        test('should_returnZero_whenEmptyArrays', () => {
            // Arrange: empty arrays
            const kp1: any[] = [];
            const kp2: any[] = [];

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert
            expect(similarity).toBe(0);
        });

        test('should_handleSingleKeypoint_correctly', () => {
            // Arrange: single keypoint per array
            const kp1 = [{ x: 100, y: 100, score: 0.9 }];
            const kp2 = [{ x: 100, y: 100, score: 0.9 }];

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: insufficient keypoints (need min 4)
            expect(similarity).toBe(0);
        });
    });

    describe('computeOKSSimilarityJS_numericalStability', () => {
        test('should_avoidDivisionByZero', () => {
            // Arrange: area computation that could cause division by zero
            const kp1 = Array(4).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
            const kp2 = Array(4).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: no NaN or Infinity
            expect(isFinite(similarity)).toBe(true);
            expect(isNaN(similarity)).toBe(false);
        });

        test('should_handleVerySmallDistances', () => {
            // Arrange: keypoints very close together (sub-pixel)
            const kp1 = Array(17).fill(null).map((_, i) => ({
                x: 100 + i * 0.001,
                y: 100 + i * 0.001,
                score: 0.9
            }));
            const kp2 = Array(17).fill(null).map((_, i) => ({
                x: 100.0001 + i * 0.001,
                y: 100.0001 + i * 0.001,
                score: 0.9
            }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should be very close to 1.0
            expect(similarity).toBeCloseTo(1.0, 2);
        });

        test('should_handleVeryLargeDistances', () => {
            // Arrange: keypoints very far apart
            const kp1 = Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 1e6, y: 1e6, score: 0.9 }));

            // Act
            const similarity = computeOKSSimilarityJS(kp1, kp2);

            // Assert: should be close to 0 but not NaN
            expect(isFinite(similarity)).toBe(true);
            expect(similarity).toBeLessThan(1e-10);
        });
    });
});
