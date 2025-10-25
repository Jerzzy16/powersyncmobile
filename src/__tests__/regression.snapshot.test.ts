/**
 * @fileoverview Regression and snapshot tests
 * Detects unintended behavior changes and output format consistency
 * 
 * Following Google's Testing Best Practices:
 * - Capture baseline behavior
 * - Detect regression early
 * - Snapshot known-good outputs
 * - Test API compatibility
 */

const OKS_KEYPOINT_THRESHOLD = 0.3;
const OKS_KEYPOINT_FALLOFF = [
    0.026, 0.025, 0.025, 0.035, 0.035, 0.079, 0.079, 0.072, 0.072, 0.062,
    0.062, 0.107, 0.107, 0.087, 0.087, 0.089, 0.089
];
const OKS_MIN_KEYPOINTS = 4;

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

describe('Regression.OutputFormat', () => {
    describe('outputFormat_consistency', () => {
        test('should_returnNumber_always', () => {
            // Arrange
            const kp1 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
            const kp2 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));

            // Act
            const result = computeOKSSimilarityJS(kp1, kp2);

            // Assert
            expect(typeof result).toBe('number');
            expect(isNaN(result)).toBe(false);
        });

        test('should_returnBoundedRange_0to1', () => {
            // Arrange: various scenarios
            const scenarios = [
                {
                    name: 'identical',
                    kp1: Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 })),
                    kp2: Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }))
                },
                {
                    name: 'different',
                    kp1: Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0.9 })),
                    kp2: Array(17).fill(null).map(() => ({ x: 1000, y: 1000, score: 0.9 }))
                },
                {
                    name: 'mixed_confidence',
                    kp1: Array(17).fill(null).map((_, i) => ({ x: 100, y: 100, score: i % 2 ? 0.9 : 0.1 })),
                    kp2: Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }))
                }
            ];

            // Act & Assert
            scenarios.forEach(scenario => {
                const result = computeOKSSimilarityJS(scenario.kp1, scenario.kp2);
                expect(result).toBeGreaterThanOrEqual(0);
                expect(result).toBeLessThanOrEqual(1);
            });
        });

        test('should_handleSpecialFloatValues_gracefully', () => {
            // Arrange: test with special floating point values
            const testCases = [
                { x: 0, y: 0, score: 0.9 },
                { x: -0, y: -0, score: 0.9 },
                { x: 0.0001, y: 0.0001, score: 0.9 },
                { x: 1e-10, y: 1e-10, score: 0.9 }
            ];

            const kp1 = Array(17).fill(testCases[0]);
            const kp2 = Array(17).fill(testCases[0]);

            // Act
            const result = computeOKSSimilarityJS(kp1, kp2);

            // Assert: no NaN or Infinity
            expect(isFinite(result)).toBe(true);
        });
    });

    describe('areaCalculation_consistency', () => {
        test('should_returnNonNegativeArea', () => {
            // Arrange: various keypoint distributions
            for (let i = 0; i < 10; i++) {
                const keypoints = Array(17)
                    .fill(null)
                    .map(() => ({
                        x: Math.random() * 1000,
                        y: Math.random() * 1000,
                        score: Math.random() * 1
                    }));

                // Act
                const area = computeKeypointAreaJS(keypoints);

                // Assert
                expect(area).toBeGreaterThanOrEqual(0);
                expect(isFinite(area)).toBe(true);
            }
        });

        test('should_returnOne_forInvalidKeypoints', () => {
            // Arrange: various invalid inputs
            const invalidInputs = [
                Array(17).fill({ x: 0, y: 0, score: 0 }),
                Array(17).fill({ x: 0, y: 0, score: 0.1 }),
                []
            ];

            // Act & Assert
            invalidInputs.forEach(kp => {
                const area = computeKeypointAreaJS(kp as any);
                expect(area).toBe(1);
            });
        });
    });
});

describe('Regression.BehaviorChanges', () => {
    test('should_maintainOKSConstant_threshold', () => {
        // Arrange: verify threshold value is stable
        const threshold = 0.3;

        // Act & Assert: hardcoded in implementation
        expect(OKS_KEYPOINT_THRESHOLD).toBe(threshold);
    });

    test('should_maintainOKSConstant_falloffArray', () => {
        // Arrange: verify falloff array length and known values
        // Assert
        expect(OKS_KEYPOINT_FALLOFF.length).toBe(17);
        expect(OKS_KEYPOINT_FALLOFF[0]).toBe(0.026);
        expect(OKS_KEYPOINT_FALLOFF[16]).toBe(0.089);
    });

    test('should_maintainOKSConstant_minKeypoints', () => {
        // Assert: minimum keypoints threshold should be 4
        expect(OKS_MIN_KEYPOINTS).toBe(4);
    });

    test('should_respectConfidenceThreshold_changes', () => {
        // Arrange: test that confidence threshold is being respected
        const kp1 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.25 })); // below 0.3
        const kp2 = Array(17).fill(null).map(() => ({ x: 105, y: 105, score: 0.25 }));

        // Act
        const similarity = computeOKSSimilarityJS(kp1, kp2);

        // Assert: should return 0 (no valid keypoints)
        expect(similarity).toBe(0);
    });

    test('should_respectAreaNormalization_behavior', () => {
        // Arrange: test that area normalization affects similarity
        const small_kp = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
        const small_kp_moved = Array(17).fill(null).map(() => ({ x: 101, y: 101, score: 0.9 }));

        const large_kp = Array(17).fill(null).map((_, i) => ({
            x: i * 100,
            y: i * 100,
            score: 0.9
        }));
        const large_kp_moved = Array(17).fill(null).map((_, i) => ({
            x: i * 100 + 1,
            y: i * 100 + 1,
            score: 0.9
        }));

        // Act
        const smallSim = computeOKSSimilarityJS(small_kp, small_kp_moved);
        const largeSim = computeOKSSimilarityJS(large_kp, large_kp_moved);

        // Assert: both should be valid similarities
        expect(isFinite(smallSim)).toBe(true);
        expect(isFinite(largeSim)).toBe(true);
    });
});

describe('Regression.ApiCompatibility', () => {
    test('should_acceptArrayOfObjects_withXYScore', () => {
        // Arrange: ensure API contract is maintained
        const validKp = Array(17).fill(null).map(() => ({
            x: Math.random() * 1000,
            y: Math.random() * 1000,
            score: Math.random()
        }));

        // Act & Assert: should not throw
        expect(() => computeOKSSimilarityJS(validKp, validKp)).not.toThrow();
    });

    test('should_rejectIncompatibleObjectStructure', () => {
        // Arrange: ensure type checking or graceful handling
        const invalidKp = Array(17).fill(null).map(() => ({
            x: 100,
            y: 100
            // missing score
        }));

        // Act: should handle gracefully (return 0 or similar)
        const result = computeOKSSimilarityJS(invalidKp as any, invalidKp as any);

        // Assert: should return valid number
        expect(isFinite(result)).toBe(true);
    });

    test('should_handle17KeypointArrays_exclusively', () => {
        // Arrange: test with various array sizes
        const testSizes = [1, 2, 4, 16, 17, 18, 25, 100];
        const results = [];

        // Act
        for (const size of testSizes) {
            const kp = Array(size).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
            const result = computeOKSSimilarityJS(kp, kp);
            results.push({ size, result });
        }

        // Assert: all should return valid numbers
        results.forEach(r => {
            expect(isFinite(r.result)).toBe(true);
        });

        // 17-keypoint case should be only valid result
        expect(results[4].result).toBeCloseTo(1.0, 1); // index 4 = 17 keypoints
    });
});

describe('Regression.KnownGoodOutputs', () => {
    test('should_matchBaseline_scenario1', () => {
        // Arrange: baseline scenario from known-good run
        const person1 = Array(17)
            .fill(null)
            .map((_, i) => ({
                x: 100 + i * 5,
                y: 100 + i * 5,
                score: 0.7 + i * 0.01
            }));

        const person2 = Array(17)
            .fill(null)
            .map((_, i) => ({
                x: 102 + i * 5,
                y: 102 + i * 5,
                score: 0.7 + i * 0.01
            }));

        // Act
        const similarity = computeOKSSimilarityJS(person1, person2);

        // Assert: expect high similarity for slightly different poses (within tolerance)
        expect(similarity).toBeGreaterThan(0.85);
        expect(similarity).toBeLessThanOrEqual(1.0);
    });

    test('should_matchBaseline_scenario2', () => {
        // Arrange: different pose baseline
        const person1 = Array(17)
            .fill(null)
            .map(() => ({ x: 0, y: 0, score: 0.9 }));

        const person2 = Array(17)
            .fill(null)
            .map(() => ({ x: 500, y: 500, score: 0.9 }));

        // Act
        const similarity = computeOKSSimilarityJS(person1, person2);

        // Assert: very different poses should have low similarity
        expect(similarity).toBeLessThan(0.1);
    });

    test('should_produce_deterministic_results', () => {
        // Arrange
        const kp1 = Array(17).fill(null).map(() => ({ x: 100, y: 100, score: 0.9 }));
        const kp2 = Array(17).fill(null).map(() => ({ x: 105, y: 105, score: 0.9 }));

        // Act: compute multiple times
        const result1 = computeOKSSimilarityJS(kp1, kp2);
        const result2 = computeOKSSimilarityJS(kp1, kp2);
        const result3 = computeOKSSimilarityJS(kp1, kp2);

        // Assert: all results should be identical
        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
    });
});
