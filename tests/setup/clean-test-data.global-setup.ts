import { cleanTestData } from '../../scripts/clean-test-data.mjs'

/** Removes leftovers of previous test runs from the local database before a suite starts. */
export default function setup(): void {
  cleanTestData()
}
