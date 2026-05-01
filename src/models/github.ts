export interface ChangedFile {
  filePath: string
  url: string
  lines: number[]
  // GitHub's PR-file status. 'added' is the authoritative signal that a
  // file is new — don't try to infer this from the absence of base
  // coverage data (jacoco may simply not report on a file).
  status?: 'added' | 'modified' | 'removed' | 'renamed' | 'changed' | 'copied' | 'unchanged'
  previousFilePath?: string
}
