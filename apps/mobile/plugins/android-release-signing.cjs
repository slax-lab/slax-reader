const marker = '// Slax release signing: operator-managed environment only.';

// Preserve offsets while hiding comments and quoted braces from the block scan.
function codeMask(contents) {
  return contents.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
    value => value.replace(/[^\r\n]/g, ' '));
}

function releaseRanges(contents) {
  const code = codeMask(contents), ranges = [];
  for (const match of code.matchAll(/\brelease\s*\{/g)) {
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    for (; end < code.length && depth; end++) {
      if (code[end] === '{') depth++;
      else if (code[end] === '}') depth--;
    }
    if (depth) throw new Error('Cannot inspect Android release signing: unbalanced release block.');
    ranges.push({start, end: end - 1});
  }
  if (!ranges.length) throw new Error('Cannot inspect Android release signing: release block is missing.');
  return {code, ranges};
}

function debugAssignments(contents) {
  const {code, ranges} = releaseRanges(contents);
  const assignments = [];
  for (const {start, end} of ranges) {
    const block = code.slice(start, end);
    for (const match of block.matchAll(/\bsigningConfig\s*(?:=\s*)?(?:android\.)?signingConfigs\s*\.\s*debug\b/g)) {
      assignments.push({start: start + match.index, end: start + match.index + match[0].length});
    }
  }
  return assignments;
}

function removeTemplateDebugSigning(contents) {
  for (const {start, end} of debugAssignments(contents).sort((a, b) => b.start - a.start)) {
    contents = `${contents.slice(0, start)}signingConfig = null${contents.slice(end)}`;
  }
  return contents;
}

function assertReleaseSigning(contents) {
  if (!contents.includes(marker) || debugAssignments(contents).length) {
    throw new Error('Regenerate native projects: release builds cannot use the template debug signing identity.');
  }
}

module.exports = {marker, removeTemplateDebugSigning, assertReleaseSigning};
