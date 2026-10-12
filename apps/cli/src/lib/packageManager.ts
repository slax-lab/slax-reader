const PACKAGE_NAME = '@slax-lab/reader-cli'

export function buildInstallCommand(pkg: string = PACKAGE_NAME): string {
  return `npm install -g ${pkg}@latest`
}
