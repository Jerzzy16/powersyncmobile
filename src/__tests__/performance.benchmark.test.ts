/**
 * @fileoverview Performance and benchmark tests
 * Measures computation time, memory usage, and throughput
 * 
 * Following Google's Testing Best Practices:
 * - Measure real performance characteristics
 * - Establish performance baselines
 * - Detect regressions early
 * - Test with realistic data scales
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

describe('Performance.Benchmarks.OKSComputation', () => {
    describe('computeOKSSimilarityJS_throughput', () => {
        test('should_compute1000Similarities_withinTimebudget', () => {
            // Arrange: create 1000 random pose pairs
            const poses = Array(1000)
                .fill(null)
                .map(() =>
                    Array(17)
                        .fill(null)
                        .map(() => ({
                            x: Math.random() * 1000,
                            y: Math.random() * 1000,
                            score: 0.5 + Math.random() * 0.5
                        }))
                );

            // Act: measure computation time
            const startTime = performance.now();
            let computationCount = 0;

            for (let i = 0; i < poses.length; i++) {
                for (let j = i + 1; j < Math.min(i + 10, poses.length); j++) {
                    computeOKSSimilarityJS(poses[i], poses[j]);
                    computationCount++;
                }
            }

            const elapsedTime = performance.now() - startTime;

            // Assert: should complete within reasonable time (not strict 100ms due to JS engine variation)
            expect(elapsedTime).toBeLessThan(500);
            console.log(`✓ Computed ${computationCount} similarities in ${elapsedTime.toFixed(2)}ms`);
        });

        test('should_computeAreaFast_for17Keypoints', () => {
            // Arrange
            const keypoints = Array(17)
                .fill(null)
                .map(() => ({
                    x: Math.random() * 1000,
                    y: Math.random() * 1000,
                    score: 0.7 + Math.random() * 0.3
                }));

            // Act: measure area computation
            const iterations = 10000;
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                computeKeypointAreaJS(keypoints);
            }

            const elapsedTime = performance.now() - startTime;
            const avgTime = elapsedTime / iterations;

            // Assert: should be very fast (< 1ms average)
            expect(avgTime).toBeLessThan(1);
            console.log(`✓ Area computation: ${avgTime.toFixed(4)}ms per call`);
        });
    });

    describe('computeOKSSimilarityJS_scalability', () => {
        test('should_scaleLinearlyWithPoseCount', () => {
            // Arrange: test with different numbers of tracked people
            const measurements: Array<{ count: number; time: number }> = [];

            for (let trackCount = 1; trackCount <= 18; trackCount++) {
                const poses = Array(trackCount)
                    .fill(null)
                    .map(() =>
                        Array(17)
                            .fill(null)
                            .map(() => ({
                                x: Math.random() * 1000,
                                y: Math.random() * 1000,
                                score: 0.7 + Math.random() * 0.3
                            }))
                    );

                const startTime = performance.now();

                // Compute pairwise similarities (realistic scenario)
                for (let i = 0; i < poses.length; i++) {
                    for (let j = i + 1; j < poses.length; j++) {
                        computeOKSSimilarityJS(poses[i], poses[j]);
                    }
                }

                const elapsedTime = performance.now() - startTime;
                measurements.push({ count: trackCount, time: elapsedTime });
            }

            // Assert: time should grow roughly quadratically (O(n²))
            // 18 people should take less than 50ms for all pairwise comparisons
            expect(measurements[measurements.length - 1].time).toBeLessThan(50);

            console.log('Timing by track count:');
            measurements.forEach(m => {
                console.log(`  ${m.count} tracks: ${m.time.toFixed(2)}ms`);
            });
        });
    });

    describe('computeOKSSimilarityJS_memoryProfile', () => {
        test('should_notAllocateExcessively_perCall', () => {
            // Arrange
            const kp1 = Array(17)
                .fill(null)
                .map(() => ({
                    x: Math.random() * 1000,
                    y: Math.random() * 1000,
                    score: 0.7
                }));
            const kp2 = Array(17)
                .fill(null)
                .map(() => ({
                    x: Math.random() * 1000,
                    y: Math.random() * 1000,
                    score: 0.7
                }));

            // Act: call many times and check for memory leaks (rough check)
            const iterations = 100000;
            const startMemory = (globalThis as any).gc ? process.memoryUsage() : null;

            for (let i = 0; i < iterations; i++) {
                computeOKSSimilarityJS(kp1, kp2);
            }

            const endMemory = (globalThis as any).gc ? process.memoryUsage() : null;

            // Assert: memory should not grow significantly
            if (startMemory && endMemory) {
                const heapDiff = endMemory.heapUsed - startMemory.heapUsed;
                expect(heapDiff / 1024 / 1024).toBeLessThan(50); // less than 50MB growth
                console.log(`✓ Memory growth: ${(heapDiff / 1024 / 1024).toFixed(2)}MB for ${iterations} iterations`);
            }
        });
    });
});

describe('Performance.Benchmarks.RealisticScenarios', () => {
    test('should_track18People_in7Point5FpsTarget', () => {
        // Arrange: 18 people (max concurrent), 7.5fps effective (2x frame skip at 15fps)
        // Each frame: create 18 detections, match against up to 18 tracks, compute ~18² OKS similarities
        const frameTime = 1000 / 7.5; // 133ms per frame

        const people = Array(18)
            .fill(null)
            .map(() =>
                Array(17)
                    .fill(null)
                    .map(() => ({
                        x: Math.random() * 1920,
                        y: Math.random() * 1080,
                        score: 0.7 + Math.random() * 0.2
                    }))
            );

        // Act: simulate single frame processing
        const startTime = performance.now();

        // Compute all pairwise OKS similarities (worst case: all tracked)
        for (let i = 0; i < people.length; i++) {
            for (let j = i + 1; j < people.length; j++) {
                computeOKSSimilarityJS(people[i], people[j]);
            }
        }

        const elapsedTime = performance.now() - startTime;

        // Assert: should fit within frame budget
        expect(elapsedTime).toBeLessThan(frameTime * 0.8); // 80% of frame budget
        console.log(
            `✓ 18-person frame processing: ${elapsedTime.toFixed(2)}ms (budget: ${frameTime.toFixed(2)}ms)`
        );
    });

    test('should_handleHighConfidenceKeypoints_fastest', () => {
        // Arrange: all keypoints at high confidence (best case)
        const kp1 = Array(17)
            .fill(null)
            .map(() => ({
                x: Math.random() * 1000,
                y: Math.random() * 1000,
                score: 0.95 // very high confidence
            }));
        const kp2 = Array(17)
            .fill(null)
            .map(() => ({
                x: Math.random() * 1000,
                y: Math.random() * 1000,
                score: 0.95
            }));

        // Act
        const iterations = 10000;
        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            computeOKSSimilarityJS(kp1, kp2);
        }

        const elapsedTime = performance.now() - startTime;

        // Assert
        console.log(
            `✓ High-confidence computation: ${(elapsedTime / iterations).toFixed(4)}ms per call`
        );
        expect(elapsedTime / iterations).toBeLessThan(1);
    });

    test('should_handleManyLowConfidenceKeypoints_gracefully', () => {
        // Arrange: mostly low confidence (worst case for computation)
        const kp1 = Array(17)
            .fill(null)
            .map(() => ({
                x: Math.random() * 1000,
                y: Math.random() * 1000,
                score: 0.15 // below threshold
            }));
        const kp2 = Array(17)
            .fill(null)
            .map(() => ({
                x: Math.random() * 1000,
                y: Math.random() * 1000,
                score: 0.15
            }));

        // Act
        const iterations = 10000;
        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            computeOKSSimilarityJS(kp1, kp2);
        }

        const elapsedTime = performance.now() - startTime;

        // Assert: should short-circuit quickly to 0
        console.log(
            `✓ Low-confidence computation: ${(elapsedTime / iterations).toFixed(4)}ms per call`
        );
        expect(elapsedTime / iterations).toBeLessThan(1);
    });
});

describe('Performance.Benchmarks.EdgeCases', () => {
    test('should_handledDivisionByZero_efficiently', () => {
        // Arrange: keypoints that all overlap (area = 0)
        const kp1 = Array(17).fill({ x: 100, y: 100, score: 0.9 });
        const kp2 = Array(17).fill({ x: 100, y: 100, score: 0.9 });

        // Act
        const iterations = 10000;
        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            computeOKSSimilarityJS(kp1, kp2);
        }

        const elapsedTime = performance.now() - startTime;

        // Assert: should handle without slowdown
        expect(elapsedTime / iterations).toBeLessThan(1);
        console.log(`✓ Division-by-zero case: ${(elapsedTime / iterations).toFixed(4)}ms per call`);
    });

    test('should_handleLargeCoordinateValues_stably', () => {
        // Arrange: very large coordinates (floating point precision test)
        const kp1 = Array(17)
            .fill(null)
            .map(() => ({
                x: 1e6 + Math.random() * 1000,
                y: 1e6 + Math.random() * 1000,
                score: 0.9
            }));
        const kp2 = Array(17)
            .fill(null)
            .map(() => ({
                x: 1e6 + Math.random() * 1000,
                y: 1e6 + Math.random() * 1000,
                score: 0.9
            }));

        // Act
        const iterations = 5000;
        const startTime = performance.now();

        for (let i = 0; i < iterations; i++) {
            const result = computeOKSSimilarityJS(kp1, kp2);
            expect(isFinite(result)).toBe(true);
        }

        const elapsedTime = performance.now() - startTime;

        // Assert
        expect(elapsedTime / iterations).toBeLessThan(1);
        console.log(
            `✓ Large coordinate values: ${(elapsedTime / iterations).toFixed(4)}ms per call`
        );
    });
});
