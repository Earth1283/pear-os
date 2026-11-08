const JARGON: [RegExp, string][] = [
  [/\bhi\b|\bhey\b|\bhello\b/gi, 'I hope this message finds you well'],
  [/\bi think\b/gi, 'it is my considered position that'],
  [/\buse\b/gi, 'leverage'],
  [/\bhelp\b/gi, 'facilitate'],
  [/\bproblem\b/gi, 'opportunity'],
  [/\bidea\b/gi, 'strategic initiative'],
  [/\btalk\b/gi, 'circle back'],
  [/\bbad\b/gi, 'sub-optimal'],
  [/\bgood\b/gi, 'best-in-class'],
  [/\bwork\b/gi, 'synergise'],
  [/\bsoon\b/gi, 'in the coming fiscal quarters'],
]

export const TOOLS: { id: string; label: string; run: (t: string) => string }[] = [
  { id: 'proofread', label: 'Proofread', run: (t) => `${t}\n\nNo issues found. (We did not look.)` },
  {
    id: 'rewrite',
    label: 'Rewrite',
    run: (t) =>
      t
        .split(/\s+/)
        .reverse()
        .join(' ')
        .replace(/^./, (c) => c.toUpperCase()),
  },
  { id: 'friendly', label: 'Friendly', run: (t) => `Heyyy!! ${t.replace(/\./g, '!!')} Hope that helps, bestie!!! xoxo` },
  { id: 'professional', label: 'Professional', run: (t) => `Per my last email, ${JARGON.reduce((s, [re, r]) => s.replace(re, r), t)}. Please advise. Best regards, Pear User` },
  { id: 'concise', label: 'Concise', run: (t) => t.replace(/[aeiou]/gi, '') },
  { id: 'summary', label: 'Summary', run: (t) => `TL;DR: ${t.split(/\s+/).slice(0, 2).join(' ')}…` },
  { id: 'keypoints', label: 'Key Points', run: (t) => `• ${t.split(/\s+/)[0] ?? 'Words'}\n• There were words\n• Some of them were important (unclear which)` },
]
