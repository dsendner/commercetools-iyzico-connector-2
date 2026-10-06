/**
 * Builds a test double from a partial shape.
 *
 * Keeps the fixture checked against the real type, unlike `as any`: a renamed or
 * misspelled field fails the build instead of silently reaching the code under test.
 */
export const stub = <T>(value: Partial<T>): T => value as unknown as T;
