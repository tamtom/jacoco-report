export interface Project {
  modules: Module[]
  isMultiModule: boolean
  'coverage-changed-files': number
  overall: Coverage | null
  changed: Coverage | null
  baseOverallPercentage?: number
  overallDrop?: number
  regressions?: Regression[]
  hasBaseline?: boolean
  hasCoverageRegression?: boolean
}

export type RegressionType = 'new-uncovered' | 'file-dropped' | 'overall-drop'

export interface Regression {
  type: RegressionType
  module: string
  file?: string
  fileUrl?: string
  basePercentage?: number
  currentPercentage: number
  drop?: number
}

export interface Module {
  name: string
  overall: Coverage
  changed: Coverage | null
  files: File[]
}

export interface File {
  name: string;
  url: string;
  overall: Coverage;
  changed: Coverage | null;
  lines: Line[];
  basePercentage?: number;
  isNew?: boolean;
  isRegressed?: boolean;
  regressionReason?: 'new-uncovered' | 'file-dropped';
}

export interface RegressionThresholds {
  fileDrop: number;
  overallDrop: number;
  failOnUncoveredNewFile: boolean;
  // Overall-drop is informational by default. The aggregate can swing
  // due to baseline freshness or partial test execution on the base
  // branch — neither of which the PR author can fix. The per-file
  // gates already catch the scenarios this would catch. Flip on once
  // the baseline pipeline is rock-solid.
  failOnOverallDrop: boolean;
}

export interface Coverage {
  missed: number;
  covered: number;
  percentage: number;
  baseDiff?: number | null;
}

export interface Line {
  number: number
  instruction: Coverage
  branch: Coverage
}

export interface MinCoverage {
  overall: number
  changed: number
}

export interface Emoji {
  pass: string
  fail: string
}
