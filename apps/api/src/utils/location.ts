export function selectDORegion(req: Request): DurableObjectLocationHint {
  const country = String(req.cf?.country || '')
  const continent = String(req.cf?.continent || '')
  const region = String(req.cf?.region || '')

  // 中东地区国家列表
  const middleEastCountries = new Set(['AE', 'BH', 'IR', 'IQ', 'IL', 'JO', 'KW', 'LB', 'OM', 'PS', 'QA', 'SA', 'SY', 'YE'])

  // 根据国家代码直接匹配特定区域
  if (middleEastCountries.has(country)) {
    return 'me'
  }

  // 基于大洲进行区域匹配
  switch (continent) {
    case 'NA': // 北美洲
      // 西部州/省代码
      const westStates = new Set(['WA', 'OR', 'CA', 'NV', 'ID', 'MT', 'WY', 'UT', 'AZ', 'CO', 'NM', 'BC', 'AB'])
      // 根据 cf.region 判断是东部还是西部
      return westStates.has(region) ? 'wnam' : 'enam'

    case 'SA': // 南美洲
      return 'sam'

    case 'EU': // 欧洲
      // 东欧国家列表
      const eastEuropeanCountries = new Set(['BY', 'BG', 'CZ', 'HU', 'MD', 'PL', 'RO', 'RU', 'SK', 'UA'])
      return eastEuropeanCountries.has(country) ? 'eeur' : 'weur'

    case 'AS': // 亚洲
      return 'apac'

    case 'OC': // 大洋洲
      return 'oc'

    case 'AF': // 非洲
      return 'afr'

    default:
      return 'enam'
  }
}

export function getLocationPowerSyncRegion(req: Request): 'singapore' | 'us-west' {
  const continent = String(req.cf?.continent || '')
  return continent === 'NA' || continent === 'SA' ? 'us-west' : 'singapore'
}
