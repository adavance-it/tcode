// Map a file path to a highlight.js language id.
'use strict';

(function () {
  const path = require('path');
  const TC = (window.TC = window.TC || {});

  const EXT_TO_LANG = {
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala', '.groovy': 'groovy',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
    '.cs': 'csharp', '.swift': 'swift', '.php': 'php', '.m': 'objectivec',
    '.html': 'xml', '.htm': 'xml', '.vue': 'xml', '.svelte': 'xml',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.ini': 'ini',
    '.md': 'markdown', '.markdown': 'markdown',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.sql': 'sql', '.xml': 'xml', '.dockerfile': 'dockerfile',
    '.lua': 'lua', '.r': 'r', '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir',
    '.gradle': 'gradle', '.pl': 'perl', '.erl': 'erlang', '.hs': 'haskell',
    '.vim': 'vim', '.diff': 'diff', '.patch': 'diff', '.proto': 'protobuf',
    '.tf': 'hcl', '.hcl': 'hcl', '.makefile': 'makefile',
  };

  TC.detectLanguage = function detectLanguage(filePath) {
    const base = path.basename(filePath).toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
    if (base === 'makefile') return 'makefile';
    if (base === '.gitignore' || base === '.dockerignore') return 'bash';
    const ext = path.extname(filePath).toLowerCase();
    return EXT_TO_LANG[ext];
  };
})();
