export const SKILLS_SOURCE = 'https://github.com/slax-lab/slax-reader/tree/dev/apps/cli/skills/slax-reader'
export const SKILL_INSTALL_ARGS = ['-y', 'skills', 'add', SKILLS_SOURCE, '--skill', 'slax-reader', '-g', '-y']
export const SKILL_SYNC_MANUAL_HINT = `Run manually: npx ${SKILL_INSTALL_ARGS.join(' ')}`
