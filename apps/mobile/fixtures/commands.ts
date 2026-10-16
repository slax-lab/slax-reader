import type {FixtureAction} from '../src/components/fixture-actions.ts';

export type FixtureCommand = {kind: 'case'; scenario: string; locale: 'en'|'zh'} | {kind: 'action'; action: FixtureAction | number};
/** No production scheme, filesystem path, API origin or arbitrary JavaScript is accepted. */
export function parseFixtureCommand(raw: string, scenarios: Record<string, unknown>): FixtureCommand | null {
  const url = new URL(raw);
  if (url.protocol !== 'slaxreader-ui-fixture:' || url.hostname !== 'control' || (url.pathname && url.pathname !== '/')) return null;
  if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => !['case', 'locale', 'action', 'index'].includes(key))) throw new Error('Unexpected fixture command field');
  const scenario = url.searchParams.get('case'), action = url.searchParams.get('action'), index = url.searchParams.get('index');
  if ([scenario, action, index].filter(value => value !== null).length !== 1) throw new Error('Select exactly one fixture command');
  if (scenario !== null) {
    const locale = url.searchParams.get('locale') ?? 'en';
    if (!Object.hasOwn(scenarios, scenario) || !/^[a-z0-9-]+$/.test(scenario) || !['en', 'zh'].includes(locale)) throw new Error('Unknown prepared fixture case or locale');
    return {kind: 'case', scenario, locale: locale as 'en'|'zh'};
  }
  if (url.searchParams.has('locale')) throw new Error('Locale applies only to case commands');
  if (index !== null) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(index)) throw new Error('Invalid prepared action index');
    return {kind: 'action', action: Number(index)};
  }
  if (action!.length > 16384) throw new Error('Fixture action is too large');
  const parsed = JSON.parse(action!);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.kind !== 'string' || !/^[a-z-]+$/.test(parsed.kind)) throw new Error('Invalid fixture action object');
  return {kind: 'action', action: parsed};
}
