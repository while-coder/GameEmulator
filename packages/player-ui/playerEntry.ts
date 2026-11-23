export type PlayerEntry =
  | { kind: 'play'; key: string; name: string; saveKey?: string }
  | { kind: 'settings' }
